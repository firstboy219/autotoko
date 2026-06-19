import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { adminSettings } from "../../database/schema/index.js";
import { CryptoService } from "../../common/crypto/crypto.service.js";

export interface SettingMeta {
  key: string;
  description: string | null;
  hasValue: boolean;
  updatedBy: string | null;
  updatedAt: Date;
}

/**
 * Stores admin-managed credentials & config (PRD Bagian 7 / 18). All values are
 * AES-256 encrypted at rest. Keys are namespaced, e.g.:
 *   tiktok_app_key, shopee_partner_key, midtrans_server_key, sendgrid_api_key,
 *   anthropic_api_key, ai_provider, ai_model, brand_primary_color, ...
 */
@Injectable()
export class AdminSettingsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crypto: CryptoService,
  ) {}

  async set(
    key: string,
    value: string,
    description?: string,
    updatedBy?: string,
  ): Promise<void> {
    const encrypted = this.crypto.encrypt(value);
    await this.db
      .insert(adminSettings)
      .values({ key, value: encrypted, description, updatedBy })
      .onConflictDoUpdate({
        target: adminSettings.key,
        set: {
          value: encrypted,
          description,
          updatedBy,
          updatedAt: new Date(),
        },
      });
  }

  /** Decrypted value for internal use (token refresh, AI client, etc.). */
  async get(key: string): Promise<string | null> {
    const [row] = await this.db
      .select()
      .from(adminSettings)
      .where(eq(adminSettings.key, key))
      .limit(1);
    if (!row?.value) return null;
    return this.crypto.decrypt(row.value);
  }

  /** Listing for the Admin CMS — never returns plaintext secrets. */
  async list(): Promise<SettingMeta[]> {
    const rows = await this.db.select().from(adminSettings);
    return rows.map((r) => ({
      key: r.key,
      description: r.description,
      hasValue: Boolean(r.value),
      updatedBy: r.updatedBy,
      updatedAt: r.updatedAt,
    }));
  }

  /** Resolve the active AI provider/model (configurable per PRD; default Claude). */
  async getAiConfig(): Promise<{ provider: string; model: string }> {
    const provider = (await this.get("ai_provider")) ?? "anthropic";
    const model = (await this.get("ai_model")) ?? "claude-opus-4-8";
    return { provider, model };
  }
}
