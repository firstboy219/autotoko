import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AccountService } from "./account.service.js";
import { AccountController } from "./account.controller.js";
import { NotificationService } from "./notification.service.js";
import { AlertsTask } from "./alerts.task.js";

@Module({
  imports: [AuthModule], // JwtAuthGuard
  controllers: [AccountController],
  providers: [AccountService, NotificationService, AlertsTask],
  exports: [NotificationService],
})
export class AccountModule {}
