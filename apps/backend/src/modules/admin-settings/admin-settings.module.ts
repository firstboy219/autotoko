import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AdminSettingsService } from "./admin-settings.service.js";
import { AdminSettingsController } from "./admin-settings.controller.js";

@Module({
  imports: [AuthModule], // provides JwtAuthGuard / JwtModule
  controllers: [AdminSettingsController],
  providers: [AdminSettingsService],
  exports: [AdminSettingsService],
})
export class AdminSettingsModule {}
