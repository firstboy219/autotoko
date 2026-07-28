import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, count, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  users,
  wallets,
  subSellers,
  subSubSellers,
  shops,
} from "../../database/schema/index.js";
import type { ListUsersQueryDto, UpdateUserDto } from "./dto/admin-users.dto.js";
import { invalidateSuspensionCache } from "../auth/jwt-auth.guard.js";

/**
 * Admin-only management of SELLER accounts (the `users` table — the top of
 * the platform's user hierarchy). Sub-seller and sub-sub-seller rows live
 * INSIDE a seller's account (sub_sellers.user_id / sub_sub_sellers via their
 * parent sub_seller), never as independent top-level accounts of their own —
 * so they're surfaced here read-only, nested under their owning seller
 * (detail() below), not as separate rows in the main list. Editing that
 * hierarchy is the seller's own job (existing Manajemen Sub-seller page);
 * this module only manages the seller account itself.
 */
@Injectable()
export class AdminUsersService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async list(q: ListUsersQueryDto) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;

    const conditions = [];
    if (q.search?.trim()) {
      const term = `%${q.search.trim()}%`;
      conditions.push(
        or(ilike(users.fullName, term), ilike(users.email, term), ilike(users.whatsapp, term)),
      );
    }
    if (q.plan) conditions.push(eq(users.planType, q.plan));
    if (q.status === "suspended") conditions.push(eq(users.isSuspended, true));
    if (q.status === "inactive") conditions.push(eq(users.isActive, false));
    if (q.status === "active") {
      conditions.push(and(eq(users.isActive, true), eq(users.isSuspended, false)));
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const totalRows = await this.db.select({ total: count() }).from(users).where(where);
    const total = totalRows[0]!.total;
    const rows = await this.db
      .select()
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const ids = rows.map((r) => r.id);
    const [walletRows, subCounts, subSubCounts, shopCounts] = ids.length
      ? await Promise.all([
          this.db.select().from(wallets).where(inArray(wallets.userId, ids)),
          this.db
            .select({ userId: subSellers.userId, n: count() })
            .from(subSellers)
            .where(inArray(subSellers.userId, ids))
            .groupBy(subSellers.userId),
          this.db
            .select({ userId: subSubSellers.userId, n: count() })
            .from(subSubSellers)
            .where(inArray(subSubSellers.userId, ids))
            .groupBy(subSubSellers.userId),
          this.db
            .select({ userId: shops.userId, n: count() })
            .from(shops)
            .where(inArray(shops.userId, ids))
            .groupBy(shops.userId),
        ])
      : [[], [], [], []];

    const walletByUser = new Map(walletRows.map((w) => [w.userId, w.balance]));
    const subByUser = new Map(subCounts.map((r) => [r.userId, Number(r.n)]));
    const subSubByUser = new Map(subSubCounts.map((r) => [r.userId, Number(r.n)]));
    const shopByUser = new Map(shopCounts.map((r) => [r.userId, Number(r.n)]));

    return {
      items: rows.map((u) => ({
        id: u.id,
        email: u.email,
        whatsapp: u.whatsapp,
        fullName: u.fullName,
        planType: u.planType,
        planExpiredAt: u.planExpiredAt,
        isActive: u.isActive,
        isSuspended: u.isSuspended,
        createdAt: u.createdAt,
        walletBalance: walletByUser.get(u.id) ?? "0",
        subSellerCount: subByUser.get(u.id) ?? 0,
        subSubSellerCount: subSubByUser.get(u.id) ?? 0,
        shopCount: shopByUser.get(u.id) ?? 0,
      })),
      total: Number(total),
      page,
      pageSize,
    };
  }

  /** Seller detail, including their full sub-seller/sub-sub-seller hierarchy (read-only here). */
  async detail(id: string) {
    const [u] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!u) throw new NotFoundException("User not found");

    const [wallet] = await this.db.select().from(wallets).where(eq(wallets.userId, id)).limit(1);
    const shopCountRows = await this.db
      .select({ n: count() })
      .from(shops)
      .where(eq(shops.userId, id));
    const shopCount = shopCountRows[0]!.n;

    const subs = await this.db
      .select()
      .from(subSellers)
      .where(eq(subSellers.userId, id))
      .orderBy(desc(subSellers.createdAt));
    const subIds = subs.map((s) => s.id);
    const subsubs = subIds.length
      ? await this.db.select().from(subSubSellers).where(inArray(subSubSellers.subSellerId, subIds))
      : [];
    const subsubBySubId = new Map<string, typeof subsubs>();
    for (const ss of subsubs) {
      const arr = subsubBySubId.get(ss.subSellerId) ?? [];
      arr.push(ss);
      subsubBySubId.set(ss.subSellerId, arr);
    }

    return {
      id: u.id,
      email: u.email,
      whatsapp: u.whatsapp,
      fullName: u.fullName,
      planType: u.planType,
      planStartedAt: u.planStartedAt,
      planExpiredAt: u.planExpiredAt,
      isActive: u.isActive,
      isSuspended: u.isSuspended,
      createdAt: u.createdAt,
      walletBalance: wallet?.balance ?? "0",
      shopCount: Number(shopCount),
      hierarchy: subs.map((s) => ({
        id: s.id,
        name: s.name,
        contact: s.contact,
        bankAccount: s.bankAccount,
        defaultRate: s.defaultRate,
        status: s.status,
        subSubSellers: (subsubBySubId.get(s.id) ?? []).map((ss) => ({
          id: ss.id,
          name: ss.name,
          contact: ss.contact,
          bankAccount: ss.bankAccount,
          defaultRate: ss.defaultRate,
          status: ss.status,
        })),
      })),
    };
  }

  async update(id: string, dto: UpdateUserDto) {
    await this.getOrThrow(id);
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.fullName != null) set.fullName = dto.fullName;
    if (dto.planType != null) set.planType = dto.planType;
    if (dto.planExpiredAt !== undefined) {
      set.planExpiredAt = dto.planExpiredAt ? new Date(dto.planExpiredAt) : null;
    }
    const [row] = await this.db.update(users).set(set).where(eq(users.id, id)).returning();
    return row;
  }

  /** Suspend takes effect on that user's very NEXT request (JwtAuthGuard checks isSuspended live). */
  async suspend(id: string) {
    await this.getOrThrow(id);
    const [row] = await this.db
      .update(users)
      .set({ isSuspended: true, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    invalidateSuspensionCache(id);
    return row;
  }

  async unsuspend(id: string) {
    await this.getOrThrow(id);
    const [row] = await this.db
      .update(users)
      .set({ isSuspended: false, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    invalidateSuspensionCache(id);
    return row;
  }

  /** Hard delete. Cascades to wallets/shops/sub-sellers/payout data via existing FKs. */
  async remove(id: string) {
    await this.getOrThrow(id);
    await this.db.delete(users).where(eq(users.id, id));
    invalidateSuspensionCache(id);
    return { id, deleted: true };
  }

  private async getOrThrow(id: string) {
    const [row] = await this.db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    if (!row) throw new NotFoundException("User not found");
    return row;
  }
}
