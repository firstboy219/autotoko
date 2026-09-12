import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module.js";
import { AdminSettingsModule } from "../admin-settings/admin-settings.module.js";
import { BomModule } from "../bom/bom.module.js";
import { AiModule } from "../ai/ai.module.js";
import { WebhooksService } from "./webhooks.service.js";
import { WebhookVerifierService } from "./webhook-verifier.service.js";
import { WebhooksController } from "./webhooks.controller.js";

@Module({
  imports: [BillingModule, AdminSettingsModule, BomModule, AiModule], // wallet + creds + BOM + AI autopilot
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookVerifierService],
})
export class WebhooksModule {}
