import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CatalogService } from "./catalog.service.js";
import { CatalogScheduler } from "./catalog.scheduler.js";
import { CatalogController } from "./catalog.controller.js";

@Module({
  imports: [AuthModule], // JwtAuthGuard
  controllers: [CatalogController],
  providers: [CatalogService, CatalogScheduler],
  exports: [CatalogService],
})
export class CatalogModule {}
