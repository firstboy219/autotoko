import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module.js";
import { AdminSettingsModule } from "../admin-settings/admin-settings.module.js";
import { WebhooksService } from "./webhooks.service.js";
import { WebhookVerifierService } from "./webhook-verifier.service.js";
import { WebhooksController } from "./webhooks.controller.js";

@Module({
  imports: [BillingModule, AdminSettingsModule], // WalletService + creds for sig verify
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookVerifierService],
})
export class WebhooksModule {}
