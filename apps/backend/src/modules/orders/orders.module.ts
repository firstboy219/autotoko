import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AdminSettingsModule } from "../admin-settings/admin-settings.module.js";
import { OrdersService } from "./orders.service.js";
import { OrdersController } from "./orders.controller.js";

@Module({
  imports: [AuthModule, AdminSettingsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
