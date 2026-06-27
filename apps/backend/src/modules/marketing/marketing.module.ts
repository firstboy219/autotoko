import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { MarketingService } from "./marketing.service.js";
import { MarketingController } from "./marketing.controller.js";

@Module({
  imports: [AuthModule], // JwtAuthGuard
  controllers: [MarketingController],
  providers: [MarketingService],
})
export class MarketingModule {}
