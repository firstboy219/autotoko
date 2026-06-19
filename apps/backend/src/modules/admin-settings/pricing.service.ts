import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { pricingConfig } from "../../database/schema/index.js";

type PlanType = "freemium" | "starter" | "pro";

export interface PricingInput {
  setupFee?: string;
  monthlyFee?: string;
  perTransactionFee?: string;
  maxShops?: number;
  maxOrdersPerMonth?: number;
  isActive?: boolean;
}

// PRD Bagian 4 / 7 — per-plan pricing set by admin; consumed by per-tx billing.
@Injectable()
export class PricingService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  list() {
    return this.db.select().from(pricingConfig);
  }

  async upsert(planType: PlanType, input: PricingInput) {
    const [existing] = await this.db
      .select({ id: pricingConfig.id })
      .from(pricingConfig)
      .where(eq(pricingConfig.planType, planType))
      .limit(1);

    if (existing) {
      const [row] = await this.db
        .update(pricingConfig)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(pricingConfig.id, existing.id))
        .returning();
      return row;
    }
    const [row] = await this.db
      .insert(pricingConfig)
      .values({ planType, ...input })
      .returning();
    return row;
  }
}
