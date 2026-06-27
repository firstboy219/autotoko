import { Inject, Injectable } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { affiliates, chatLogs, reviewLogs, shops } from "../../database/schema/index.js";

/**
 * Read-only views over the AI/affiliate activity (PRD 8.2/8.10/8.12). Chat &
 * review logs are tenant-scoped by joining the user's shops (those rows carry
 * shop_id, not user_id); affiliates carry user_id directly.
 */
@Injectable()
export class MarketingService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  listAffiliates(userId: string) {
    return this.db
      .select()
      .from(affiliates)
      .where(eq(affiliates.userId, userId))
      .orderBy(desc(affiliates.totalGmv));
  }

  async listChatLogs(userId: string) {
    const rows = await this.db
      .select({ chat: chatLogs })
      .from(chatLogs)
      .innerJoin(shops, eq(chatLogs.shopId, shops.id))
      .where(eq(shops.userId, userId))
      .orderBy(desc(chatLogs.createdAt))
      .limit(50);
    return rows.map((r) => r.chat);
  }

  async listReviewLogs(userId: string) {
    const rows = await this.db
      .select({ review: reviewLogs })
      .from(reviewLogs)
      .innerJoin(shops, eq(reviewLogs.shopId, shops.id))
      .where(eq(shops.userId, userId))
      .orderBy(desc(reviewLogs.createdAt))
      .limit(50);
    return rows.map((r) => r.review);
  }
}
