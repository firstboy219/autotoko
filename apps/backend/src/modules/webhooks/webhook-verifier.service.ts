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
 * Algorithms (per TikTok Shop / Shopee Open Platform docs + CLAUDE2.md §):
 *   Shopee:  hex(HMAC-SHA256(partner_key, push_url + "|" + raw_body))
 *   TikTok:  hex(HMAC-SHA256(app_secret, app_key + raw_body))
 */
@Injectable()
export class WebhookVerifierService {
  private readonly logger = new Logger(WebhookVerifierService.name);

  constructor(
    private readonly settings: AdminSettingsService,
    private readonly config: ConfigService,
  ) {}

  private safeEqualHex(expected: string, got?: string): boolean {
    if (!got) return false;
    // Some marketplaces prefix or wrap the signature; compare the hex core.
    const a = Buffer.from(expected.toLowerCase());
    const b = Buffer.from(got.trim().toLowerCase());
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  async verifyShopee(rawBody: Buffer | undefined, signature?: string): Promise<boolean> {
    if (!rawBody || !signature) return false;
    const partnerKey = await this.settings.get("shopee_partner_key");
    if (!partnerKey) return false;
    const pushUrl =
      this.config.get<string>("SHOPEE_PUSH_URL") ??
      `${this.publicBase()}/api/webhooks/shopee`;
    const base = `${pushUrl}|${rawBody.toString("utf8")}`;
    const expected = createHmac("sha256", partnerKey).update(base).digest("hex");
    return this.safeEqualHex(expected, signature);
  }

  async verifyTikTok(rawBody: Buffer | undefined, signature?: string): Promise<boolean> {
    if (!rawBody || !signature) return false;
    const appKey = await this.settings.get("tiktok_app_key");
    const appSecret = await this.settings.get("tiktok_app_secret");
    if (!appKey || !appSecret) return false;
    const base = `${appKey}${rawBody.toString("utf8")}`;
    const expected = createHmac("sha256", appSecret).update(base).digest("hex");
    return this.safeEqualHex(expected, signature);
  }

  private publicBase(): string {
    return this.config.get<string>("WEBHOOK_PUBLIC_BASE_URL", "https://apitoko.cosger.online");
  }
}
