import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AdminSettingsService } from "./admin-settings.service.js";
import { AdminSettingsController } from "./admin-settings.controller.js";
import { PricingService } from "./pricing.service.js";
import { PricingController } from "./pricing.controller.js";
import { SmtpSettingsController } from "./smtp-settings.controller.js";
import { OrderConfigController } from "./order-config.controller.js";
import { PackagesService } from "./packages.service.js";
import { PackagesController } from "./packages.controller.js";

@Module({
  imports: [AuthModule], // provides JwtAuthGuard / JwtModule
  controllers: [AdminSettingsController, PricingController, SmtpSettingsController, OrderConfigController, PackagesController],
  providers: [AdminSettingsService, PricingService, PackagesService],
  exports: [AdminSettingsService],
})
export class AdminSettingsModule {}
