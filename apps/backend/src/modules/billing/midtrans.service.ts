import { Injectable, BadGatewayException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import { AdminSettingsService } from "../admin-settings/admin-settings.service.js";

interface MidtransCreds {
  serverKey: string;
  isProduction: boolean;
}

export interface SnapResult {
  token: string;
  redirectUrl: string;
}

@Injectable()
export class MidtransService {
  private readonly logger = new Logger(MidtransService.name);

  constructor(
    private readonly settings: AdminSettingsService,
    private readonly config: ConfigService,
  ) {}

  private async creds(): Promise<MidtransCreds> {
    // Admin CMS first (PRD Bagian 7), env as fallback for local dev.
    const serverKey =
      (await this.settings.get("midtrans_server_key")) ??
      this.config.get<string>("MIDTRANS_SERVER_KEY");
    if (!serverKey) {
      throw new BadGatewayException("Midtrans server key not configured");
    }
    const isProd =
      ((await this.settings.get("midtrans_is_production")) ??
        this.config.get<string>("MIDTRANS_IS_PRODUCTION", "false")) === "true";
    return { serverKey, isProduction: isProd };
  }

  private snapBase(isProduction: boolean): string {
    return isProduction
      ? "https://app.midtrans.com/snap/v1/transactions"
      : "https://app.sandbox.midtrans.com/snap/v1/transactions";
  }

  /** Create a Snap transaction → hosted payment page (PRD Bagian 4.4). */
  async createSnap(params: {
    orderId: string;
    amount: number;
    customer?: { name?: string; email?: string; phone?: string };
  }): Promise<SnapResult> {
    const { serverKey, isProduction } = await this.creds();
    const auth = Buffer.from(`${serverKey}:`).toString("base64");

    const res = await fetch(this.snapBase(isProduction), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        transaction_details: {
          order_id: params.orderId,
          gross_amount: Math.round(params.amount),
        },
        customer_details: {
          first_name: params.customer?.name ?? "AutoToko User",
          email: params.customer?.email,
          phone: params.customer?.phone,
        },
      }),
    });

    const json = (await res.json()) as {
      token?: string;
      redirect_url?: string;
      error_messages?: string[];
    };
    if (!res.ok || !json.token || !json.redirect_url) {
      throw new BadGatewayException(
        `Midtrans error: ${json.error_messages?.join("; ") ?? res.status}`,
      );
    }
    return { token: json.token, redirectUrl: json.redirect_url };
  }

  /**
   * Verify a Midtrans notification (PRD Bagian 4.4 callback):
   *   signature_key = SHA512(order_id + status_code + gross_amount + server_key)
   */
  async verifyNotification(n: {
    order_id: string;
    status_code: string;
    gross_amount: string;
    signature_key: string;
  }): Promise<boolean> {
    const { serverKey } = await this.creds();
    const expected = createHash("sha512")
      .update(`${n.order_id}${n.status_code}${n.gross_amount}${serverKey}`)
      .digest("hex");
    return expected === n.signature_key;
  }

  /** Map Midtrans transaction_status to our outcome. */
  outcome(status: string, fraud?: string): "paid" | "pending" | "failed" {
    if (status === "capture") return fraud === "challenge" ? "pending" : "paid";
    if (status === "settlement") return "paid";
    if (status === "pending") return "pending";
    return "failed"; // deny, cancel, expire, failure
  }
}
