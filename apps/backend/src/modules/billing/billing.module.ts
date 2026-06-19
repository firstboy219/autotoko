import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AdminSettingsModule } from "../admin-settings/admin-settings.module.js";
import { MidtransService } from "./midtrans.service.js";
import { WalletService } from "./wallet.service.js";
import { WalletController } from "./wallet.controller.js";

@Module({
  imports: [AuthModule, AdminSettingsModule],
  controllers: [WalletController],
  providers: [MidtransService, WalletService],
  exports: [WalletService], // for per-transaction billing in the orders module
})
export class BillingModule {}
