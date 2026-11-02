import {
  Controller,
  Get,
  Headers,
  Inject,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { TenantService } from "../../database/tenant.service.js";

/**
 * Jalur baca-saja untuk JARVIS ("Sumber API" di fitur Bisnis JARVIS).
 *
 * - Auth: header `X-API-Key` == env JARVIS_API_KEY (dibandingkan constant-time).
 *   Tanpa env → 503, jadi endpoint mati sampai kunci dipasang.
 * - Hanya ANGKA AGREGAT lintas tenant (tanpa nama/HP/alamat pembeli, tanpa token).
 * - Akun demo dikecualikan.
 * - "Hari ini" = sejak 00:00 WIB; tanggal jual = coalesce(created_at_marketplace, created_at).
 */
const DEMO_USER = "00000000-0000-0000-0000-0000000000de";
const SOLD = sql.raw(`coalesce(created_at_marketplace, created_at)`);

function sha(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

/** UTC instant of 00:00 Asia/Jakarta (UTC+7, tanpa DST) untuk hari ini. */
function wibDayStart(now = new Date()): Date {
  const wib = new Date(now.getTime() + 7 * 3600_000);
  return new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate()) - 7 * 3600_000);
}

@Controller("integrations/jarvis")
export class JarvisController {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly tenant: TenantService,
    private readonly config: ConfigService,
  ) {}

  private auth(key: string | undefined) {
    const expected = this.config.get<string>("JARVIS_API_KEY");
    if (!expected) throw new ServiceUnavailableException("Integrasi JARVIS belum dikonfigurasi");
    if (!key || !timingSafeEqual(sha(key), sha(expected))) throw new UnauthorizedException("X-API-Key salah");
  }

  private rows<T>(q: ReturnType<typeof sql>): Promise<T[]> {
    return this.tenant.runBypass(async () => {
      const r = (await this.db.execute(q)) as unknown as { rows?: T[] } | T[];
      return (Array.isArray(r) ? r : r.rows ?? []) as T[];
    });
  }

  /** Angka hari ini s/d saat ini (WIB). Satu angka = satu path JSON, mis. data.penjualan. */
  @Get("metrics")
  async metrics(@Headers("x-api-key") key?: string) {
    this.auth(key);
    const start = wibDayStart().toISOString();
    const [today] = await this.rows<Record<string, string | number>>(sql`
      SELECT
        coalesce(sum(total_amount) FILTER (WHERE status <> 'CANCELLED'), 0)::bigint AS penjualan,
        count(*) FILTER (WHERE status <> 'CANCELLED')::int AS pesanan,
        count(*) FILTER (WHERE status = 'CANCELLED')::int AS batal,
        coalesce(sum(total_amount) FILTER (WHERE status = 'CANCELLED'), 0)::bigint AS nilai_batal,
        count(DISTINCT raw->>'user_id') FILTER (WHERE status <> 'CANCELLED')::int AS pelanggan,
        count(*) FILTER (WHERE status <> 'CANCELLED' AND upper(coalesce(payment_method,'')) LIKE '%COD%')::int AS pesanan_cod
      FROM orders
      WHERE user_id <> ${DEMO_USER}::uuid AND ${SOLD} >= ${start}::timestamptz`);
    const [backlog] = await this.rows<Record<string, number>>(sql`
      SELECT
        count(*) FILTER (WHERE status IN ('AWAITING_SHIPMENT','AWAITING_COLLECTION'))::int AS dikemas,
        count(*) FILTER (WHERE status = 'IN_TRANSIT')::int AS dikirim
      FROM orders WHERE user_id <> ${DEMO_USER}::uuid`);
    const [toko] = await this.rows<Record<string, number>>(sql`
      SELECT count(*) FILTER (WHERE shop_status = 'active')::int AS toko_aktif,
             count(DISTINCT user_id)::int AS seller_aktif
      FROM shops WHERE user_id <> ${DEMO_USER}::uuid`);
    const n = (v: unknown) => Number(v ?? 0);
    return {
      success: true,
      data: {
        tanggal: new Date(Date.parse(start) + 7 * 3600_000).toISOString().slice(0, 10),
        zona: "Asia/Jakarta",
        penjualan: n(today?.penjualan),
        pesanan: n(today?.pesanan),
        batal: n(today?.batal),
        nilai_batal: n(today?.nilai_batal),
        pelanggan: n(today?.pelanggan),
        pesanan_cod: n(today?.pesanan_cod),
        dikemas: n(backlog?.dikemas),
        dikirim: n(backlog?.dikirim),
        toko_aktif: n(toko?.toko_aktif),
        seller_aktif: n(toko?.seller_aktif),
        diperbarui: new Date().toISOString(),
      },
    };
  }

  /** Riwayat harian (WIB) untuk mengisi tren sekali jalan. ?hari=90 (1..400). */
  @Get("series")
  async series(@Headers("x-api-key") key?: string, @Query("hari") hari?: string) {
    this.auth(key);
    const days = Math.min(400, Math.max(1, Number.parseInt(hari ?? "90", 10) || 90));
    const from = new Date(wibDayStart().getTime() - (days - 1) * 86400_000).toISOString();
    const rows = await this.rows<Record<string, string | number>>(sql`
      SELECT to_char((${SOLD} AT TIME ZONE 'Asia/Jakarta')::date, 'YYYY-MM-DD') AS tanggal,
        coalesce(sum(total_amount) FILTER (WHERE status <> 'CANCELLED'), 0)::bigint AS penjualan,
        count(*) FILTER (WHERE status <> 'CANCELLED')::int AS pesanan,
        count(*) FILTER (WHERE status = 'CANCELLED')::int AS batal,
        count(DISTINCT raw->>'user_id') FILTER (WHERE status <> 'CANCELLED')::int AS pelanggan
      FROM orders
      WHERE user_id <> ${DEMO_USER}::uuid AND ${SOLD} >= ${from}::timestamptz
      GROUP BY 1 ORDER BY 1`);
    return {
      success: true,
      data: rows.map((r) => ({
        tanggal: String(r.tanggal),
        penjualan: Number(r.penjualan),
        pesanan: Number(r.pesanan),
        batal: Number(r.batal),
        pelanggan: Number(r.pelanggan),
      })),
    };
  }
}
