import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { and, desc, eq, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { TenantService } from "../../database/tenant.service.js";
import { couponSettings, marketplaceCoupons, shops } from "../../database/schema/index.js";
import { MarketplaceSyncService } from "../marketplace-sync/marketplace-sync.service.js";
import { NotificationService } from "../account/notification.service.js";

type Obj = Record<string, any>;

export interface CouponSettingsView {
  autoSync: boolean;
  alertExpiry: boolean; expiryDays: number;
  alertLimit: boolean; limitPct: number;
  alertZeroClaim: boolean; zeroClaimDays: number;
  tersimpan: boolean;
}
const DEFAULT: CouponSettingsView = {
  autoSync: true, alertExpiry: true, expiryDays: 3, alertLimit: true, limitPct: 80,
  alertZeroClaim: true, zeroClaimDays: 3, tersimpan: false,
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v); return Number.isFinite(n) ? n : null;
};
const sec = (v: unknown): Date | null => {
  const n = Number(v); return n > 0 ? new Date(n * 1000) : null;
};

/**
 * Kupon/Voucher TikTok — SATU sistem dengan Promosi (menu Promotion).
 *
 * API kupon TikTok READ-ONLY (search + get; tak ada create/edit via API — kupon
 * dibuat di Seller Center/Seller App). Maka nilai AutoToko = OTOMASI PANTAUAN:
 * sinkron berkala -> deteksi sinyal (segera berakhir, klaim hampir/ sudah habis,
 * nol klaim) -> dorong notifikasi ke feed seller (NotifBell APK + Notifikasi
 * web) + rekap performa (klaim/redeem/konversi). Semua read-only & aman.
 *
 * Kaitan dgn promo activity: kartu promo & kupon tampil di halaman yang sama;
 * ringkasan menggabungkan keduanya sehingga seller melihat seluruh "senjata
 * promosi" toko dalam satu layar.
 */
