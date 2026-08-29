import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../../database/database.module.js";
import { MeController } from "./me.controller.js";
import { StaffController } from "./staff.controller.js";
import { StaffService } from "./staff.service.js";

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [StaffController, MeController],
  providers: [StaffService],
  exports: [StaffService],
})
export class StaffModule {}
