import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { payoutBatches, payoutMutations, shops } from "../../database/schema/index.js";
import { MarketplaceSyncService } from "../marketplace-sync/marketplace-sync.service.js";
import { PayoutMutationService } from "./mutation.service.js";

interface ImportOpts { shopId?: string; from: string; to: string; includeProcessing?: boolean }

/**
 * Item 2 & 3 Pencairan Dana: auto-ambil penarikan (WITHDRAW) dari TikTok jadi
 * mutasi batch (tahap 1), + verifikasi nominal vs TikTok dan deteksi 1 penarikan
 * masuk >1 batch.
 */
@Injectable()
export class WithdrawalReconcileService {
  private readonly logger = new Logger(WithdrawalReconcileService.name);
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly sync: MarketplaceSyncService,
    private readonly mutations: PayoutMutationService,
  ) {}

  private async batchOf(userId: string, batchId: string) {
    const [b] = await this.db.select().from(payoutBatches)
      .where(and(eq(payoutBatches.id, batchId), eq(payoutBatches.userId, userId))).limit(1);
    if (!b) throw new NotFoundException("Batch tidak ditemukan");
    return b;
  }

  private async tiktokShops(userId: string, shopId?: string) {
    const conds = [eq(shops.userId, userId), eq(shops.marketplace, "tiktok")];
    if (shopId) conds.push(eq(shops.id, shopId));
    return this.db.select({
      id: shops.id, name: shops.displayName, name2: shops.shopName,
      token: shops.accessToken, cipher: shops.shopCipher,
    }).from(shops).where(and(...conds));
  }

  async importWithdrawals(userId: string, batchId: string, opts: ImportOpts) {
    const batch = await this.batchOf(userId, batchId);
    if (batch.status !== "berjalan")
      throw new BadRequestException("Batch sudah terkunci — hanya batch tahap input yang bisa diisi.");
    if (!opts.from || !opts.to) throw new BadRequestException("Rentang tanggal wajib diisi.");
    const targets = (await this.tiktokShops(userId, opts.shopId)).filter((s) => s.token && s.cipher);
    if (!targets.length) throw new BadRequestException("Tidak ada toko TikTok tersambung.");

    let created = 0, totalFetched = 0;
    const skipped: Array<{ shop: string; externalRef: string; amount: number; tanggal: string; reason: string }> = [];
    const items: Array<{ shop: string; amount: number; tanggal: string; status: string }> = [];
    for (const s of targets) {
      const nama = s.name || s.name2 || s.id;
      let rows: Awaited<ReturnType<MarketplaceSyncService["daftarPenarikanToko"]>>;
      try {
        rows = await this.sync.daftarPenarikanToko(userId, s.id, { from: opts.from, to: opts.to, includeProcessing: opts.includeProcessing });
      } catch (e) {
        skipped.push({ shop: nama, externalRef: "", amount: 0, tanggal: "", reason: `gagal ambil: ${(e as Error).message}` });
        continue;
      }
      totalFetched += rows.length;
      for (const r of rows) {
        try {
          await this.mutations.create(
            userId, userId,
            { batchId, shopId: s.id, payoutDate: r.tanggal, marketplaceProofAmount: r.amount, note: `Auto dari TikTok (${r.status})` },
            { dataSource: "api", externalRef: r.externalRef },
          );
          created += 1;
          items.push({ shop: nama, amount: r.amount, tanggal: r.tanggal, status: r.status });
        } catch (e) {
          const msg = e instanceof ConflictException ? "sudah tercatat (nominal sama untuk toko ini)" : (e as Error).message;
          skipped.push({ shop: nama, externalRef: r.externalRef, amount: r.amount, tanggal: r.tanggal, reason: msg });
        }
      }
    }
    return { created, skipped, totalFetched, items };
  }

  async verifyBatch(userId: string, batchId: string) {
    await this.batchOf(userId, batchId);
    const muts = await this.db.select({
      id: payoutMutations.id, shopId: payoutMutations.shopId, payoutDate: payoutMutations.payoutDate,
      amount: payoutMutations.creditAmount, externalRef: payoutMutations.externalRef, dataSource: payoutMutations.dataSource,
    }).from(payoutMutations).where(and(eq(payoutMutations.userId, userId), eq(payoutMutations.batchId, batchId)));
    if (!muts.length)
      return { rows: [], summary: { total: 0, cocok: 0, beda: 0, tidakDitemukan: 0, duplikat: 0, tiktokTotal: 0, tiktokVerified: 0, tiktokUnverified: 0 }, range: null };

    const shopIds = [...new Set(muts.map((m) => m.shopId))];
    const shopRows = await this.db.select({ id: shops.id, name: shops.displayName, name2: shops.shopName, mp: shops.marketplace })
      .from(shops).where(inArray(shops.id, shopIds));
    const shopName = new Map(shopRows.map((s) => [s.id, s.name || s.name2 || s.id]));
    const shopMp = new Map(shopRows.map((s) => [s.id, s.mp]));

    const R = (n: unknown) => Math.round(Number(n) || 0);
    const shift = (d: string, days: number) => {
      const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + days); return x.toISOString().slice(0, 10);
    };
    const dates = muts.map((m) => m.payoutDate).sort();
    const from = shift(dates[0]!, -3), to = shift(dates[dates.length - 1]!, 3);

    const byShopWd = new Map<string, Awaited<ReturnType<MarketplaceSyncService["daftarPenarikanToko"]>>>();
    for (const sid of shopIds) {
      try { byShopWd.set(sid, await this.sync.daftarPenarikanToko(userId, sid, { from, to, includeProcessing: true })); }
      catch { byShopWd.set(sid, []); }
    }

    // Deteksi 1 penarikan (shop + nominal) masuk di >1 batch (harusnya cuma 1).
    const keyOf = (sid: string, amt: unknown) => `${sid}|${R(amt)}`;
    const dupByKey = new Map<string, string[]>();
    const others = await this.db.select({
      shopId: payoutMutations.shopId, amount: payoutMutations.creditAmount, code: payoutBatches.code,
    }).from(payoutMutations)
      .innerJoin(payoutBatches, eq(payoutBatches.id, payoutMutations.batchId))
      .where(and(eq(payoutMutations.userId, userId), inArray(payoutMutations.shopId, shopIds)));
    for (const o of others) {
      const k = keyOf(o.shopId, o.amount);
      const arr = dupByKey.get(k) ?? [];
      if (o.code && !arr.includes(o.code)) arr.push(o.code);
      dupByKey.set(k, arr);
    }

    const near = (a: string, b: string) =>
      Math.abs(new Date(a + "T00:00:00Z").getTime() - new Date(b + "T00:00:00Z").getTime()) <= 2 * 86400000;
    let cocok = 0, beda = 0, tidak = 0, duplikat = 0, tiktokTotal = 0, tiktokVerified = 0, tiktokUnverified = 0;
    const rows = muts.map((m) => {
      const credit = R(m.amount);
      const wds = byShopWd.get(m.shopId) ?? [];
      let match = m.externalRef ? wds.find((w) => w.externalRef === m.externalRef) : undefined;
      if (!match) match = wds.find((w) => R(w.amount) === credit && near(w.tanggal, m.payoutDate));
      const nominalTiktok = match ? R(match.amount) : null;
      const amountMatch = match ? nominalTiktok === credit : false;
      const status = !match ? "tidak_ditemukan" : amountMatch ? "cocok" : "beda";
      if (status === "cocok") cocok++; else if (status === "beda") beda++; else tidak++;
      const marketplace = shopMp.get(m.shopId) ?? "";
      const requiresApi = marketplace === "tiktok";
      if (requiresApi) { tiktokTotal++; if (status === "cocok") tiktokVerified++; else tiktokUnverified++; }
      const dupCodes = dupByKey.get(keyOf(m.shopId, m.amount)) ?? [];
      const isDup = dupCodes.length > 1;
      if (isDup) duplikat++;
      return {
        mutationId: m.id, shop: shopName.get(m.shopId) ?? m.shopId, tanggal: m.payoutDate,
        marketplace, requiresApi,
        nominalInput: credit, nominalTiktok, dataSource: m.dataSource, externalRef: m.externalRef,
        status, duplikatDiBatch: isDup ? dupCodes : [],
      };
    });
    return {
      rows,
      summary: { total: muts.length, cocok, beda, tidakDitemukan: tidak, duplikat, tiktokTotal, tiktokVerified, tiktokUnverified },
      range: { from, to },
    };
  }
}