@Injectable()
export class CouponService {
  private readonly logger = new Logger(CouponService.name);
  private readonly sedang = new Set<string>();

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly tenant: TenantService,
    private readonly sync: MarketplaceSyncService,
    private readonly notif: NotificationService,
  ) {}

  private bypass<T>(fn: () => Promise<T>) { return this.tenant.runBypass(fn); }

  /* -------------------------------------------------- pengaturan */

  async getSettings(userId: string): Promise<CouponSettingsView> {
    try {
      const [r] = await this.bypass(() => this.db.select().from(couponSettings).where(eq(couponSettings.userId, userId)).limit(1));
      if (!r) return { ...DEFAULT };
      return {
        autoSync: r.autoSync, alertExpiry: r.alertExpiry, expiryDays: r.expiryDays,
        alertLimit: r.alertLimit, limitPct: r.limitPct, alertZeroClaim: r.alertZeroClaim,
        zeroClaimDays: r.zeroClaimDays, tersimpan: true,
      };
    } catch { return { ...DEFAULT }; }
  }

  async setSettings(userId: string, s: Partial<CouponSettingsView>) {
    const cur = await this.getSettings(userId);
    const v = {
      autoSync: s.autoSync ?? cur.autoSync,
      alertExpiry: s.alertExpiry ?? cur.alertExpiry,
      expiryDays: s.expiryDays ?? cur.expiryDays,
      alertLimit: s.alertLimit ?? cur.alertLimit,
      limitPct: s.limitPct ?? cur.limitPct,
      alertZeroClaim: s.alertZeroClaim ?? cur.alertZeroClaim,
      zeroClaimDays: s.zeroClaimDays ?? cur.zeroClaimDays,
    };
    await this.bypass(() => this.db.insert(couponSettings).values({ userId, ...v, updatedAt: new Date() })
      .onConflictDoUpdate({ target: couponSettings.userId, set: { ...v, updatedAt: new Date() } }));
    return this.getSettings(userId);
  }

  /* -------------------------------------------------- sinkron */

  private static parse(c: Obj) {
    const disc = c.discount ?? {};
    const tipe = String(disc.type ?? "");
    const amount = num(disc.reduction_amount?.amount);
    const pct = num(disc.percentage ?? disc.percentage_off);
    const maxDisc = num(disc.max_discount?.amount ?? disc.discount_cap?.amount);
    const cur = disc.reduction_amount?.currency ?? disc.max_discount?.currency ?? c.threshold?.min_spend?.currency ?? "Rp";
    return {
      couponId: String(c.id ?? c.coupon_id ?? ""),
      title: c.title ?? null,
      status: c.status ?? null,
      displayType: c.display_type ?? null,
      productScope: c.product_scope ?? null,
      targetBuyerSegment: c.target_buyer_segment ?? null,
      creationSource: c.creation_source ?? null,
      discountType: tipe || null,
      discountAmount: amount != null ? String(amount) : null,
      discountPct: pct != null ? String(pct) : null,
      maxDiscount: maxDisc != null ? String(maxDisc) : null,
      currency: cur,
      minSpend: num(c.threshold?.min_spend?.amount) != null ? String(num(c.threshold?.min_spend?.amount)) : null,
      claimStart: sec(c.claim_duration?.start_time),
      claimEnd: sec(c.claim_duration?.end_time),
      redemptionLimit: num(c.usage_limits?.redemption_limit),
      perBuyerLimit: num(c.usage_limits?.single_buyer_claim_limit),
      claimedCount: num(c.usage_stats?.claimed_count) ?? 0,
      redeemedCount: num(c.usage_stats?.redeemed_count) ?? 0,
      raw: c,
    };
  }

  /** Tarik kupon semua toko -> upsert ke cache. Detail (usage_stats) diambil per kupon bila daftar tak memuatnya. */
  async sync_(userId: string) {
    const lists = await this.sync.promoListCoupons(userId, { pageSize: 100 });
    let total = 0; const galat: string[] = [];
    for (const s of lists as Obj[]) {
      if (s.error) { galat.push(`${s.shopName}: ${String(s.error).slice(0, 100)}`); continue; }
      const [shop] = await this.bypass(() => this.db.select({ id: shops.id }).from(shops)
        .where(and(eq(shops.userId, userId), eq(shops.id, s.shopId))).limit(1));
      if (!shop) continue;
      for (const c of (s.coupons ?? []) as Obj[]) {
        let full = c;
        // usage_stats hanya pasti ada di detail; ambil bila belum lengkap.
        if (c.usage_stats == null) {
          try { const d = await this.sync.promoCouponDetail(userId, s.shopId, String(c.id ?? c.coupon_id)); full = (d as Obj)?.coupon ?? d ?? c; }
          catch { /* pakai ringkas */ }
        }
        const p = CouponService.parse(full);
        if (!p.couponId) continue;
        const vals = { userId, shopId: shop.id, ...p, syncedAt: new Date() };
        await this.bypass(() => this.db.insert(marketplaceCoupons)
          .values(vals)
          .onConflictDoUpdate({ target: [marketplaceCoupons.userId, marketplaceCoupons.couponId],
            set: { shopId: shop.id, ...p, syncedAt: new Date() } }));
        total += 1;
      }
    }
    return { total, galat };
  }

  /* -------------------------------------------------- sinyal & kartu */

  private static sinyal(c: Obj, st: CouponSettingsView, now = Date.now()) {
    const status = String(c.status ?? "").toUpperCase();
    const berjalan = status === "ONGOING";
    const akanDatang = status === "NOT_START";
    const end = c.claimEnd ? new Date(c.claimEnd).getTime() : 0;
    const start = c.claimStart ? new Date(c.claimStart).getTime() : 0;
    const limit = Number(c.redemptionLimit ?? 0);
    const claimed = Number(c.claimedCount ?? 0);
    const redeemed = Number(c.redeemedCount ?? 0);
    const pakaiRasio = limit > 0 ? claimed / limit : 0;
    const s: string[] = [];
    if ((berjalan || akanDatang) && end > now && (end - now) <= st.expiryDays * 86400e3) s.push("segera_berakhir");
    if (berjalan && limit > 0 && claimed >= limit) s.push("klaim_habis");
    else if (berjalan && limit > 0 && pakaiRasio >= st.limitPct / 100) s.push("klaim_hampir_habis");
    if (berjalan && claimed === 0 && start > 0 && (now - start) >= st.zeroClaimDays * 86400e3) s.push("nol_klaim");
    if (berjalan && redeemed > 0) s.push("berkinerja");
    return { sinyal: s, konversi: claimed > 0 ? Math.round((redeemed / claimed) * 100) : null, pakaiRasio: Math.round(pakaiRasio * 100) };
  }

  private static labelDiskon(c: Obj): string {
    if (c.discountType === "PERCENTAGE_OFF") {
      let s = `-${Number(c.discountPct ?? 0)}%`;
      if (c.maxDiscount) s += ` (maks Rp${Math.round(Number(c.maxDiscount)).toLocaleString("id-ID")})`;
      return s;
    }
    return `-Rp${Math.round(Number(c.discountAmount ?? 0)).toLocaleString("id-ID")}`;
  }

  /** Kartu kupon (dari cache) + sinyal otomasi. status "" = semua. */
  async cards(userId: string, status = "") {
    const st = await this.getSettings(userId);
    const f = String(status || "").toUpperCase();
    const rows = await this.bypass(() => this.db.select().from(marketplaceCoupons)
      .where(eq(marketplaceCoupons.userId, userId)).orderBy(desc(marketplaceCoupons.claimEnd)));
    const shopNames = new Map<string, string>();
    const toko = await this.sync.tokoSiap(userId).catch(() => []);
    for (const t of toko) shopNames.set(t.id, t.displayName || t.shopName || t.id);
    const cocok = (s: string) => {
      if (!f) return true;
      const u = String(s ?? "").toUpperCase();
      return f === "EXPIRED" ? (u === "EXPIRED" || u === "DEACTIVATED") : u === f;
    };
    const cards = rows.filter((r) => cocok(r.status ?? "")).map((r) => {
      const sig = CouponService.sinyal(r, st);
      return {
        id: r.id, couponId: r.couponId, shopId: r.shopId, shopName: r.shopId ? (shopNames.get(r.shopId) ?? "-") : "-",
        title: r.title, status: r.status, displayType: r.displayType,
        diskon: CouponService.labelDiskon(r),
        minSpend: r.minSpend ? Number(r.minSpend) : null,
        productScope: r.productScope, targetBuyerSegment: r.targetBuyerSegment,
        claimStart: r.claimStart, claimEnd: r.claimEnd,
        redemptionLimit: r.redemptionLimit, claimed: r.claimedCount, redeemed: r.redeemedCount,
        ...sig,
      };
    });
    return { cards, syncedAt: rows[0]?.syncedAt ?? null };
  }

  /** Rekap gabungan kupon (utk kartu ringkasan di halaman Promosi). */
  async ringkasan(userId: string) {
    const [a] = await this.bypass(() => this.db.select({
      total: sql<number>`count(*)::int`,
      aktif: sql<number>`count(*) filter (where upper(${marketplaceCoupons.status}) = 'ONGOING')::int`,
      klaim: sql<number>`coalesce(sum(${marketplaceCoupons.claimedCount}),0)::int`,
      redeem: sql<number>`coalesce(sum(${marketplaceCoupons.redeemedCount}),0)::int`,
    }).from(marketplaceCoupons).where(eq(marketplaceCoupons.userId, userId)));
    return { total: a?.total ?? 0, aktif: a?.aktif ?? 0, klaim: a?.klaim ?? 0, redeem: a?.redeem ?? 0 };
  }

  /* -------------------------------------------------- otomasi alert */

  /** Sinkron + evaluasi sinyal -> tulis notifikasi (dedupe). Aman & read-only. */
  async jalankan(userId: string) {
    if (this.sedang.has(userId)) return { dilewati: true };
    this.sedang.add(userId);
    try {
      const st = await this.getSettings(userId);
      const sinkron = st.autoSync ? await this.sync_(userId) : { total: 0, galat: [] as string[] };
      const { cards } = await this.cards(userId, "");
      const now = Date.now();
      const berakhir = cards.filter((c) => c.sinyal.includes("segera_berakhir"));
      const habis = cards.filter((c) => c.sinyal.includes("klaim_habis"));
      const hampir = cards.filter((c) => c.sinyal.includes("klaim_hampir_habis"));
      const nol = cards.filter((c) => c.sinyal.includes("nol_klaim"));
      let notif = 0;
      // notifications ber-RLS: tulis di dalam bypass (pola CommsSyncTask).
      const w = async (type: string, title: string, message: string) => {
        if (await this.bypass(() => this.notif.write({ userId, type, title, message, dedupeHours: 20 }))) notif++;
      };
      const b0 = berakhir[0];
      if (st.alertExpiry && b0) {
        const hari = Math.max(0, Math.ceil((new Date(b0.claimEnd as Date).getTime() - now) / 86400e3));
        await w("kupon_berakhir", "Voucher segera berakhir",
          `${berakhir.length} voucher berakhir ≤${st.expiryDays} hari (mis. "${b0.title}" ${hari} hari lagi di ${b0.shopName}). Perpanjang/buat baru di Seller Center.`);
      }
      if (st.alertLimit && (habis.length || hampir.length)) {
        await w("kupon_kuota", "Kuota voucher menipis",
          `${habis.length} voucher kuota klaimnya HABIS & ${hampir.length} hampir habis (≥${st.limitPct}%). Tambah kuota/buat voucher baru agar promo tak terputus.`);
      }
      const n0 = nol[0];
      if (st.alertZeroClaim && n0) {
        await w("kupon_nol", "Voucher belum diklaim siapa pun",
          `${nol.length} voucher aktif >${st.zeroClaimDays} hari tapi 0 klaim (mis. "${n0.title}" di ${n0.shopName}). Tinjau nilai/threshold-nya.`);
      }
      const hasil = { sinkron, notif, berakhir: berakhir.length, klaimHabis: habis.length, klaimHampirHabis: hampir.length, nolKlaim: nol.length };
      this.logger.log(`coupon ${userId}: ${JSON.stringify(hasil)}`);
      return hasil;
    } finally {
      this.sedang.delete(userId);
    }
  }

  /** Cron tiap 6 jam: semua seller TikTok aktif yg auto_sync-nya nyala (default nyala). */
  @Cron("15 */6 * * *", { timeZone: "Asia/Jakarta" })
  async cron() {
    let users: string[] = [];
    try {
      const rows = await this.bypass(() => this.db.selectDistinct({ id: shops.userId }).from(shops)
        .where(and(eq(shops.marketplace, "tiktok"), eq(shops.shopStatus, "active"))));
      users = rows.map((r) => r.id);
    } catch (e) { this.logger.error(`coupon cron list: ${(e as Error).message}`); return; }
    for (const u of users) {
      try {
        const st = await this.getSettings(u);
        if (st.autoSync) await this.jalankan(u);
      } catch (e) { this.logger.warn(`coupon cron ${u}: ${(e as Error).message}`); }
    }
  }
}
