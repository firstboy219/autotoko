import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { StockRequestsController } from "./stock-requests.controller.js";
import { StockRequestsService } from "./stock-requests.service.js";

@Module({
  imports: [AuthModule],
  controllers: [StockRequestsController],
  providers: [StockRequestsService],
  exports: [StockRequestsService],
})
export class StockRequestsModule {}
