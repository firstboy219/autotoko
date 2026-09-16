import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ShopsModule } from "../shops/shops.module.js";
import { MarketplaceModule } from "../../marketplace/marketplace.module.js";
import { UploadsModule } from "../uploads/uploads.module.js";
import { MarketplaceSyncService } from "./marketplace-sync.service.js";
import { MarketplaceSyncTask } from "./marketplace-sync.task.js";
import { MarketplaceSyncController } from "./marketplace-sync.controller.js";

/**
 * Modul sendiri, bukan bagian dari ShopsModule atau MarketplaceModule:
 * ShopsModule sudah mengimpor MarketplaceModule, dan sinkronisasi butuh
 * keduanya. Menaruhnya di salah satu membuat impor melingkar.
 */
@Module({
  imports: [AuthModule, ShopsModule, MarketplaceModule, UploadsModule],
  controllers: [MarketplaceSyncController],
  providers: [MarketplaceSyncService, MarketplaceSyncTask],
  exports: [MarketplaceSyncService],
})
export class MarketplaceSyncModule {}
