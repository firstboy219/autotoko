import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AdminSettingsModule } from "../admin-settings/admin-settings.module.js";
import { AiProviderService } from "./ai-provider.service.js";
import { AiService } from "./ai.service.js";
import { AiController } from "./ai.controller.js";

@Module({
  imports: [AuthModule, AdminSettingsModule], // JwtAuthGuard + AdminSettingsService
  controllers: [AiController],
  providers: [AiProviderService, AiService],
  exports: [AiProviderService, AiService], // for webhooks auto-approve, etc.
})
export class AiModule {}
