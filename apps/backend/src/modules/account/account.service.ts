import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { desc, eq, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  users,
  wallets,
  shops,
  pricingConfig,
  notifications,
} from "../../database/schema/index.js";

export type PlanType = "freemium" | "starter" | "pro";
const PLANS: PlanType[] = ["freemium", "starter", "pro"];

@Injectable()
export class AccountService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Profile + onboarding status + headline account numbers. */
  async getProfile(userId: string) {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw new BadRequestException("User not found");
    const [wallet] = await this.db
      .select({ balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.userId, userId))
      .limit(1);
    const [shopCount] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(shops)
      .where(eq(shops.userId, userId));
    return {
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      whatsapp: u.whatsapp,
      planType: u.planType,
      planStartedAt: u.planStartedAt,
      createdAt: u.createdAt,
      walletBalance: wallet?.balance ?? "0",
      shopCount: shopCount?.n ?? 0,
      // New users (signed up via OTP) have no name yet → still need onboarding.
      onboarded: Boolean(u.fullName),
    };
  }

  async updateProfile(userId: string, fullName?: string) {
    if (fullName !== undefined) {
      await this.db
        .update(users)
        .set({ fullName: fullName.trim(), updatedAt: new Date() })
        .where(eq(users.id, userId));
    }
    return this.getProfile(userId);
  }

  /** Plans the seller can choose, as configured by the admin (PRD Bagian 4). */
  async listPlans() {
    const rows = await this.db.select().from(pricingConfig);
    // Stable order freemium → starter → pro.
    return rows.sort((a, b) => PLANS.indexOf(a.planType as PlanType) - PLANS.indexOf(b.planType as PlanType));
  }

  /**
   * Select / change plan. Freemium is immediate. Paid plans are set immediately
   * here too (setup-fee payment via Midtrans is a separate follow-up); kept simple
   * so onboarding & upgrade work end-to-end.
   */
  async selectPlan(userId: string, planType: string) {
    if (!PLANS.includes(planType as PlanType)) {
      throw new BadRequestException(`Paket tidak valid: ${planType}`);
    }
    await this.db
      .update(users)
      .set({ planType: planType as PlanType, planStartedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, userId));
    return this.getProfile(userId);
  }

  listNotifications(userId: string) {
    return this.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
  }
}
