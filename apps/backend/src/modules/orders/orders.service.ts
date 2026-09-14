import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, gte, inArray, lte, notInArray, sql, type SQL } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { orders, orderSettings, resiScans, shops } from "../../database/schema/index.js";

export interface ListOrdersOpts {
  status?: FulfillmentStatus;
  /** Hanya order aktif (bukan selesai/dibatalkan); scan manual disembunyikan. */
  active?: boolean;
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
    if (opts.active) conds.push(notInArray(orders.fulfillmentStatus, ["selesai", "dibatalkan"]));
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

    // Nama toko per baris. Label yang diberi seller (displayName) menang atas
    // nama resmi marketplace -- itu yang dia kenali sebagai "tokonya".
    const tokoRows = await this.db
      .select({ id: shops.id, nama: shops.shopName, display: shops.displayName })
      .from(shops)
      .where(eq(shops.userId, userId));
    const namaToko = new Map(tokoRows.map((s) => [s.id, s.display ?? s.nama ?? null]));

    // Apakah pesanan dari API ini juga sudah discan lewat aplikasi. Di
    // sinilah dua sumber itu bertemu: pesanan yang kata marketplace sudah
    // dikirim tapi tidak pernah discan, atau sebaliknya, adalah temuan --
    // dan tanpa penanda ini keduanya hanya dua baris yang kebetulan mirip.
    const noPesanan = dariApi.map((o) => o.marketplaceOrderId).filter((x): x is string => !!x);
    const terscan = new Set<string>();
    if (noPesanan.length) {
      const r = await this.db
        .selectDistinct({ no: resiScans.labelOrderNo })
        .from(resiScans)
        .where(and(eq(resiScans.userId, userId), inArray(resiScans.labelOrderNo, noPesanan)));
      for (const x of r) if (x.no) terscan.add(x.no);
    }

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
      shopName: r.shop_id ? namaToko.get(r.shop_id as string) ?? null : null,
      sumber: "manual" as const,
    }));

    // Penyaring status hanya berlaku pada yang dari API: status paket manual
    // selalu "dikirim", jadi menyaring status lain berarti membuangnya semua.
    const manualTerpilih =
      opts.active || (opts.status && opts.status !== "dikirim") ? [] : barisManual;

    return [
      ...dariApi.map((o) => ({
        ...o, sumber: "api" as const, terscan: terscan.has(o.marketplaceOrderId),
        shopName: o.shopId ? namaToko.get(o.shopId) ?? null : null,
      })),
      ...manualTerpilih,
    ]
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

  /** Jumlah per status proses (semua order API) + jumlah scan manual. */
  async boardSummary(userId: string) {
    const rows = await this.db
      .select({ fs: orders.fulfillmentStatus, n: sql<number>`count(*)::int` })
      .from(orders)
      .where(eq(orders.userId, userId))
      .groupBy(orders.fulfillmentStatus);
    const perStatus: Record<string, number> = {};
    for (const r of rows) perStatus[r.fs] = Number(r.n);
    const [m] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(resiScans)
      .where(eq(resiScans.userId, userId));
    return { perStatus, manual: Number(m?.n ?? 0) };
  }

  /** Ubah status proses banyak order sekaligus (multi-tenant guarded). */
  async updateStatusBulk(userId: string, ids: string[], status: FulfillmentStatus) {
    const clean = [...new Set((ids ?? []).filter(Boolean))];
    if (!clean.length) return { updated: 0, ids: [] as string[] };
    const rows = await this.db
      .update(orders)
      .set({ fulfillmentStatus: status, updatedAt: new Date() })
      .where(and(eq(orders.userId, userId), inArray(orders.id, clean)))
      .returning({ id: orders.id });
    return { updated: rows.length, ids: rows.map((r) => r.id) };
  }

  private readonly INSTANT_DEFAULT = ["instant", "sameday", "same day", "same-day"];

  async getOrderSettings(userId: string) {
    const [row] = await this.db
      .select()
      .from(orderSettings)
      .where(eq(orderSettings.userId, userId))
      .limit(1);
    return {
      autoSiapKirim: row?.autoSiapKirim ?? false,
      instantCouriers: row?.instantCouriers ?? this.INSTANT_DEFAULT,
    };
  }

  async updateOrderSettings(
    userId: string,
    dto: { autoSiapKirim?: boolean; instantCouriers?: string[] },
  ) {
    const kini = await this.getOrderSettings(userId);
    const nilai = {
      autoSiapKirim: dto.autoSiapKirim ?? kini.autoSiapKirim,
      instantCouriers: (dto.instantCouriers ?? kini.instantCouriers)
        .map((s) => s.trim())
        .filter(Boolean),
    };
    await this.db
      .insert(orderSettings)
      .values({ userId, autoSiapKirim: nilai.autoSiapKirim, instantCouriers: nilai.instantCouriers, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: orderSettings.userId,
        set: { autoSiapKirim: nilai.autoSiapKirim, instantCouriers: nilai.instantCouriers, updatedAt: new Date() },
      });
    return nilai;
  }

  /**
   * Cetak AWB / arrange shipment ke marketplace. SEAM: API ship marketplace
   * BELUM tersambung, jadi ini TIDAK menulis data palsu & TIDAK meng-update
   * marketplace. Dipakai frontend sebagai alur siap-sambung; begitu panggilan
   * API ship TikTok diisi di sini, barulah label dibuat dan status di seller
   * center benar-benar berubah.
   */
  async generateAwb(userId: string, id: string) {
    const [order] = await this.db
      .select({ id: orders.id, awbGenerated: orders.awbGenerated, trackingNumber: orders.trackingNumber })
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.userId, userId)))
      .limit(1);
    if (!order) throw new NotFoundException("Order not found");
    return {
      connected: false,
      simulated: true,
      awbGenerated: order.awbGenerated,
      trackingNumber: order.trackingNumber,
      message:
        "API AWB/ship marketplace belum tersambung. Frontend siap; nomor resi & status di marketplace akan terisi otomatis begitu API disambung.",
    };
  }
}
