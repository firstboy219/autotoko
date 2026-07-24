import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { UploadsController } from "./uploads.controller.js";
import { UploadsService } from "./uploads.service.js";

@Module({
  imports: [AuthModule], // JwtAuthGuard on the upload route
  controllers: [UploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
