import {
  Body,
  Controller,
  Post,
  Query,
  Req,
  UnauthorizedException,
  type RawBodyRequest,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { FastifyRequest } from "fastify";
import type { ApiResponse, Marketplace } from "@autotoko/shared";
import { WebhooksService } from "./webhooks.service.js";
import { WebhookVerifierService } from "./webhook-verifier.service.js";

/**
 * Marketplace webhook receivers. Reply 200 quickly; idempotency + processing
 * live in the service (PRD Bagian 8). A request is accepted when EITHER:
 *   1. it carries the shared ingest secret (?secret=, used by n8n / manual), OR
 *   2. it carries a valid native marketplace HMAC signature (direct from the
 *      marketplace dashboard).
 * Otherwise it is rejected (fail closed).
 */
@Controller("webhooks")
export class WebhooksController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly verifier: WebhookVerifierService,
    private readonly config: ConfigService,
  ) {}

  private signatureHeader(req: FastifyRequest): string | undefined {
    const h = req.headers;
    return (
      (h["authorization"] as string) ??
      (h["x-tts-signature"] as string) ??
      (h["x-tiktok-signature"] as string) ??
      (h["x-shopee-signature"] as string) ??
      undefined
    );
  }

  private async authorize(
    mp: Marketplace,
    req: RawBodyRequest<FastifyRequest>,
    secret?: string,
  ): Promise<void> {
    // Path 1 — shared ingest secret.
    const expected = this.config.get<string>("WEBHOOK_INGEST_SECRET");
    if (expected && secret === expected) return;

    // Path 2 — native marketplace signature over the raw body.
    const sig = this.signatureHeader(req);
    const ok =
      mp === "tiktok"
        ? await this.verifier.verifyTikTok(req.rawBody, sig)
        : await this.verifier.verifyShopee(req.rawBody, sig);
    if (ok) return;

    throw new UnauthorizedException(
      "Webhook authentication failed: no valid ?secret= and no valid signature",
    );
  }

  @Post("tiktok")
  async tiktok(
    @Req() req: RawBodyRequest<FastifyRequest>,
    @Body() payload: unknown,
    @Query("secret") secret?: string,
  ): Promise<ApiResponse<unknown>> {
    await this.authorize("tiktok", req, secret);
    return { success: true, data: await this.webhooks.handleTikTok(payload) };
  }

  @Post("shopee")
  async shopee(
    @Req() req: RawBodyRequest<FastifyRequest>,
    @Body() payload: unknown,
    @Query("secret") secret?: string,
  ): Promise<ApiResponse<unknown>> {
    await this.authorize("shopee", req, secret);
    return { success: true, data: await this.webhooks.handleShopee(payload) };
  }
}
