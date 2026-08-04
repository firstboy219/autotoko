import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { UploadsModule } from "../uploads/uploads.module.js";
import { ResiService } from "./resi.service.js";
import { ResiController } from "./resi.controller.js";
import { ResiOcrTask } from "./resi-ocr.task.js";

@Module({
  imports: [AuthModule, UploadsModule],
  controllers: [ResiController],
  providers: [ResiService, ResiOcrTask],
})
export class ResiModule {}
