import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CostingController } from "./costing.controller.js";
import { CostingService } from "./costing.service.js";

@Module({
  imports: [AuthModule], // provides JwtAuthGuard / JwtModule
  controllers: [CostingController],
  providers: [CostingService],
})
export class CostingModule {}
