import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { UploadsModule } from "../uploads/uploads.module.js";
import { PayoutController } from "./payout.controller.js";
import { PayoutPortalController } from "./payout-portal.controller.js";
import { PayoutSellersService } from "./sellers.service.js";
import { PayoutBatchService } from "./batch.service.js";
import { PayoutMutationService } from "./mutation.service.js";
import { DisbursementsService } from "./disbursements.service.js";
import { OcrService } from "./ocr.service.js";
import { PayoutPortalAuthService } from "./portal-auth.service.js";
import { PortalDataService } from "./portal-data.service.js";

@Module({
  imports: [AuthModule, UploadsModule], // JwtAuthGuard + OcrService reads local upload files
  controllers: [PayoutController, PayoutPortalController],
  providers: [
    PayoutSellersService,
    PayoutBatchService,
    PayoutMutationService,
    DisbursementsService,
    OcrService,
    PayoutPortalAuthService,
    PortalDataService,
  ],
  exports: [PayoutSellersService, PayoutBatchService, PayoutMutationService, DisbursementsService],
})
export class PayoutModule {}
