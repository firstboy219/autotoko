import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../../database/database.module.js";
import { StatementsController } from "./statements.controller.js";
import { StatementsService } from "./statements.service.js";

@Module({
  imports: [DatabaseModule, AuthModule], // AuthModule menyediakan JwtAuthGuard
  controllers: [StatementsController],
  providers: [StatementsService],
  exports: [StatementsService],
})
export class StatementsModule {}
