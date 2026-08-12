import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CostingModule } from "../costing/costing.module.js";
import { DashboardService } from "./dashboard.service.js";
import { PendingTasksService } from "./pending-tasks.service.js";
import { ShopInsightsService } from "./shop-insights.service.js";
import { DashboardController } from "./dashboard.controller.js";

@Module({
  imports: [AuthModule, CostingModule], // JwtAuthGuard + biaya bahan per produk
  controllers: [DashboardController],
  providers: [DashboardService, PendingTasksService, ShopInsightsService],
})
export class DashboardModule {}
