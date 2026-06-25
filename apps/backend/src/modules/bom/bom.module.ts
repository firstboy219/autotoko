import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { BomService } from "./bom.service.js";
import { BomController } from "./bom.controller.js";

// CryptoModule + MailModule are @Global, so no need to import them here.
@Module({
  imports: [AuthModule], // JwtAuthGuard
  controllers: [BomController],
  providers: [BomService],
  exports: [BomService], // for webhooks auto-deduct
})
export class BomModule {}
