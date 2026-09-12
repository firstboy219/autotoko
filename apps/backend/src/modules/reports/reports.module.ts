import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ReportsService } from "./reports.service.js";
import { ReportsScheduler } from "./reports.scheduler.js";
import { ReportsController } from "./reports.controller.js";

// MailModule is @Global; ScheduleModule is registered (forRoot) in AppModule.
@Module({
  imports: [AuthModule], // JwtAuthGuard
  controllers: [ReportsController],
  providers: [ReportsService, ReportsScheduler],
  exports: [ReportsService],
})
export class ReportsModule {}
