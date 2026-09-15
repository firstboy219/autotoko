import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { desc, eq, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  notifications,
  orders,
  pricingConfig,
  shops,
  type NavPrefs,
  userUiPrefs,
  users,
  wallets,
} from "../../database/schema/index.js";

export type PlanType = "freemium" | "starter" | "pro";
const PLANS: PlanType[] = ["freemium", "starter", "pro"];

/** Caps chosen to be far above any real arrangement and far below abuse. */
const MAX_GROUPS = 12;
const MAX_LABEL = 40;
const MAX_ITEMS = 60;
const MAX_PATH = 64;
const MAX_COUNTED = 80;
const MAX_COUNT = 1_000_000;

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, max);
  return s || null;
}

function sanitiseNav(input: unknown): NavPrefs {
  const empty: NavPrefs = { groups: [], counts: {}, collapsed: [] };
  if (!input || typeof input !== "object") return empty;
  const raw = input as Partial<NavPrefs>;

  const groups: NavPrefs["groups"] = [];
  if (Array.isArray(raw.groups)) {
    for (const g of raw.groups.slice(0, MAX_GROUPS)) {
      const id = str((g as { id?: unknown })?.id, MAX_PATH);
      const label = str((g as { label?: unknown })?.label, MAX_LABEL);
      if (!id || !label) continue;
      const items = Array.isArray((g as { items?: unknown }).items)
        ? ((g as { items: unknown[] }).items
            .map((i) => str(i, MAX_PATH))
            .filter((i): i is string => i !== null)
            .slice(0, MAX_ITEMS))
        : [];
      // One menu item must appear once, full stop. Across groups it would
      // render twice and belong to neither; repeated inside a single group it
      // rendered three times in a row, which a check against production caught.
      const taken = new Set(groups.flatMap((x: NavPrefs["groups"][number]) => x.items));
      const unique: string[] = [];
      for (const i of items) {
        if (taken.has(i) || unique.includes(i)) continue;
        unique.push(i);
      }
      groups.push({ id, label, items: unique });
    }
  }

  const counts: Record<string, number> = {};
  if (raw.counts && typeof raw.counts === "object") {
    for (const [k, v] of Object.entries(raw.counts).slice(0, MAX_COUNTED)) {
      const key = str(k, MAX_PATH);
      const n = Number(v);
      if (key && Number.isFinite(n) && n > 0) counts[key] = Math.min(Math.floor(n), MAX_COUNT);
    }
  }

  const collapsed = Array.isArray(raw.collapsed)
    ? raw.collapsed
        .map((c: unknown) => str(c, MAX_PATH))
        .filter((c: string | null): c is string => c !== null)
        .slice(0, MAX_GROUPS)
    : [];

  return { groups, counts, collapsed };
}

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
  // ------------------------------------------------------------------
  // Sidebar arrangement
  // ------------------------------------------------------------------

  /** Empty is a valid answer: a seller who has never rearranged anything. */
  async getNav(userId: string): Promise<NavPrefs> {
    const [row] = await this.db
      .select({ nav: userUiPrefs.nav })
      .from(userUiPrefs)
      .where(eq(userUiPrefs.userId, userId))
      .limit(1);
    return sanitiseNav(row?.nav);
  }

  /**
   * Replace the whole arrangement.
   *
   * Sanitised rather than validated field by field: this is free-form data the
   * browser writes on every menu click, so the useful guarantee is that
   * whatever lands in the column stays small and well-shaped, not that a
   * malformed request gets a helpful error message.
   */
  async saveNav(userId: string, incoming: unknown): Promise<NavPrefs> {
    const nav = sanitiseNav(incoming);
    await this.db
      .insert(userUiPrefs)
      .values({ userId, nav })
      .onConflictDoUpdate({
        target: userUiPrefs.userId,
        set: { nav, updatedAt: new Date() },
      });
    return nav;
  }

  /**
   * Pemakaian vs batas paket (meter, read-only). Tidak menegakkan/gating apa pun
   * -- penegakan keras (blokir connect/order, mode baca-saja saat saldo habis)
   * adalah keputusan kebijakan yang menyentuh operasi LIVE, dibuat terpisah.
   * fees bulan ini dihitung dari orders.platform_fee (aman-RLS), bukan dari
   * wallet_transactions (yang belum ber-RLS).
   */
  async usage(userId: string) {
    const [u] = await this.db.select({ planType: users.planType }).from(users).where(eq(users.id, userId)).limit(1);
    const plan = (u?.planType ?? "freemium") as PlanType;
    const [pricing] = await this.db.select().from(pricingConfig).where(eq(pricingConfig.planType, plan)).limit(1);
    const [w] = await this.db.select({ balance: wallets.balance }).from(wallets).where(eq(wallets.userId, userId)).limit(1);
    const shopRows = await this.db.select({ id: shops.id }).from(shops).where(eq(shops.userId, userId));
    const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
    const rows = (await this.db.execute(sql`
      SELECT count(*)::int AS n,
             COALESCE(sum(platform_fee) FILTER (WHERE fee_deducted), 0)::text AS fees
        FROM orders
       WHERE user_id = ${userId} AND created_at >= ${start.toISOString()}`)) as unknown as { n: number; fees: string }[];
    const ord = rows[0] ?? { n: 0, fees: "0" };
    return {
      plan,
      monthlyFee: pricing?.monthlyFee ?? "0",
      perTransactionFee: pricing?.perTransactionFee ?? "0",
      maxShops: pricing?.maxShops ?? null,
      maxOrdersPerMonth: pricing?.maxOrdersPerMonth ?? null,
      shopsUsed: shopRows.length,
      ordersThisMonth: Number(ord.n ?? 0),
      walletBalance: w?.balance ?? "0",
      feesThisMonth: ord.fees ?? "0",
    };
  }

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
