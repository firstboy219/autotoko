import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { MarketplaceModule } from "../../marketplace/marketplace.module.js";
import { OrdersService } from "./orders.service.js";
import { OrderSyncService } from "./order-sync.service.js";
import { FulfillmentSyncService } from "./fulfillment-sync.service.js";
import { OrdersController } from "./orders.controller.js";

@Module({
  imports: [AuthModule, MarketplaceModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderSyncService, FulfillmentSyncService],
})
export class OrdersModule {}
