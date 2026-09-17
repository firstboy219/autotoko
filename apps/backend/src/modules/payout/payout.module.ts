import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { UploadsModule } from "../uploads/uploads.module.js";
import { ShopsModule } from "../shops/shops.module.js";
import { MarketplaceSyncModule } from "../marketplace-sync/marketplace-sync.module.js";
import { PayoutController } from "./payout.controller.js";
import { PayoutPortalController } from "./payout-portal.controller.js";
import { PayoutSellersService } from "./sellers.service.js";
import { PayoutBatchService } from "./batch.service.js";
import { PayoutMutationService } from "./mutation.service.js";
import { DisbursementsService } from "./disbursements.service.js";
import { OcrService } from "./ocr.service.js";
import { PayoutPortalAuthService } from "./portal-auth.service.js";
import { PortalDataService } from "./portal-data.service.js";
import { PayoutProfitService } from "./profit.service.js";
import { WithdrawalReconcileService } from "./withdrawal-reconcile.service.js";

@Module({
  imports: [AuthModule, UploadsModule, ShopsModule, MarketplaceSyncModule], // JwtAuthGuard, OcrService's local file reads, ShopsService for self-service connect
  controllers: [PayoutController, PayoutPortalController],
  providers: [
    PayoutSellersService,
    PayoutBatchService,
    PayoutMutationService,
    DisbursementsService,
    OcrService,
    PayoutPortalAuthService,
    PortalDataService,
    PayoutProfitService,
    WithdrawalReconcileService,
  ],
  exports: [PayoutSellersService, PayoutBatchService, PayoutMutationService, DisbursementsService, OcrService],
})
export class PayoutModule {}
