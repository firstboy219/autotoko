import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";

/**
 * Master Pelanggan: mengelompokkan order berdasarkan pembeli.
 *
 * Kunci pelanggan = `orders.raw->>'user_id'` (buyer user id dari TikTok).
 * Dipilih karena 100% terisi, stabil per-pembeli, dan tetap mengelompokkan
 * order yang nama pembelinya kosong -- berbeda dari pasangan nama+telepon yang
 * ter-mask dan bisa kosong. Nama/telepon/alamat dipakai sebagai LABEL tampilan
 * (ambil nilai non-kosong terbaru), bukan sebagai kunci.
 *
 * Semua query memfilter eksplisit `user_id` (selain RLS) sebagai pertahanan.
 */
@Injectable()
export class CustomersService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Deteksi COD identik dgn OrdersService.isCodOf / dashboard. */
  private get codExpr() {
    return sql`((o.raw ->> 'is_cod') = 'true' OR lower(coalesce(o.payment_method, '')) LIKE '%cash on delivery%' OR lower(coalesce(o.payment_method, '')) = 'cash')`;
  }

  /** Alamat TikTok ter-mask berbentuk "Indonesia, Provinsi, Kota, ...". */
  private readonly addrExpr = sql`nullif(o.shipping_address ->> 'full_address', '')`;

  async list(
    userId: string,
    opts: { q?: string; repeatOnly?: boolean; sort?: string; limit?: number; offset?: number } = {},
  ) {
    const q = (opts.q ?? "").trim();
    const like = q ? `%${q}%` : "";
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const orderBy =
      opts.sort === "spend"
        ? sql`spend DESC NULLS LAST`
        : opts.sort === "recent"
          ? sql`last_order DESC NULLS LAST`
          : sql`orders DESC, last_order DESC NULLS LAST`;
    const havingRepeat = opts.repeatOnly ? sql`count(*) > 1` : sql`true`;
    const havingSearch = q
      ? sql`(cust_key ILIKE ${like} OR bool_or(o.buyer_name ILIKE ${like}) OR bool_or(o.buyer_phone ILIKE ${like}))`
      : sql`true`;

    const rows = await this.db.execute(sql`
      WITH base AS (
        SELECT o.raw ->> 'user_id' AS cust_key, o.*
        FROM orders o
        WHERE o.user_id = ${userId} AND nullif(o.raw ->> 'user_id', '') IS NOT NULL
      )
      SELECT cust_key,
             (array_agg(o.buyer_name ORDER BY o.created_at DESC) FILTER (WHERE o.buyer_name IS NOT NULL AND o.buyer_name <> ''))[1] AS nama,
             (array_agg(o.buyer_phone ORDER BY o.created_at DESC) FILTER (WHERE o.buyer_phone IS NOT NULL AND o.buyer_phone <> ''))[1] AS phone,
             (array_agg(${this.addrExpr} ORDER BY o.created_at DESC) FILTER (WHERE ${this.addrExpr} IS NOT NULL))[1] AS alamat,
             count(*)::int AS orders,
             count(*) FILTER (WHERE o.fulfillment_status = 'dibatalkan')::int AS batal,
             count(*) FILTER (WHERE ${this.codExpr})::int AS cod,
             coalesce(sum(o.total_amount) FILTER (WHERE o.fulfillment_status <> 'dibatalkan'), 0)::float8 AS spend,
             min(coalesce(o.created_at_marketplace, o.created_at)) AS first_order,
             max(coalesce(o.created_at_marketplace, o.created_at)) AS last_order
      FROM base o
      GROUP BY cust_key
      HAVING ${havingRepeat} AND ${havingSearch}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}
    `);

    const [sum] = (await this.db.execute(sql`
      SELECT count(*)::int AS total_pelanggan,
             count(*) FILTER (WHERE n > 1)::int AS repeat_pelanggan,
             coalesce(sum(n), 0)::int AS total_order
      FROM (
        SELECT count(*) AS n
        FROM orders o
        WHERE o.user_id = ${userId} AND nullif(o.raw ->> 'user_id', '') IS NOT NULL
        GROUP BY o.raw ->> 'user_id'
      ) t
    `)) as unknown as Record<string, unknown>[];

    const list = (rows as unknown as Record<string, unknown>[]).map((r) => ({
      key: String(r.cust_key),
      nama: (r.nama as string) ?? null,
      phone: (r.phone as string) ?? null,
      alamat: (r.alamat as string) ?? null,
      kota: this.kotaOf(r.alamat as string | null),
      orders: Number(r.orders) || 0,
      batal: Number(r.batal) || 0,
      cod: Number(r.cod) || 0,
      spend: Number(r.spend) || 0,
      firstOrder: r.first_order ? new Date(r.first_order as string).toISOString() : null,
      lastOrder: r.last_order ? new Date(r.last_order as string).toISOString() : null,
    }));

    return {
      pelanggan: list,
      ringkas: {
        totalPelanggan: Number(sum?.total_pelanggan) || 0,
        repeatPelanggan: Number(sum?.repeat_pelanggan) || 0,
        totalOrder: Number(sum?.total_order) || 0,
      },
      hasMore: list.length === limit,
    };
  }

  async detail(userId: string, key: string) {
    const [head] = (await this.db.execute(sql`
      SELECT (array_agg(o.buyer_name ORDER BY o.created_at DESC) FILTER (WHERE o.buyer_name IS NOT NULL AND o.buyer_name <> ''))[1] AS nama,
             (array_agg(o.buyer_phone ORDER BY o.created_at DESC) FILTER (WHERE o.buyer_phone IS NOT NULL AND o.buyer_phone <> ''))[1] AS phone,
             (array_agg(${this.addrExpr} ORDER BY o.created_at DESC) FILTER (WHERE ${this.addrExpr} IS NOT NULL))[1] AS alamat,
             count(*)::int AS orders,
             count(*) FILTER (WHERE o.fulfillment_status = 'dibatalkan')::int AS batal,
             count(*) FILTER (WHERE ${this.codExpr})::int AS cod,
             coalesce(sum(o.total_amount) FILTER (WHERE o.fulfillment_status <> 'dibatalkan'), 0)::float8 AS spend,
             min(coalesce(o.created_at_marketplace, o.created_at)) AS first_order,
             max(coalesce(o.created_at_marketplace, o.created_at)) AS last_order
      FROM orders o
      WHERE o.user_id = ${userId} AND o.raw ->> 'user_id' = ${key}
    `)) as unknown as Record<string, unknown>[];

    const orderRows = await this.db.execute(sql`
      SELECT o.marketplace_order_id AS no,
             coalesce(o.created_at_marketplace, o.created_at) AS tgl,
             o.fulfillment_status AS status,
             o.total_amount AS total,
             ${this.codExpr} AS is_cod,
             coalesce(s.display_name, s.shop_name) AS toko,
             o.items AS items
      FROM orders o
      LEFT JOIN shops s ON s.id = o.shop_id
      WHERE o.user_id = ${userId} AND o.raw ->> 'user_id' = ${key}
      ORDER BY coalesce(o.created_at_marketplace, o.created_at) DESC
      LIMIT 300
    `);

    const prodRows = await this.db.execute(sql`
      SELECT coalesce(nullif(it ->> 'masterName', ''), nullif(it ->> 'name', ''), '(tanpa nama)') AS nama,
             sum(coalesce(nullif(it ->> 'qty', '')::numeric, 1))::int AS qty,
             count(DISTINCT o.id)::int AS orders
      FROM orders o
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) it
      WHERE o.user_id = ${userId} AND o.raw ->> 'user_id' = ${key}
      GROUP BY 1
      ORDER BY qty DESC, orders DESC
      LIMIT 25
    `);

    const orders = (orderRows as unknown as Record<string, unknown>[]).map((r) => {
      const items = Array.isArray(r.items) ? (r.items as Record<string, unknown>[]) : [];
      return {
        no: (r.no as string) ?? null,
        tgl: r.tgl ? new Date(r.tgl as string).toISOString() : null,
        status: (r.status as string) ?? null,
        total: r.total != null ? Number(r.total) : null,
        isCod: Boolean(r.is_cod),
        toko: (r.toko as string) ?? null,
        ringkasItem: items
          .map((it) => {
            const nm = (it.name as string) ?? (it.masterName as string) ?? "";
            const qty = it.qty != null ? Number(it.qty) : null;
            return qty ? `${nm} x${qty}` : nm;
          })
          .filter(Boolean)
          .join(", "),
      };
    });

    return {
      key,
      nama: (head?.nama as string) ?? null,
      phone: (head?.phone as string) ?? null,
      alamat: (head?.alamat as string) ?? null,
      kota: this.kotaOf(head?.alamat as string | null),
      orders: Number(head?.orders) || 0,
      batal: Number(head?.batal) || 0,
      cod: Number(head?.cod) || 0,
      spend: Number(head?.spend) || 0,
      firstOrder: head?.first_order ? new Date(head.first_order as string).toISOString() : null,
      lastOrder: head?.last_order ? new Date(head.last_order as string).toISOString() : null,
      daftarOrder: orders,
      produkSering: (prodRows as unknown as Record<string, unknown>[]).map((r) => ({
        nama: String(r.nama),
        qty: Number(r.qty) || 0,
        orders: Number(r.orders) || 0,
      })),
    };
  }

  /** Ambil "Kota" dari alamat "Indonesia, Provinsi, Kota, ...". */
  private kotaOf(addr: string | null): string | null {
    if (!addr) return null;
    const parts = addr.split(",").map((s) => s.trim());
    // parts[0]=Indonesia, [1]=Provinsi, [2]=Kota/Kab
    return parts[2] ?? parts[1] ?? null;
  }
}
