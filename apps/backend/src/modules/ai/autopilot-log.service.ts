import { Inject, Injectable, Logger } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { autopilotActivity } from "../../database/schema/index.js";

export interface ActivityInput {
  userId: string;
  feature: string;
  action: string;
  status: "done" | "held" | "error";
  provider?: string;
  summary?: string;
  refType?: string;
  refId?: string;
  meta?: unknown;
}

/**
 * Records AI autopilot actions to `autopilot_activity` so the seller can monitor
 * what ran automatically (owner requirement: full-auto but observable). Writes
 * are best-effort — logging must never break the action it is recording.
 */
@Injectable()
export class AutopilotLogService {
  private readonly logger = new Logger(AutopilotLogService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async record(input: ActivityInput): Promise<void> {
    try {
      await this.db.insert(autopilotActivity).values({
        userId: input.userId,
        feature: input.feature,
        action: input.action,
        status: input.status,
        provider: input.provider,
        summary: input.summary,
        refType: input.refType,
        refId: input.refId,
        meta: (input.meta as object) ?? undefined,
      });
    } catch (err) {
      this.logger.warn(`Failed to record autopilot activity: ${(err as Error).message}`);
    }
  }

  async list(userId: string, limit = 50) {
    return this.db
      .select()
      .from(autopilotActivity)
      .where(eq(autopilotActivity.userId, userId))
      .orderBy(desc(autopilotActivity.createdAt))
      .limit(Math.min(limit, 200));
  }
}
