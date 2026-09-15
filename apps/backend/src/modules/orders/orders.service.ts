import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, gte, inArray, lte, notInArray, sql, type SQL } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { orders, orderSettings, resiScans, shops, marketplaceSkuMap } from "../../database/schema/index.js";

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
  /** Sumber TUNGGAL meta status untuk klien (web & APK) supaya label tak disalin-tangan. */
  statusMeta() {
    return {
      flow: ["masuk", "approved", "packing", "siap_kirim", "dikirim"],
      side: ["selesai", "retur", "dibatalkan"],
      label: {
        masuk: "Menunggu Disetujui", approved: "Menunggu Dicetak", produksi: "Produksi",
        packing: "Menunggu Dipacking", siap_kirim: "Menunggu Dipickup", dikirim: "Dalam Pengiriman",
        selesai: "Selesai", retur: "Retur", dibatalkan: "Dibatalkan",
      } as Record<string, string>,
      // null = tahap rincian internal; di marketplace order masih "siap kirim".
      marketplaceEquivalent: {
        masuk: "Menunggu Disetujui / Perlu Diproses", approved: null, packing: null, siap_kirim: null,
        dikirim: "Dalam Pengiriman", selesai: "Selesai", retur: "Retur", dibatalkan: "Dibatalkan",
      } as Record<string, string | null>,
    };
  }

  /**
   * Kesehatan Pesanan: menyatukan sinyal dua-sumber (API x scan manual) dalam
   * satu tempat -- read-only, tidak mengubah data apa pun. Empat temuan:
   * 1) API bilang terkirim/selesai tapi gudang tak pernah scan,
   * 2) discan gudang tapi tak ada order API-nya,
   * 3) SKU varian di item order yang belum dipetakan ke master produk,
   * 4) order API tanpa nominal (bukan dibatalkan).
   */
  async health(userId: string) {
    const one = async (q: SQL) => (await this.db.execute(q)) as unknown as Record<string, unknown>[];
    const cnt = async (q: SQL) => Number((await one(q))[0]?.n ?? 0);

    const wBelum = sql`o.user_id = ${userId} AND o.fulfillment_status IN ('dikirim','selesai') AND o.created_at >= now() - interval '60 days' AND NOT EXISTS (SELECT 1 FROM resi_scans r WHERE r.user_id = o.user_id AND r.label_order_no = o.marketplace_order_id)`;
    const belumDiscan = {
      total: await cnt(sql`SELECT count(*)::int AS n FROM orders o WHERE ${wBelum}`),
      contoh: await one(sql`SELECT o.marketplace_order_id AS no, o.fulfillment_status AS fs, o.shipping_courier AS kurir, o.created_at AS at FROM orders o WHERE ${wBelum} ORDER BY o.created_at DESC LIMIT 50`),
    };

    const wManual = sql`r.user_id = ${userId} AND r.label_order_no IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = r.user_id AND o.marketplace_order_id = r.label_order_no)`;
    const manualTanpaApi = {
      total: await cnt(sql`SELECT count(*)::int AS n FROM resi_scans r WHERE ${wManual}`),
      contoh: await one(sql`SELECT r.label_order_no AS no, r.resi AS resi, r.scanned_at AS at FROM resi_scans r WHERE ${wManual} ORDER BY r.scanned_at DESC LIMIT 50`),
    };

    const skuCte = sql`SELECT DISTINCT (it->>'skuId') AS sku, coalesce(it->>'name','') AS nama FROM orders o CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) it WHERE o.user_id = ${userId} AND o.marketplace = 'tiktok' AND it->>'skuId' IS NOT NULL AND it->>'skuId' <> ''`;
    const skuNot = sql`NOT EXISTS (SELECT 1 FROM marketplace_sku_map m WHERE m.user_id = ${userId} AND m.marketplace = 'tiktok' AND m.sku = s.sku)`;
    const skuBelumDipetakan = {
      total: await cnt(sql`SELECT count(*)::int AS n FROM (${skuCte}) s WHERE ${skuNot}`),
      contoh: await one(sql`SELECT s.sku AS sku, s.nama AS nama FROM (${skuCte}) s WHERE ${skuNot} ORDER BY s.nama LIMIT 100`),
    };

    const wNom = sql`user_id = ${userId} AND total_amount IS NULL AND fulfillment_status <> 'dibatalkan'`;
    const tanpaNominal = {
      total: await cnt(sql`SELECT count(*)::int AS n FROM orders WHERE ${wNom}`),
      contoh: await one(sql`SELECT marketplace_order_id AS no, fulfillment_status AS fs, created_at AS at FROM orders WHERE ${wNom} ORDER BY created_at DESC LIMIT 50`),
    };

    // Auto-cocok isi paket: untuk order yang resinya sudah discan DAN itemnya
    // terbaca (tahap "Daftar Produk"), bandingkan total qty terbaca vs qty
    // pesanan. Beda = perlu dicek. ADVISORY: OCR daftar produk opsional, jadi
    // ini penanda, bukan vonis; verifikasi "sudah dipacking" tetap si scan itu.
    const isiCte = sql`
      WITH harap AS (
        SELECT o.id AS oid, o.marketplace_order_id AS no,
               SUM(COALESCE((it->>'qty')::int, 0)) AS harap_qty
          FROM orders o
          CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) it
         WHERE o.user_id = ${userId}
         GROUP BY o.id, o.marketplace_order_id
      ),
      scan AS (
        SELECT r.order_id AS oid, SUM(i.qty) AS scan_qty, COUNT(i.id) AS n, MAX(r.scanned_at) AS at
          FROM resi_scans r JOIN resi_scan_items i ON i.resi_scan_id = r.id
         WHERE r.user_id = ${userId} AND r.order_id IS NOT NULL
         GROUP BY r.order_id
      )
      SELECT h.no AS no, h.harap_qty AS harap, s.scan_qty AS terbaca, s.at AS at
        FROM harap h JOIN scan s ON s.oid = h.oid
       WHERE s.n > 0 AND s.scan_qty IS NOT NULL AND s.scan_qty <> h.harap_qty`;
    const isiTakCocok = {
      total: await cnt(sql`SELECT count(*)::int AS n FROM (${isiCte}) x`),
      contoh: await one(sql`SELECT no, harap, terbaca, at FROM (${isiCte}) x ORDER BY at DESC LIMIT 50`),
    };

    return { belumDiscan, manualTanpaApi, skuBelumDipetakan, tanpaNominal, isiTakCocok };
  }

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
