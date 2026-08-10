import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { UploadsModule } from "../uploads/uploads.module.js";
import { PayoutModule } from "../payout/payout.module.js";
import { MaterialsController } from "./materials.controller.js";
import { MaterialsService } from "./materials.service.js";
import { OcrMemoryService } from "../resi/ocr-memory.service.js";
import { MaterialConsumptionService } from "./material-consumption.service.js";

@Module({
  // PayoutModule exports OcrService, reused here for receipt text.
  imports: [AuthModule, UploadsModule, PayoutModule],
  controllers: [MaterialsController],
  providers: [MaterialsService, MaterialConsumptionService, OcrMemoryService],
  exports: [MaterialsService, MaterialConsumptionService],
})
export class MaterialsModule {}
