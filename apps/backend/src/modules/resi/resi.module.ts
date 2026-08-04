import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { UploadsModule } from "../uploads/uploads.module.js";
import { AdminSettingsModule } from "../admin-settings/admin-settings.module.js";
import { ResiService } from "./resi.service.js";
import { ResiController } from "./resi.controller.js";
import { ResiOcrTask } from "./resi-ocr.task.js";
import { CourierTrackingService } from "./courier-tracking.service.js";

@Module({
  imports: [AuthModule, UploadsModule, AdminSettingsModule],
  controllers: [ResiController],
  providers: [ResiService, ResiOcrTask, CourierTrackingService],
})
export class ResiModule {}
