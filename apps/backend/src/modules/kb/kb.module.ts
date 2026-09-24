import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { KbService } from "./kb.service.js";
import { KbController } from "./kb.controller.js";

@Module({
  imports: [AuthModule], // JwtAuthGuard
  controllers: [KbController],
  providers: [KbService],
  exports: [KbService], // dipakai auto-reply chat/review nanti
})
export class KbModule {}
