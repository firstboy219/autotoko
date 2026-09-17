import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { MarketplaceModule } from "../../marketplace/marketplace.module.js";
import { ShopsService } from "./shops.service.js";
import { ShopsController } from "./shops.controller.js";
import { TokenRefreshTask } from "./token-refresh.task.js";

@Module({
  imports: [AuthModule, MarketplaceModule, BillingModule], // AuthModule provides JwtModule + guard
  controllers: [ShopsController],
  providers: [ShopsService, TokenRefreshTask],
  exports: [ShopsService],
})
export class ShopsModule {}
