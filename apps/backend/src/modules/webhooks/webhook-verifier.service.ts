import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, timingSafeEqual } from "node:crypto";
import { AdminSettingsService } from "../admin-settings/admin-settings.service.js";

/**
 * Verifies native marketplace webhook signatures (HMAC-SHA256) over the raw
 * request body. Credentials come from Admin CMS (admin_settings). Returns false
 * (rather than throwing) when it cannot verify, so the caller can fall back to
 * the shared ?secret= guard.
 *
 * TikTok rejects ?secret= in the callback URL, so native signature verification
 * is the ONLY auth path for real TikTok webhooks. The exact TikTok formula is
 * documented inconsistently, so we try a few cryptographically-equivalent-strength
 * candidates and accept if any matches (an attacker still needs app_secret).
 * Set WEBHOOK_DEBUG=true to log the received vs computed signatures so the real
 * formula can be confirmed against a live Development Shop test event.
 *
 *   Shopee:  hex(HMAC-SHA256(partner_key, push_url + "|" + raw_body))
 *   TikTok:  hex(HMAC-SHA256(app_secret, app_key + raw_body))  [+ variants]
 */
@Injectable()
export class WebhookVerifierService {
  private readonly logger = new Logger(WebhookVerifierService.name);

  constructor(
    private readonly settings: AdminSettingsService,
    private readonly config: ConfigService,
  ) {}

  private get debug(): boolean {
    return this.config.get<string>("WEBHOOK_DEBUG") === "true";
  }

  private hmacHex(key: string, data: string): string {
    return createHmac("sha256", key).update(data, "utf8").digest("hex");
  }

  private safeEqualHex(expected: string, got?: string): boolean {
    if (!got) return false;
    const a = Buffer.from(expected.toLowerCase());
    const b = Buffer.from(got.trim().toLowerCase());
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  /** Try each candidate; return the matching name or null. Logs on debug. */
  private matchCandidate(
    candidates: Record<string, string>,
    signature: string | undefined,
    label: string,
  ): string | null {
    if (signature) {
      for (const [name, expected] of Object.entries(candidates)) {
        if (this.safeEqualHex(expected, signature)) {
          this.logger.log(`${label} webhook signature matched via "${name}"`);
          return name;
        }
      }
    }
    if (this.debug) {
      const got = signature ? `${signature.slice(0, 20)}…(${signature.length})` : "<none>";
      const computed = Object.entries(candidates)
        .map(([k, v]) => `${k}=${v.slice(0, 16)}…`)
        .join("  ");
      this.logger.warn(`${label} signature MISMATCH. received=${got}  computed: ${computed}`);
    }
    return null;
  }

  async verifyShopee(rawBody: Buffer | undefined, signature?: string): Promise<boolean> {
    if (!rawBody) return false;
    const partnerKey = await this.settings.get("shopee_partner_key");
    if (!partnerKey) return false;
    const body = rawBody.toString("utf8");
    const pushUrl =
      this.config.get<string>("SHOPEE_PUSH_URL") ?? `${this.publicBase()}/api/webhooks/shopee`;
    const candidates: Record<string, string> = {
      url_pipe_body: this.hmacHex(partnerKey, `${pushUrl}|${body}`),
      body_only: this.hmacHex(partnerKey, body),
    };
    return this.matchCandidate(candidates, signature, "Shopee") !== null;
  }

  async verifyTikTok(rawBody: Buffer | undefined, signature?: string): Promise<boolean> {
    if (!rawBody) return false;
    const appKey = await this.settings.get("tiktok_app_key");
    const appSecret = await this.settings.get("tiktok_app_secret");
    if (!appKey || !appSecret) return false;
    const body = rawBody.toString("utf8");
    const candidates: Record<string, string> = {
      appkey_body: this.hmacHex(appSecret, `${appKey}${body}`),
      body_only: this.hmacHex(appSecret, body),
      secret_wrapped: this.hmacHex(appSecret, `${appSecret}${appKey}${body}${appSecret}`),
    };
    return this.matchCandidate(candidates, signature, "TikTok") !== null;
  }

  private publicBase(): string {
    return this.config.get<string>("WEBHOOK_PUBLIC_BASE_URL", "https://apitoko.cosger.online");
  }
}
