import { Controller, Get, Inject } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { ApiResponse } from "@autotoko/shared";
import { DRIZZLE, type Database } from "../../database/database.module.js";

@Controller("health")
export class HealthController {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  @Get()
  async check(): Promise<
    ApiResponse<{ status: string; db: "up" | "down"; uptime: number; ts: string }>
  > {
    let db: "up" | "down" = "down";
    try {
      await this.db.execute(sql`select 1`);
      db = "up";
    } catch {
      db = "down";
    }

    return {
      success: true,
      data: {
        status: "ok",
        db,
        uptime: process.uptime(),
        ts: new Date().toISOString(),
      },
    };
  }
}
