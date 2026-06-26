import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { CatalogService } from "./catalog.service.js";

/**
 * Weekly catalog evaluation (PRD Bagian 8.15 — "setiap Minggu malam").
 * Sunday 22:00 Asia/Jakarta.
 */
@Injectable()
export class CatalogScheduler {
  private readonly logger = new Logger(CatalogScheduler.name);

  constructor(private readonly catalog: CatalogService) {}

  @Cron("0 22 * * 0", { timeZone: "Asia/Jakarta" })
  async weekly() {
    this.logger.log("Cron: weekly catalog evaluation");
    await this.catalog.evaluateAllUsers();
  }
}
