import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { TenantService } from "../../database/tenant.service.js";
import {
  marketplaceProducts,
  marketplaceSkuMap,
  marketplaceSkus,
  shops,
} from "../../database/schema/index.js";
import { MarketplaceSyncService } from "../marketplace-sync/marketplace-sync.service.js";

type Obj = Record<string, any>;

/** Satu produk di kartu promo: nama + potongan per produk/SKU. */
export interface PromoProduk {
  productId: string;
  name: string;
  discountPct: number | null;     // DIRECT_DISCOUNT: "10" = 10% off
  activityPrice: number | null;   // FIXED_PRICE / FLASHSALE: harga promo
  originalPrice: number | null;   // harga normal termurah (dari sinkron SKU)
  skus: Array<{ skuId: string; name: string; discountPct: number | null; activityPrice: number | null; originalPrice: number | null }>;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const isSmart = (a: Obj) => String(a?.title ?? "").startsWith("SmartAuto_");

/**
 * Kartu promo berfokus PRODUK (APK Promotion) + replikasi promo ke toko lain
 * dengan produk YANG SAMA dan potongan YANG SAMA.
 *
 * Batas dari TikTok yang tidak bisa diakali: promo "SmartAuto_*" (promo
 * otomatis buatan TikTok) menolak GetActivity dengan 17029028 Permission
 * Denied, jadi produknya tak terbaca dan tak bisa direplikasi -- ditampilkan
 * sebagai ringkasan per toko, bukan kartu kosong yang menyesatkan.
 *
 * Pemetaan produk sumber -> toko target, urutan kepercayaan:
 *  1) katalog yang sama (marketplace_products.catalog_id, dikelompokkan seller)
 *  2) master produk yang sama (marketplace_sku_map)
 *  3) judul produk sama persis (dinormalisasi)
 * Yang tak terpetakan TIDAK ditebak -- dilaporkan.
 */
@Injectable()
export class PromoCardsService {
  private readonly logger = new Logger(PromoCardsService.name);
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly tenant: TenantService,
    private readonly sync: MarketplaceSyncService,
  ) {}

  private bypass<T>(fn: () => Promise<T>) { return this.tenant.runBypass(fn); }

  /**
   * Cache detail activity. Kuota request TikTok dipakai bersama sinkron order
   * (terbukti: 40 detail beruntun -> 36009002 Too many requests), jadi detail
   * promo yang sudah selesai (tak bisa berubah lagi) disimpan 24 jam, yang
   * berjalan 10 menit.
   */
  private readonly cacheDetail = new Map<string, { at: number; ttl: number; data: Obj }>();

  private async detail(userId: string, shopId: string, activityId: string, status?: string): Promise<Obj> {
    const key = `${userId}:${shopId}:${activityId}`;
    const c = this.cacheDetail.get(key);
    if (c && Date.now() - c.at < c.ttl) return c.data;
    for (let coba = 0; ; coba++) {
      try {
        const data = (await this.sync.promoActivityDetail(userId, shopId, activityId)) as Obj;
        const st = String(status ?? data?.status ?? "").toUpperCase();
        const selesai = st === "EXPIRED" || st === "DEACTIVATED" || st === "NOT_EFFECT";
        this.cacheDetail.set(key, { at: Date.now(), ttl: selesai ? 24 * 3600e3 : 10 * 60e3, data });
        if (this.cacheDetail.size > 2000) this.cacheDetail.delete(this.cacheDetail.keys().next().value as string);
        return data;
      } catch (e) {
        const kode = (e as { code?: number }).code;
        if (kode === 36009002 && coba < 3) { await new Promise((r) => setTimeout(r, 1500 * (coba + 1))); continue; }
        throw e;
      }
    }
  }

  private static cocokStatus(st: string, filter: string) {
    const s = String(st ?? "").toUpperCase();
    if (!filter) return true;
    if (filter === "EXPIRED") return s === "EXPIRED" || s === "DEACTIVATED" || s === "NOT_EFFECT";
    return s === filter;
  }

