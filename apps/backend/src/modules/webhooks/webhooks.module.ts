import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module.js";
import { WebhooksService } from "./webhooks.service.js";
import { WebhooksController } from "./webhooks.controller.js";

@Module({
  imports: [BillingModule], // WalletService for per-transaction fee
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
