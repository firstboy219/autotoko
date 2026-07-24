import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PayoutController } from "./payout.controller.js";
import { PayoutSellersService } from "./sellers.service.js";
import { PayoutBatchService } from "./batch.service.js";
import { PayoutMutationService } from "./mutation.service.js";

@Module({
  imports: [AuthModule], // JwtAuthGuard needs JwtService
  controllers: [PayoutController],
  providers: [PayoutSellersService, PayoutBatchService, PayoutMutationService],
  exports: [PayoutSellersService, PayoutBatchService, PayoutMutationService],
})
export class PayoutModule {}
