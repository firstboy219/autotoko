import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { orders } from "../../database/schema/index.js";

export interface ListOrdersOpts {
  status?: FulfillmentStatus;
  shopId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  offset?: number;
}

export const FULFILLMENT_STATUSES = [
  "masuk",
  "approved",
  "produksi",
  "packing",
  "siap_kirim",
  "dikirim",
  "selesai",
  "retur",
  "dibatalkan",
] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

@Injectable()
export class OrdersService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async list(userId: string, opts: ListOrdersOpts = {}) {
    const conds: SQL[] = [eq(orders.userId, userId)];
    if (opts.status) conds.push(eq(orders.fulfillmentStatus, opts.status));
    if (opts.shopId) conds.push(eq(orders.shopId, opts.shopId));
    if (opts.dateFrom) conds.push(gte(orders.createdAt, opts.dateFrom));
    if (opts.dateTo) conds.push(lte(orders.createdAt, opts.dateTo));
    const dariApi = await this.db
      .select()
      .from(orders)
      .where(and(...conds))
      .orderBy(desc(orders.createdAt))
      .limit(Math.min(opts.limit ?? 100, 500))
      .offset(opts.offset ?? 0);

    // Paket yang dipindai lewat aplikasi ikut terdaftar di sini.
    //
    // Sebelumnya menu ini hanya membaca tabel orders yang diisi API
    // marketplace -- terukur 16 baris -- sementara ratusan paket sudah
    // dikirim lewat alur manual dan tidak muncul sama sekali.
    //
    // Nominalnya SENGAJA null, bukan nol. Scan resi mencatat bahwa paket
    // dikirim, bukan berapa harganya; menaruh angka di sana akan menghasilkan
    // omzet yang tidak pernah ada di rekening mana pun. Nol terbaca sebagai
    // "terjual nol rupiah", null terbaca sebagai "tidak diketahui" -- dan yang
    // kedua itulah yang benar.
    const manual = await this.db.execute(sql`
      SELECT r.id                AS id,
             r.user_id           AS user_id,
             r.shop_id           AS shop_id,
             r.label_order_no    AS marketplace_order_id,
             COALESCE(r.marketplace, 'manual') AS marketplace,
             r.resi              AS tracking_number,
             r.scanned_at        AS created_at,
             r.label_recipient   AS buyer_name,
             r.courier_confirmed AS shipping_courier,
             COALESCE(
               (SELECT json_agg(json_build_object(
                          'name', COALESCE(p.name, i.raw_name),
                          'qty',  i.qty))
                  FROM resi_scan_items i
                  LEFT JOIN master_products p ON p.id = i.master_product_id
                 WHERE i.resi_scan_id = r.id),
               '[]'::json) AS items
        FROM resi_scans r
       WHERE r.user_id = ${userId}
         ${opts.shopId ? sql`AND r.shop_id = ${opts.shopId}` : sql``}
         ${opts.dateFrom ? sql`AND r.scanned_at >= ${opts.dateFrom.toISOString()}` : sql``}
         ${opts.dateTo ? sql`AND r.scanned_at <= ${opts.dateTo.toISOString()}` : sql``}
       ORDER BY r.scanned_at DESC
    `);

    const barisManual = (manual as unknown as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      userId: r.user_id as string,
      shopId: (r.shop_id as string) ?? null,
      marketplaceOrderId: (r.marketplace_order_id as string) ?? null,
      marketplace: r.marketplace as string,
      trackingNumber: (r.tracking_number as string) ?? null,
      buyerName: (r.buyer_name as string) ?? null,
      shippingCourier: (r.shipping_courier as string) ?? null,
      // Paket yang sudah discan berarti sudah diserahkan ke kurir.
      fulfillmentStatus: "dikirim" as const,
      totalAmount: null,
      platformFee: null,
      feeDeducted: false,
      items: r.items,
      createdAt: r.created_at as Date,
      sumber: "manual" as const,
    }));

    // Penyaring status hanya berlaku pada yang dari API: status paket manual
    // selalu "dikirim", jadi menyaring status lain berarti membuangnya semua.
    const manualTerpilih = opts.status && opts.status !== "dikirim" ? [] : barisManual;

    return [...dariApi.map((o) => ({ ...o, sumber: "api" as const })), ...manualTerpilih]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /** Lightweight counters for the dashboard. */
  async summary(userId: string) {
    const [row] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        revenue: sql<string>`coalesce(sum(${orders.totalAmount}), 0)`,
        feeCharged: sql<string>`coalesce(sum(${orders.platformFee}), 0)`,
      })
      .from(orders)
      .where(eq(orders.userId, userId));
    return row ?? { total: 0, revenue: "0", feeCharged: "0" };
  }

  async get(userId: string, id: string) {
    const [order] = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.userId, userId)))
      .limit(1);
    if (!order) throw new NotFoundException("Order not found");
    return order;
  }

  /** Update the internal fulfillment status (multi-tenant guarded). */
  async updateStatus(userId: string, id: string, status: FulfillmentStatus) {
    const [row] = await this.db
      .update(orders)
      .set({ fulfillmentStatus: status, updatedAt: new Date() })
      .where(and(eq(orders.id, id), eq(orders.userId, userId)))
      .returning();
    if (!row) throw new NotFoundException("Order not found");
    return row;
  }
}
