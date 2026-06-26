import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ReportsService } from "./reports.service.js";

const TZ = { timeZone: "Asia/Jakarta" };

/**
 * Cron triggers for recap reports (PRD Bagian 8.9). Times are Asia/Jakarta:
 *   daily   23:55 every day
 *   weekly  Monday 07:00 (covers the previous Mon–Sun)
 *   monthly 1st 07:00 (covers the previous calendar month)
 */
@Injectable()
export class ReportsScheduler {
  private readonly logger = new Logger(ReportsScheduler.name);

  constructor(private readonly reports: ReportsService) {}

  @Cron("55 23 * * *", TZ)
  async daily() {
    this.logger.log("Cron: daily report");
    await this.reports.sendToAll("daily");
  }

  @Cron("0 7 * * 1", TZ)
  async weekly() {
    this.logger.log("Cron: weekly report");
    await this.reports.sendToAll("weekly");
  }

  @Cron("0 7 1 * *", TZ)
  async monthly() {
    this.logger.log("Cron: monthly report");
    await this.reports.sendToAll("monthly");
  }
}
