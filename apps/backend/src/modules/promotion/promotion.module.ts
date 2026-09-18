import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { MarketplaceSyncModule } from "../marketplace-sync/marketplace-sync.module.js";
import { PromotionController } from "./promotion.controller.js";

@Module({
  imports: [AuthModule, MarketplaceSyncModule],
  controllers: [PromotionController],
})
export class PromotionModule {}
