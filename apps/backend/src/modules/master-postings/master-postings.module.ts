import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ShopsModule } from "../shops/shops.module.js";
import { MarketplaceModule } from "../../marketplace/marketplace.module.js";
import { MarketplaceSyncModule } from "../marketplace-sync/marketplace-sync.module.js";
import { MasterPostingsService } from "./master-postings.service.js";
import { MasterPostingsController } from "./master-postings.controller.js";

/**
 * Master Postingan: template listing lintas toko + varian→SKU + terapkan.
 * Impor MarketplaceModule (TikTokAdapter) & ShopsModule (refresh token) untuk
 * jalur "Terapkan". CryptoService & DRIZZLE bersifat global.
 */
@Module({
  imports: [AuthModule, ShopsModule, MarketplaceModule, MarketplaceSyncModule],
  controllers: [MasterPostingsController],
  providers: [MasterPostingsService],
  exports: [MasterPostingsService],
})
export class MasterPostingsModule {}
