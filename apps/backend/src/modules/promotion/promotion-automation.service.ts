import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { eq } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { promotionAutomation } from "../../database/schema/index.js";
import { MarketplaceSyncService } from "../marketplace-sync/marketplace-sync.service.js";

export interface AutoSettings {
  enabled: boolean;
  dryRun: boolean;
  onlyOngoing: boolean;
  minUpliftPct: number;
  requireProfit: boolean;
  minOrders: number;
  autoExtend: boolean;
  extendDays: number;
  autoReplicate: boolean;
  replicateDiscountPct: number;
}
const DEFAULTS: AutoSettings = {
  enabled: false, dryRun: true, onlyOngoing: true, minUpliftPct: 10, requireProfit: true,
  minOrders: 5, autoExtend: false, extendDays: 7, autoReplicate: false, replicateDiscountPct: 10,
};

/**
 * Otomasi Promosi. Alur (dapat diatur di Setting halaman Promosi):
 * 1) ambil list promo -> 2) tiap promo -> 3) toko, rentang tanggal, produk ->
 * 4) bandingkan penjualan (jumlah order) di rentang promo vs periode sebelum yang
 * sama panjang -> 5) hitung nominal pencairan (net) atas order rentang itu ->
 * 6) bila positif & auto-extend: perpanjang rentang +N hari -> 7) bila positif &
 * auto-replicate: replikasi ke semua toko lain. Mode uji coba (dryRun) hanya
 * melaporkan tanpa mengeksekusi aksi. Semua aksi outward memicu perubahan harga
 * nyata di TikTok -> default OFF + dryRun ON sampai seller mengaktifkan sendiri.
 */