  private async batasParalel<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let i = 0;
    const kerja = async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]!); } };
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, kerja));
    return out;
  }

  /** Nama & harga produk/SKU dari data sinkron (tanpa panggil TikTok lagi). */
  private async kamus(userId: string, productIds: string[]) {
    const nama = new Map<string, string>();
    const skuNama = new Map<string, string>();
    const skuHarga = new Map<string, number>();
    const hargaMin = new Map<string, number>();
    if (!productIds.length) return { nama, skuNama, skuHarga, hargaMin };
    const [ps, ss] = await this.bypass(async () => Promise.all([
      this.db.select({ productId: marketplaceProducts.productId, title: marketplaceProducts.title })
        .from(marketplaceProducts)
        .where(and(eq(marketplaceProducts.userId, userId), inArray(marketplaceProducts.productId, productIds))),
      this.db.select({ productId: marketplaceSkus.productId, skuId: marketplaceSkus.skuId, skuName: marketplaceSkus.skuName,
          productName: marketplaceSkus.productName, price: marketplaceSkus.price })
        .from(marketplaceSkus)
        .where(and(eq(marketplaceSkus.userId, userId), inArray(marketplaceSkus.productId, productIds))),
    ]));
    for (const p of ps) if (p.title) nama.set(p.productId, p.title);
    for (const s of ss) {
      if (s.productId && !nama.has(s.productId) && s.productName) nama.set(s.productId, s.productName);
      if (s.skuName) skuNama.set(s.skuId, s.skuName);
      const h = num(s.price);
      if (h != null) {
        skuHarga.set(s.skuId, h);
        if (s.productId) hargaMin.set(s.productId, Math.min(hargaMin.get(s.productId) ?? Infinity, h));
      }
    }
    return { nama, skuNama, skuHarga, hargaMin };
  }

  private static ringkasBmsm(d: Obj): string | null {
    const det = d?.discount?.bmsm_discount?.details;
    if (!Array.isArray(det) || !det.length) return null;
    return det.map((x: Obj) => {
      const syarat = x.threshold_type === "MINIMAL_ITEM_QUANTITY" ? `beli ≥${x.threshold_value} pcs` : `belanja ≥Rp${x.threshold_value}`;
      const hadiah = x.type === "PERCENTAGE_OFF" ? `-${x.value}%` : `-Rp${x.value}`;
      return `${syarat}: ${hadiah}`;
    }).join(" · ");
  }

  /** GET /promotion/cards?status= */
  async cards(userId: string, filter = "") {
    const f = String(filter || "").toUpperCase();
    const lists = await this.sync.promoListActivities(userId, {});
    const todo: Array<{ shopId: string; shopName: string; a: Obj }> = [];
    const otomatis: Array<{ shopId: string; shopName: string; count: number }> = [];
    const gagal: Array<{ shopId: string; shopName: string; error: string }> = [];
    for (const s of lists as Obj[]) {
      if (s.error) { gagal.push({ shopId: s.shopId, shopName: s.shopName, error: s.error }); continue; }
      let smart = 0;
      for (const a of (s.activities ?? []) as Obj[]) {
        if (!PromoCardsService.cocokStatus(a.status, f)) continue;
        if (isSmart(a)) { smart++; continue; }
        todo.push({ shopId: s.shopId, shopName: s.shopName, a });
      }
      if (smart) otomatis.push({ shopId: s.shopId, shopName: s.shopName, count: smart });
    }
    todo.sort((x, y) => Number(y.a.begin_time ?? 0) - Number(x.a.begin_time ?? 0));
    const BATAS = 30;
    const dipotong = todo.length > BATAS;
    const dipakai = todo.slice(0, BATAS);

    const detail = await this.batasParalel(dipakai, 2, async (x) => {
      try { return await this.detail(userId, x.shopId, String(x.a.id), x.a.status); }
      catch (e) { return { __error: (e as Error).message } as Obj; }
    });
    const semuaPid = new Set<string>();
    for (const d of detail) for (const p of (d?.products ?? []) as Obj[]) if (p?.id) semuaPid.add(String(p.id));
    const k = await this.kamus(userId, [...semuaPid]);

    const cards = dipakai.map((x, i) => {
      const d = detail[i] ?? {};
      const produk: PromoProduk[] = ((d.products ?? []) as Obj[]).map((p) => {
        const pid = String(p.id);
        return {
          productId: pid,
          name: k.nama.get(pid) ?? `Produk ${pid}`,
          discountPct: num(p.discount),
          activityPrice: num(p.activity_price?.amount ?? p.activity_price_amount),
          originalPrice: k.hargaMin.get(pid) ?? null,
          skus: ((p.skus ?? []) as Obj[]).map((s) => ({
            skuId: String(s.id),
            name: k.skuNama.get(String(s.id)) ?? `SKU ${s.id}`,
            discountPct: num(s.discount),
            activityPrice: num(s.activity_price?.amount ?? s.activity_price_amount),
            originalPrice: k.skuHarga.get(String(s.id)) ?? null,
          })),
        };
      });
      return {
        shopId: x.shopId, shopName: x.shopName, marketplace: "tiktok",
        activityId: String(x.a.id), title: x.a.title ?? "(tanpa judul)",
        type: x.a.activity_type ?? d.activity_type ?? null,
        level: x.a.product_level ?? d.product_level ?? null,
        status: x.a.status ?? d.status ?? null,
        beginTime: num(x.a.begin_time ?? d.begin_time), endTime: num(x.a.end_time ?? d.end_time),
        discountSummary: PromoCardsService.ringkasBmsm(d),
        products: produk,
        error: d.__error ?? null,
      };
    });
    return { cards, otomatis, gagal, dipotong, total: todo.length };
  }

  /* ------------------------------------------------ replikasi */

  /** Semua produk + SKU toko target, beserta kunci pemetaannya. */
  private async petaToko(userId: string, shopId: string) {
    const [ps, ss, map] = await this.bypass(async () => Promise.all([
      this.db.select({ productId: marketplaceProducts.productId, title: marketplaceProducts.title, catalogId: marketplaceProducts.catalogId })
        .from(marketplaceProducts)
        .where(and(eq(marketplaceProducts.userId, userId), eq(marketplaceProducts.shopId, shopId))),
      this.db.select({ productId: marketplaceSkus.productId, skuId: marketplaceSkus.skuId, skuName: marketplaceSkus.skuName, sellerSku: marketplaceSkus.sellerSku })
        .from(marketplaceSkus)
        .where(and(eq(marketplaceSkus.userId, userId), eq(marketplaceSkus.shopId, shopId))),
      this.db.select({ sku: marketplaceSkuMap.sku, master: marketplaceSkuMap.masterProductId })
        .from(marketplaceSkuMap)
        .where(eq(marketplaceSkuMap.userId, userId)),
    ]));
    const master = new Map(map.map((m) => [m.sku, m.master]));
    return { ps, ss, master };
  }

  private static petakan(
    src: { ps: Obj[]; ss: Obj[]; master: Map<string, string> },
    tgt: { ps: Obj[]; ss: Obj[]; master: Map<string, string> },
    pid: string,
  ): { productId: string; via: string } | null {
    const sp = src.ps.find((p) => p.productId === pid);
    if (sp?.catalogId) {
      const t = tgt.ps.find((p) => p.catalogId === sp.catalogId);
      if (t) return { productId: t.productId, via: "katalog" };
    }
    const masters = new Set(src.ss.filter((s) => s.productId === pid).map((s) => src.master.get(s.skuId)).filter(Boolean));
    if (masters.size) {
      const t = tgt.ss.find((s) => s.productId && masters.has(tgt.master.get(s.skuId) as string));
      if (t?.productId) return { productId: t.productId, via: "master produk" };
    }
    if (sp?.title) {
      const t = tgt.ps.find((p) => norm(p.title) === norm(sp.title));
      if (t) return { productId: t.productId, via: "nama sama" };
    }
    return null;
  }

  private static petakanSku(
    src: { ss: Obj[]; master: Map<string, string> },
    tgt: { ss: Obj[]; master: Map<string, string> },
    skuId: string, tgtProductId: string,
  ): string | null {
    const s = src.ss.find((x) => x.skuId === skuId);
    const kandidat = tgt.ss.filter((x) => x.productId === tgtProductId);
    if (!s || !kandidat.length) return null;
    const m = src.master.get(skuId);
    if (m) { const t = kandidat.find((x) => tgt.master.get(x.skuId) === m); if (t) return t.skuId; }
    if (s.sellerSku) { const t = kandidat.find((x) => x.sellerSku && x.sellerSku === s.sellerSku); if (t) return t.skuId; }
    if (s.skuName) { const t = kandidat.find((x) => norm(x.skuName) === norm(s.skuName)); if (t) return t.skuId; }
    if (kandidat.length === 1) return kandidat[0]!.skuId; // produk tanpa varian
    return null;
  }

  /**
   * Rencana (dryRun=true) atau eksekusi replikasi. Eksekusi = aksi OUTWARD
   * (membuat promo & mengubah harga di TikTok) -> hanya dari klik seller
   * setelah melihat rencananya.
   */
  async replicate(userId: string, shopId: string, activityId: string, body: {
    targetShopIds: string[]; dryRun?: boolean; beginTime?: number; endTime?: number;
  }) {
    const targets = [...new Set((body.targetShopIds ?? []).filter((x) => x && x !== shopId))];
    if (!targets.length) throw new BadRequestException("Pilih minimal satu toko tujuan");
    const src = await this.detail(userId, shopId, activityId);
    const sProds = (src.products ?? []) as Obj[];
    if (!sProds.length) throw new BadRequestException("Promo sumber tidak punya produk (atau sudah berakhir) — tidak ada yang bisa direplikasi");
    const type = String(src.activity_type ?? "DIRECT_DISCOUNT");
    const level = String(src.product_level ?? "PRODUCT");
    const durationType = String(src.duration_type ?? "NORMAL");
    const now = Math.floor(Date.now() / 1000);
    let b = Number(body.beginTime) || Number(src.begin_time) || 0;
    let e = Number(body.endTime) || Number(src.end_time) || 0;
    const dur = e > b ? e - b : 7 * 86400;
    if (b <= now + 300) { b = now + 600; e = b + dur; }

    const peta = await this.petaToko(userId, shopId);
    const tokoRows = await this.bypass(() => this.db.select({ id: shops.id, shopName: shops.shopName, displayName: shops.displayName, marketplace: shops.marketplace })
      .from(shops).where(and(eq(shops.userId, userId), inArray(shops.id, targets))));

    const hasil: Obj[] = [];
    for (const tid of targets) {
      const row = tokoRows.find((r) => r.id === tid);
      const nama = row?.displayName || row?.shopName || tid;
      if (!row || row.marketplace !== "tiktok") { hasil.push({ shopId: tid, shopName: nama, error: "Bukan toko TikTok" }); continue; }
      const tp = await this.petaToko(userId, tid);
      const cocok: Obj[] = [];
      const tak: string[] = [];
      for (const p of sProds) {
        const m = PromoCardsService.petakan(peta, tp, String(p.id));
        if (!m) { tak.push(String(p.id)); continue; }
        const item: Obj = { id: m.productId, quantity_limit: p.quantity_limit ?? -1, quantity_per_user: p.quantity_per_user ?? -1 };
        if (level === "VARIATION") {
          const skus: Obj[] = [];
          for (const s of (p.skus ?? []) as Obj[]) {
            const ts = PromoCardsService.petakanSku(peta, tp, String(s.id), m.productId);
            if (!ts) continue;
            const x: Obj = { id: ts, quantity_limit: s.quantity_limit ?? -1, quantity_per_user: s.quantity_per_user ?? -1 };
            if (s.discount != null && s.discount !== "") x.discount = String(s.discount);
            const ap = s.activity_price?.amount ?? s.activity_price_amount;
            if (ap != null && ap !== "") x.activity_price_amount = String(ap);
            skus.push(x);
          }
          if (!skus.length) { tak.push(String(p.id)); continue; }
          item.skus = skus;
        } else {
          if (p.discount != null && p.discount !== "") item.discount = String(p.discount);
          const ap = p.activity_price?.amount ?? p.activity_price_amount;
          if (ap != null && ap !== "") item.activity_price_amount = String(ap);
        }
        cocok.push({ ...item, __via: m.via, __src: String(p.id) });
      }
      const judul = (pid: string) => peta.ps.find((p) => p.productId === pid)?.title ?? `Produk ${pid}`;
      const ringkas = { shopId: tid, shopName: nama, cocok: cocok.length, total: sProds.length,
        tidakTerpetakan: tak.map((pid) => ({ productId: pid, name: judul(pid) })),
        via: cocok.map((c) => ({ dari: c.__src, ke: c.id, via: c.__via, name: judul(c.__src) })) };
      if (body.dryRun) { hasil.push(ringkas); continue; }
      if (!cocok.length) { hasil.push({ ...ringkas, error: "Tidak ada produk yang terpetakan ke toko ini" }); continue; }
      try {
        const buat: Obj = {
          activity_type: type,
          title: `${String(src.title ?? "Promo")}`.slice(0, 38) + ` ${new Date(now * 1000).toISOString().slice(5, 16).replace(/[-T:]/g, "")}`,
          product_level: level, duration_type: durationType,
        };
        if (durationType === "NORMAL") { buat.begin_time = b; buat.end_time = e; }
        if (src.discount?.bmsm_discount) buat.discount = { bmsm_discount: src.discount.bmsm_discount };
        if (src.participation_limit) buat.participation_limit = src.participation_limit;
        if (src.target_user_info) buat.target_user_info = src.target_user_info;
        const created = (await this.sync.promoCreate(userId, tid, buat)) as Obj;
        const newId = String(created?.activity_id ?? created?.id ?? "");
        if (!newId) throw new Error("TikTok tidak mengembalikan ID promo baru");
        const payload = cocok.map(({ __via, __src, ...r }) => r);
        try {
          await this.sync.promoAddProducts(userId, tid, newId, payload);
        } catch (err) {
          // Jangan tinggalkan promo kosong di TikTok: nonaktifkan lalu laporkan.
          await this.sync.promoDeactivate(userId, tid, newId).catch(() => {});
          throw new Error(`Promo dibuat tapi produk ditolak TikTok (promo kosong sudah dinonaktifkan): ${(err as Error).message}`);
        }
        // Verifikasi: baca ULANG dari TikTok -- bukti produk benar-benar
        // terdaftar, bukan sekadar "tidak ada error".
        let terverifikasi: number | null = null;
        let statusBaru: string | null = null;
        try {
          const cek = (await this.sync.promoActivityDetail(userId, tid, newId)) as Obj;
          terverifikasi = ((cek?.products ?? []) as Obj[]).length;
          statusBaru = cek?.status ?? null;
        } catch { /* verifikasi gagal dibaca != replikasi gagal */ }
        hasil.push({ ...ringkas, activityId: newId, title: buat.title, terverifikasi, statusBaru });
      } catch (err) {
        hasil.push({ ...ringkas, error: (err as Error).message });
      }
    }
    this.logger.log(`replicate ${activityId} (${type}/${level}) -> ${targets.length} toko dryRun=${!!body.dryRun}`);
    return { source: { shopId, activityId, title: src.title, type, level, products: sProds.length }, beginTime: b, endTime: e, dryRun: !!body.dryRun, hasil };
  }
}
