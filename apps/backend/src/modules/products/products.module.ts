import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { MarketplaceModule } from "../../marketplace/marketplace.module.js";
import { ProductsService } from "./products.service.js";
import { ProductSyncService } from "./product-sync.service.js";
import { ProductsController } from "./products.controller.js";

@Module({
  imports: [AuthModule, MarketplaceModule], // AuthModule: JwtModule + guard
  controllers: [ProductsController],
  providers: [ProductsService, ProductSyncService],
  exports: [ProductsService],
})
export class ProductsModule {}
