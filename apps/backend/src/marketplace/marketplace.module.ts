import { Module } from "@nestjs/common";
import { AdminSettingsModule } from "../modules/admin-settings/admin-settings.module.js";
import { TikTokAdapter } from "./adapters/tiktok.adapter.js";
import { ShopeeAdapter } from "./adapters/shopee.adapter.js";
import { MarketplaceService } from "./marketplace.service.js";

@Module({
  imports: [AdminSettingsModule],
  providers: [TikTokAdapter, ShopeeAdapter, MarketplaceService],
  exports: [MarketplaceService],
})
export class MarketplaceModule {}