@Injectable()
export class PromotionAutomationService {
  private readonly logger = new Logger(PromotionAutomationService.name);
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly sync: MarketplaceSyncService,
  ) {}

  async getSettings(userId: string): Promise<AutoSettings & { lastRunAt: Date | null; lastResult: unknown }> {
    const [r] = await this.db.select().from(promotionAutomation).where(eq(promotionAutomation.userId, userId)).limit(1);
    if (!r) return { ...DEFAULTS, lastRunAt: null, lastResult: null };
    return {
      enabled: r.enabled, dryRun: r.dryRun, onlyOngoing: r.onlyOngoing,
      minUpliftPct: Number(r.minUpliftPct), requireProfit: r.requireProfit, minOrders: r.minOrders,
      autoExtend: r.autoExtend, extendDays: r.extendDays, autoReplicate: r.autoReplicate,
      replicateDiscountPct: Number(r.replicateDiscountPct), lastRunAt: r.lastRunAt, lastResult: r.lastResult,
    };
  }

  private cols(s: AutoSettings) {
    return {
      enabled: s.enabled, dryRun: s.dryRun, onlyOngoing: s.onlyOngoing,
      minUpliftPct: String(s.minUpliftPct), requireProfit: s.requireProfit, minOrders: s.minOrders,
      autoExtend: s.autoExtend, extendDays: s.extendDays, autoReplicate: s.autoReplicate,
      replicateDiscountPct: String(s.replicateDiscountPct),
    };
  }

  async setSettings(userId: string, dto: Partial<AutoSettings>) {
    const cur = await this.getSettings(userId);
    const v: AutoSettings = {
      enabled: dto.enabled ?? cur.enabled,
      dryRun: dto.dryRun ?? cur.dryRun,
      onlyOngoing: dto.onlyOngoing ?? cur.onlyOngoing,
      minUpliftPct: dto.minUpliftPct ?? cur.minUpliftPct,
      requireProfit: dto.requireProfit ?? cur.requireProfit,
      minOrders: dto.minOrders ?? cur.minOrders,
      autoExtend: dto.autoExtend ?? cur.autoExtend,
      extendDays: dto.extendDays ?? cur.extendDays,
      autoReplicate: dto.autoReplicate ?? cur.autoReplicate,
      replicateDiscountPct: dto.replicateDiscountPct ?? cur.replicateDiscountPct,
    };
    await this.db.insert(promotionAutomation).values({ userId, ...this.cols(v), updatedAt: new Date() })
      .onConflictDoUpdate({ target: promotionAutomation.userId, set: { ...this.cols(v), updatedAt: new Date() } });
    return this.getSettings(userId);
  }

  /** Evaluasi 1 promo: penjualan rentang promo vs periode sebelum + net pencairan. */
  async evaluate(userId: string, shopId: string, beginSec: number, endSec: number) {
    const now = Math.floor(Date.now() / 1000);
    const start = Number(beginSec) || 0;
    let end = Number(endSec) || now;
    end = Math.min(end || now, now);
    if (!start || end <= start) return { evaluable: false as const, reason: "rentang belum mulai / tak valid" };
    const len = end - start;
    const iso = (s: number) => new Date(s * 1000).toISOString();
    const [w, b, cr] = await Promise.all([
      this.sync.ordersAggByShop(userId, shopId, iso(start), iso(end)),
      this.sync.ordersAggByShop(userId, shopId, iso(start - len), iso(start)),
      this.sync.komisiRate(userId),
    ]);
    const upliftPct = b.n > 0 ? Math.round(((w.n - b.n) / b.n) * 100) : w.n > 0 ? 100 : 0;
    const net = Math.round(w.total * (1 - cr));
    return {
      evaluable: true as const,
      window: { orders: w.n, sales: Math.round(w.total), net },
      baseline: { orders: b.n, sales: Math.round(b.total) },
      upliftPct,
    };
  }

  async evaluateActivity(userId: string, shopId: string, activityId: string) {
    const d = (await this.sync.promoActivityDetail(userId, shopId, activityId)) as Record<string, unknown>;
    return this.evaluate(userId, shopId, Number(d.begin_time), Number(d.end_time));
  }

  /** Jalankan seluruh alur otomasi utk 1 user (hormati dryRun & flag aksi). */
  async run(userId: string, force?: { dryRun?: boolean }) {
    const st = await this.getSettings(userId);
    const dry = force?.dryRun ?? st.dryRun;
    const shopsAct = (await this.sync.promoListActivities(userId, {})) as Array<{ shopId: string; shopName: string; activities: Array<Record<string, unknown>> }>;
    const allShopIds = shopsAct.map((s) => s.shopId);
    const report: Array<Record<string, unknown>> = [];
    for (const s of shopsAct) {
      for (const a of s.activities ?? []) {
        const aid = String(a.id ?? a.activity_id ?? "");
        if (!aid) continue;
        const status = String(a.status ?? "").toUpperCase();
        if (st.onlyOngoing && !(status === "ONGOING" || status === "ACTIVE")) continue;
        const base = { shop: s.shopName, shopId: s.shopId, activityId: aid, title: String(a.title ?? aid), status };
        const ev = await this.evaluate(userId, s.shopId, Number(a.begin_time), Number(a.end_time));
        if (!ev.evaluable) { report.push({ ...base, skipped: ev.reason }); continue; }
        const positive = ev.upliftPct >= st.minUpliftPct && ev.window.orders >= st.minOrders && (!st.requireProfit || ev.window.net > 0);
        const actions: string[] = [];
        if (positive) {
          if (st.autoExtend) {
            if (dry) actions.push(`akan perpanjang +${st.extendDays} hari`);
            else {
              try {
                const b0 = Number(a.begin_time) || 0;
                const e0 = Number(a.end_time) || Math.floor(Date.now() / 1000);
                await this.sync.promoUpdate(userId, s.shopId, aid, {
                  ...(b0 ? { begin_time: b0 } : {}),
                  end_time: e0 + st.extendDays * 86400,
                });
                actions.push(`diperpanjang +${st.extendDays} hari`);
              } catch (e) { actions.push(`perpanjang gagal: ${(e as Error).message}`); }
            }
          }
          if (st.autoReplicate) {
            const targets = allShopIds.filter((x) => x !== s.shopId);
            if (dry) actions.push(`akan replikasi ke ${targets.length} toko`);
            else {
              try {
                const r = (await this.sync.replicatePromo(userId, s.shopId, aid, targets, st.replicateDiscountPct)) as { results?: Array<{ error?: string }> };
                const ok = (r.results ?? []).filter((x) => !x.error).length;
                actions.push(`direplikasi ke ${ok}/${targets.length} toko`);
              } catch (e) { actions.push(`replikasi gagal: ${(e as Error).message}`); }
            }
          }
        }
        report.push({ ...base, ...ev, positive, actions });
      }
    }
    const summary = { total: report.length, positif: report.filter((r) => r.positive).length, dieksekusi: !dry };
    await this.db.insert(promotionAutomation).values({ userId, ...this.cols(st), lastRunAt: new Date(), lastResult: { summary }, updatedAt: new Date() })
      .onConflictDoUpdate({ target: promotionAutomation.userId, set: { lastRunAt: new Date(), lastResult: { summary }, updatedAt: new Date() } });
    return { dryRun: dry, summary, report };
  }

  /** Jadwal harian: jalankan otomasi utk user yang mengaktifkan (hormati dryRun mereka). */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async scheduled() {
    let rows: { userId: string }[] = [];
    try { rows = await this.db.select({ userId: promotionAutomation.userId }).from(promotionAutomation).where(eq(promotionAutomation.enabled, true)); }
    catch (e) { this.logger.warn(`otomasi jadwal: gagal ambil daftar user: ${(e as Error).message}`); return; }
    for (const r of rows) {
      try { await this.run(r.userId); }
      catch (e) { this.logger.warn(`otomasi promosi user ${r.userId}: ${(e as Error).message}`); }
    }
  }
}
