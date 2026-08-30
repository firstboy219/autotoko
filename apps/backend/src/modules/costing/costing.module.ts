import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AiModule } from "../ai/ai.module.js";
import { CostingController } from "./costing.controller.js";
import { CostingService } from "./costing.service.js";

@Module({
  imports: [AuthModule, AiModule], // JwtAuthGuard / JwtModule, lalu SaranService
  controllers: [CostingController],
  providers: [CostingService],
  // The dashboard asks what a product's materials cost. Exported rather than
  // reimplemented there, so both pages answer with the same arithmetic.
  exports: [CostingService],
})
export class CostingModule {}
