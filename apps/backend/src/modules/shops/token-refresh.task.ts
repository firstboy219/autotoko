import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { ShopsService } from "./shops.service.js";
import { TenantService } from "../../database/tenant.service.js";

/**
 * Auto-refresh marketplace tokens (PRD Bagian 5.5). Runs hourly — covers
 * Shopee's aggressive 4h expiry and TikTok's 7d. n8n can also trigger
 * refreshExpiring() on schedule; both are safe (idempotent).
 */
@Injectable()
export class TokenRefreshTask {
  private readonly logger = new Logger(TokenRefreshTask.name);

  constructor(
    private readonly shops: ShopsService,
    private readonly tenant: TenantService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handle(): Promise<void> {
    try {
      await this.tenant.runBypass(() => this.shops.refreshExpiring());
    } catch (e) {
      this.logger.error(`Token refresh cron failed: ${(e as Error).message}`);
    }
  }
}
