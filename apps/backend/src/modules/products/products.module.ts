import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ProductsService } from "./products.service.js";
import { ProductsController } from "./products.controller.js";

@Module({
  imports: [AuthModule], // JwtModule + guard
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
