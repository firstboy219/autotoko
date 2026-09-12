import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AdminSettingsModule } from "../admin-settings/admin-settings.module.js";
import { AiProviderService } from "./ai-provider.service.js";
import { AiService } from "./ai.service.js";
import { AutopilotLogService } from "./autopilot-log.service.js";
import { AiController } from "./ai.controller.js";

@Module({
  imports: [AuthModule, AdminSettingsModule], // JwtAuthGuard + AdminSettingsService
  controllers: [AiController],
  providers: [AiProviderService, AiService, AutopilotLogService],
  exports: [AiProviderService, AiService, AutopilotLogService], // for webhooks auto-approve, etc.
})
export class AiModule {}
