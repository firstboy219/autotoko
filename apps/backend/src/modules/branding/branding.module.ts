import { Module } from "@nestjs/common";
import { AdminSettingsModule } from "../admin-settings/admin-settings.module.js";
import { BrandingService } from "./branding.service.js";
import { BrandingController } from "./branding.controller.js";

@Module({
  imports: [AdminSettingsModule], // AdminSettingsService (brand_* keys)
  controllers: [BrandingController],
  providers: [BrandingService],
})
export class BrandingModule {}
