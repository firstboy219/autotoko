import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AdminSettingsService } from "./admin-settings.service.js";
import { AdminSettingsController } from "./admin-settings.controller.js";
import { PricingService } from "./pricing.service.js";
import { PricingController } from "./pricing.controller.js";
import { SmtpSettingsController } from "./smtp-settings.controller.js";

@Module({
  imports: [AuthModule], // provides JwtAuthGuard / JwtModule
  controllers: [AdminSettingsController, PricingController, SmtpSettingsController],
  providers: [AdminSettingsService, PricingService],
  exports: [AdminSettingsService],
})
export class AdminSettingsModule {}
