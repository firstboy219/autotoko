import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { AiModule } from "../ai/ai.module.js";
import { ProductsService } from "./products.service.js";
import { ProductsController } from "./products.controller.js";

@Module({
  imports: [AuthModule, AiModule, BillingModule], // JwtModule + guard, lalu SaranService
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
