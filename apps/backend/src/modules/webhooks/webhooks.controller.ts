import {
  Body,
  Controller,
  Post,
  Query,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ApiResponse } from "@autotoko/shared";
import { WebhooksService } from "./webhooks.service.js";

/**
 * Marketplace webhook receivers. Reply 200 quickly; idempotency + processing
 * live in the service (PRD Bagian 8). An optional ingest secret (appended to the
 * webhook URL as ?secret=) guards the endpoints until native signature
 * verification is wired with real app credentials.
 */
@Controller("webhooks")
export class WebhooksController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly config: ConfigService,
  ) {}

  private guard(secret?: string): void {
    const expected = this.config.get<string>("WEBHOOK_INGEST_SECRET");
    if (expected && secret !== expected) {
      throw new UnauthorizedException("Invalid webhook secret");
    }
  }

  @Post("tiktok")
  async tiktok(
    @Body() payload: unknown,
    @Query("secret") secret?: string,
  ): Promise<ApiResponse<unknown>> {
    this.guard(secret);
    return { success: true, data: await this.webhooks.handleTikTok(payload) };
  }

  @Post("shopee")
  async shopee(
    @Body() payload: unknown,
    @Query("secret") secret?: string,
  ): Promise<ApiResponse<unknown>> {
    this.guard(secret);
    return { success: true, data: await this.webhooks.handleShopee(payload) };
  }
}
