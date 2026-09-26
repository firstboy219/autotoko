import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gte, lte, lt, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  orders,
  shops,
  resiScans,
  wallets,
  bomItems,
  masterProducts,
} from "../../database/schema/index.js";

const WALLET_LOW_THRESHOLD = 150000; // IDR; below this → low-wallet alert
const TOKEN_EXPIRY_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // warn 3 days ahead

@Injectable()
export class DashboardService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** UTC instant of today's 00:00 in Asia/Jakarta (UTC+7, no DST). */
  private jakartaStartOfDay(): Date {
    const now = Date.now();
    const jak = new Date(now + 7 * 3600 * 1000);
    return new Date(
      Date.UTC(jak.getUTCFullYear(), jak.getUTCMonth(), jak.getUTCDate()) - 7 * 3600 * 1000,
    );
  }

  /** Seller dashboard headline numbers (PRD Bagian 12 — dashboard). */
  /**
   * Deret harian (WIB) untuk grafik BI dashboard: order & omzet (per tanggal
   * order dibuat di marketplace), paket dipacking (resi discan), dan order
   * dibatalkan (per waktu batal marketplace). Sumbu tanggal diisi penuh (hari
   * kosong = 0) supaya laju tak menyesatkan.
   */
  async dailySeries(userId: string, days = 14) {
    const n = Math.min(60, Math.max(2, Math.floor(days) || 14));
    const start = this.jakartaStartOfDay();
    const since = new Date(start.getTime() - (n - 1) * 86400000);
    const sinceIso = since.toISOString();
    const rows = async (q: ReturnType<typeof sql>) => {
      const res = (await this.db.execute(q)) as unknown;
      if (Array.isArray(res)) return res as Record<string, unknown>[];
      return ((res as { rows?: Record<string, unknown>[] })?.rows ?? []);
    };

    const ordRows = await rows(sql`
      SELECT to_char((COALESCE(created_at_marketplace, created_at) AT TIME ZONE 'Asia/Jakarta')::date,'YYYY-MM-DD') AS d,
             count(*)::int AS n, COALESCE(sum(total_amount),0)::float AS rev
      FROM orders WHERE user_id = ${userId} AND COALESCE(created_at_marketplace, created_at) >= ${sinceIso}::timestamptz
      GROUP BY d`);
    const canRows = await rows(sql`
      SELECT to_char((to_timestamp(nullif(coalesce(raw->>'cancel_time', raw->>'update_time'),'')::bigint) AT TIME ZONE 'Asia/Jakarta')::date,'YYYY-MM-DD') AS d,
             count(*)::int AS n
      FROM orders WHERE user_id = ${userId}
        AND (fulfillment_status = 'dibatalkan' OR status IN ('CANCELLED','CANCELED'))
        AND to_timestamp(nullif(coalesce(raw->>'cancel_time', raw->>'update_time'),'')::bigint) >= ${sinceIso}::timestamptz
      GROUP BY d`);
    const packRows = await rows(sql`
      SELECT to_char((scanned_at AT TIME ZONE 'Asia/Jakarta')::date,'YYYY-MM-DD') AS d, count(*)::int AS n
      FROM resi_scans WHERE user_id = ${userId} AND scanned_at >= ${sinceIso}::timestamptz GROUP BY d`);

    const mapN = (rs: Record<string, unknown>[], key = 'n') => {
      const m = new Map<string, number>();
      for (const r of rs) m.set(String(r.d), Number(r[key] ?? 0));
      return m;
    };
    const mo = mapN(ordRows), mrev = mapN(ordRows, 'rev'), mc = mapN(canRows), mp = mapN(packRows);
    const series: Array<{ date: string; orders: number; revenue: number; packed: number; cancelled: number }> = [];
    for (let i = 0; i < n; i++) {
      const dt = new Date(since.getTime() + i * 86400000 + 7 * 3600000);
      const key = dt.toISOString().slice(0, 10);
      series.push({ date: key, orders: mo.get(key) ?? 0, revenue: Math.round(mrev.get(key) ?? 0), packed: mp.get(key) ?? 0, cancelled: mc.get(key) ?? 0 });
    }
    const sum = (k: 'orders' | 'revenue' | 'packed' | 'cancelled') => series.reduce((a, x) => a + x[k], 0);
    return { days: n, tz: 'WIB', series, totals: { orders: sum('orders'), revenue: sum('revenue'), packed: sum('packed'), cancelled: sum('cancelled') } };
  }

  async summary(userId: string) {
    const start = this.jakartaStartOfDay();

    const [today] = await this.db
      .select({
        orders: sql<number>`count(*)::int`,
        revenue: sql<string>`coalesce(sum(${orders.totalAmount}), 0)`,
      })
      .from(orders)
      .where(and(eq(orders.userId, userId), gte(orders.createdAt, start)));

    const [all] = await this.db
      .select({
        orders: sql<number>`count(*)::int`,
        revenue: sql<string>`coalesce(sum(${orders.totalAmount}), 0)`,
        feeCharged: sql<string>`coalesce(sum(${orders.platformFee}), 0)`,
      })
      .from(orders)
      .where(eq(orders.userId, userId));

    const [activeShops] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(shops)
      .where(and(eq(shops.userId, userId), eq(shops.shopStatus, "active")));

    return {
      today_orders: today?.orders ?? 0,
      today_revenue: today?.revenue ?? "0",
      active_shops: activeShops?.count ?? 0,
      total_orders: all?.orders ?? 0,
      total_revenue: all?.revenue ?? "0",
      total_fee_charged: all?.feeCharged ?? "0",
    };
  }

  /**
   * Komposisi order HARI INI (waktu Jakarta): kontribusi tiap toko + produk
   * apa saja yang terbeli beserta qty-nya. Read-only, tenant-scoped. Dipakai
   * APK saat kartu ringkasan "Order & omzet" diklik.
   */
  async todayComposition(userId: string) {
    const start = this.jakartaStartOfDay();
    const rows = await this.db
      .select({
        shopId: orders.shopId,
        shopName: sql<string>`coalesce(${shops.displayName}, ${shops.shopName}, '(tanpa toko)')`,
        totalAmount: orders.totalAmount,
        items: orders.items,
      })
      .from(orders)
      .leftJoin(shops, eq(shops.id, orders.shopId))
      .where(and(eq(orders.userId, userId), gte(orders.createdAt, start)));

    const perShop = new Map<string, { shopId: string | null; shopName: string; orders: number; revenue: number }>();
    const prod = new Map<string, { name: string; qty: number; orders: number }>();
    let totalOrders = 0;
    let totalRevenue = 0;

    for (const r of rows) {
      totalOrders += 1;
      const rev = r.totalAmount != null ? Number(r.totalAmount) : 0;
      totalRevenue += rev;
      const key = r.shopId ?? "?";
      if (!perShop.has(key)) perShop.set(key, { shopId: r.shopId, shopName: r.shopName, orders: 0, revenue: 0 });
      const ps = perShop.get(key)!;
      ps.orders += 1;
      ps.revenue += rev;

      const items = Array.isArray(r.items) ? (r.items as Array<Record<string, unknown>>) : [];
      const seen = new Set<string>();
      for (const it of items) {
        const nama = String(
          (it?.name ?? it?.skuName ?? it?.sellerSku ?? it?.skuId ?? "(tanpa nama)") as string,
        );
        const qty = Number(it?.quantity ?? it?.qty ?? it?.count ?? 1) || 0;
        if (!prod.has(nama)) prod.set(nama, { name: nama, qty: 0, orders: 0 });
        const pm = prod.get(nama)!;
        pm.qty += qty;
        if (!seen.has(nama)) { pm.orders += 1; seen.add(nama); }
      }
    }

    return {
      totalOrders,
      totalRevenue: String(totalRevenue),
      perShop: [...perShop.values()]
        .sort((a, b) => b.orders - a.orders)
        .map((s) => ({ shopId: s.shopId, shopName: s.shopName, orders: s.orders, revenue: String(s.revenue) })),
      products: [...prod.values()].sort((a, b) => b.qty - a.qty),
    };
  }

  /** Actionable alert cards: low BOM stock, low wallet, soon-expiring tokens. */
  async alerts(userId: string) {
    // Low stock — bom_items whose master belongs to the user.
    const lowStockRows = await this.db
      .select({
        id: bomItems.id,
        name: bomItems.materialName,
        current: bomItems.currentStock,
        min: bomItems.minimumThreshold,
        unit: bomItems.unit,
      })
      .from(bomItems)
      .innerJoin(masterProducts, eq(bomItems.masterProductId, masterProducts.id))
      .where(
        and(
          eq(masterProducts.userId, userId),
          lte(bomItems.currentStock, bomItems.minimumThreshold),
        ),
      );
    const low_stock = lowStockRows.map((r) => ({
      id: r.id,
      name: r.name,
      current: Number(r.current),
      min: Number(r.min),
      unit: r.unit,
    }));

    // Low wallet.
    const [wallet] = await this.db
      .select({ balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.userId, userId))
      .limit(1);
    const balance = Number(wallet?.balance ?? 0);
    const low_wallet =
      balance < WALLET_LOW_THRESHOLD
        ? { balance, threshold: WALLET_LOW_THRESHOLD }
        : null;

    // Expiring marketplace tokens (within the next 3 days).
    const cutoff = new Date(Date.now() + TOKEN_EXPIRY_WINDOW_MS);
    const expRows = await this.db
      .select({
        shop_id: shops.id,
        shop_name: sql<string>`coalesce(${shops.displayName}, ${shops.shopName})`,
        expires_at: shops.accessTokenExpireAt,
      })
      .from(shops)
      .where(
        and(
          eq(shops.userId, userId),
          eq(shops.shopStatus, "active"),
          lt(shops.accessTokenExpireAt, cutoff),
        ),
      );
    const expiring_tokens = expRows.map((r) => ({
      shop_id: r.shop_id,
      shop_name: r.shop_name,
      expires_at: r.expires_at,
    }));

    return { low_stock, low_wallet, expiring_tokens };
  }
}
