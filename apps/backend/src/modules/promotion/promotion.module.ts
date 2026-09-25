import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { MarketplaceSyncModule } from "../marketplace-sync/marketplace-sync.module.js";
import { PromotionController } from "./promotion.controller.js";
import { PromotionAutomationService } from "./promotion-automation.service.js";
import { PromoCardsService } from "./promo-cards.service.js";

@Module({
  imports: [AuthModule, MarketplaceSyncModule],
  controllers: [PromotionController],
  providers: [PromotionAutomationService, PromoCardsService],
})
export class PromotionModule {}
