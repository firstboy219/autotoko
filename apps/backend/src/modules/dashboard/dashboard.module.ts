import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DashboardService } from "./dashboard.service.js";
import { DashboardController } from "./dashboard.controller.js";

@Module({
  imports: [AuthModule], // JwtAuthGuard
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
