import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AccountService } from "./account.service.js";
import { AccountController } from "./account.controller.js";

@Module({
  imports: [AuthModule], // JwtAuthGuard
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
