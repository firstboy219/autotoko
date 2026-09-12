import { Inject, Injectable, Logger } from "@nestjs/common";
import { eq, inArray, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { masterProducts, productPostings, users } from "../../database/schema/index.js";

export type HealthScore = "A" | "B" | "C" | "D";

export interface ProductHealth {
  id: string;
  name: string;
  sku: string;
  status: string;
  score: HealthScore;
  sold7d: number;
  views7d: number;
  gmv7d: number;
  conversion: number; // sold / views
  reviewScore: number | null;
  reviewCount: number;
  eliminationCandidate: boolean;
  reasons: string[];
}

/**
 * Catalog evaluation (PRD Bagian 8.15 Evaluasi Katalog + 8.16 Eliminate). Computes
 * a Product Health Score (A/B/C/D) from posting aggregates and persists it to
 * masterProducts.healthScore. Rule-based (deterministic, no AI/cred dependency);
 * AI rewrite suggestions are a separate, on-demand feature (8.17 via /api/ai).
 */
@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  private scoreOf(points: number): HealthScore {
    if (points >= 6) return "A";
    if (points >= 4) return "B";
    if (points >= 2) return "C";
    return "D";
  }

  /** Evaluate every product for a user, persist scores, return the breakdown. */
  async evaluate(userId: string): Promise<ProductHealth[]> {
    const masters = await this.db
      .select()
      .from(masterProducts)
      .where(eq(masterProducts.userId, userId));
    if (masters.length === 0) return [];

    const ids = masters.map((m) => m.id);
    const aggs = await this.db
      .select({
        masterId: productPostings.masterProductId,
        sold7d: sql<number>`coalesce(sum(${productPostings.sold7d}), 0)::int`,
        views7d: sql<number>`coalesce(sum(${productPostings.views7d}), 0)::int`,
        gmv7d: sql<string>`coalesce(sum(${productPostings.gmv7d}), 0)`,
        reviewCount: sql<number>`coalesce(sum(${productPostings.reviewCount}), 0)::int`,
        // review score weighted by review count (avg of avgs is misleading)
        reviewWeighted: sql<string>`coalesce(sum(${productPostings.reviewScore} * ${productPostings.reviewCount}), 0)`,
      })
      .from(productPostings)
      .where(inArray(productPostings.masterProductId, ids))
      .groupBy(productPostings.masterProductId);
    const byId = new Map(aggs.map((a) => [a.masterId, a]));

    const result: ProductHealth[] = [];
    for (const m of masters) {
      const a = byId.get(m.id);
      const sold = a?.sold7d ?? 0;
      const views = a?.views7d ?? 0;
      const gmv = Number(a?.gmv7d ?? 0);
      const reviewCount = a?.reviewCount ?? 0;
      const reviewScore = reviewCount > 0 ? Number(a?.reviewWeighted ?? 0) / reviewCount : null;
      const conversion = views > 0 ? sold / views : 0;

      let points = 0;
      const reasons: string[] = [];
      if (gmv >= 1_000_000) points += 3;
      else if (gmv >= 300_000) points += 2;
      else if (gmv > 0) points += 1;
      else reasons.push("Tidak ada GMV 7 hari");

      if (sold >= 20) points += 2;
      else if (sold >= 5) points += 1;
      else if (sold === 0) reasons.push("Tidak ada penjualan 7 hari");

      if (conversion >= 0.1) points += 2;
      else if (conversion >= 0.03) points += 1;

      if (reviewScore != null) {
        if (reviewScore >= 4.5) points += 2;
        else if (reviewScore >= 4.0) points += 1;
        else if (reviewScore < 3.0) {
          points -= 2;
          reasons.push(`Rating rendah (${reviewScore.toFixed(1)})`);
        }
      }

      const score = this.scoreOf(points);
      const eliminationCandidate =
        (sold === 0 && gmv === 0) || (reviewScore != null && reviewScore < 3.0);
      if (eliminationCandidate && reasons.length === 0) reasons.push("Performa rendah");

      // Persist the health score on the master product (existing column).
      await this.db
        .update(masterProducts)
        .set({ healthScore: score, updatedAt: new Date() })
        .where(eq(masterProducts.id, m.id));

      result.push({
        id: m.id,
        name: m.name,
        sku: m.sku,
        status: m.status,
        score,
        sold7d: sold,
        views7d: views,
        gmv7d: gmv,
        conversion: Math.round(conversion * 1000) / 1000,
        reviewScore: reviewScore != null ? Math.round(reviewScore * 100) / 100 : null,
        reviewCount,
        eliminationCandidate,
        reasons,
      });
    }
    // Worst first so attention items surface at the top.
    result.sort((x, y) => "DCBA".indexOf(x.score) - "DCBA".indexOf(y.score));
    return result;
  }

  /** Weekly cron: evaluate every seller's catalog. */
  async evaluateAllUsers(): Promise<number> {
    const all = await this.db.select({ id: users.id }).from(users);
    let n = 0;
    for (const u of all) {
      try {
        await this.evaluate(u.id);
        n++;
      } catch (e) {
        this.logger.warn(`Catalog eval failed for ${u.id}: ${(e as Error).message}`);
      }
    }
    this.logger.log(`Evaluated catalog for ${n} user(s).`);
    return n;
  }
}
