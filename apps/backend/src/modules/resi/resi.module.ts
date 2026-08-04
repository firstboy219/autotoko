import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ResiService } from "./resi.service.js";
import { ResiController } from "./resi.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [ResiController],
  providers: [ResiService],
})
export class ResiModule {}
