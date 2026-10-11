import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { calculatePublishPricing } from "@autotoko/shared";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  marketplaceSkuMap,
  masterPostingMappings,
  masterPostingSkus,
  masterProducts,
} from "../../database/schema/index.js";
import { CostingService } from "./costing.service.js";

type Basis = {
  productId: string;
  hppCents: number;
  publishPrice: number | null;
  marketplaceFeeRate: number;
  eventRate: number;
  affiliatorRate: number;
  adsRate: number;
  adsFixedCents: number;
  sedekahRate: number;
  resellerRate: number;
};

export interface ProfitContext {
  /** marketplace_sku_map: skuId -> masterProductId (keputusan manual, prioritas tertinggi). */
  manual: Map<string, string>;
  /** master_posting_mappings: productId -> postingId (mode update saja). */
  mappingByProduct: Map<string, string>;
  /** postingId -> daftar {nilai varian ternormalisasi, masterProductId}. */
  postingMasters: Map<string, { vals: string[]; mid: string }[]>;
  /** masterProductId -> nama. */
  masterName: Map<string, string>;
  /** masterProductId -> basis costing (HPP + rate). */
  basisByMaster: Map<string, Basis>;
}

/**
 * Menghubungkan item pesanan ke master produk (untuk HPP/profit) dari DUA sumber:
 * (1) peta SKU manual, lalu (2) DERIVASI dari Master Postingan — item.productId ->
 * mapping listing -> posting -> SKU master (master tunggal, atau cocokkan nama
 * varian). Dipakai bersama oleh menu Order & dashboard supaya angka profit konsisten.
 */
@Injectable()
export class OrderProfitService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly costing: CostingService,
  ) {}

  async loadContext(userId: string): Promise<ProfitContext> {
    const [manualRows, mappingRows, postingSkuRows, masterRows, basisList] = await Promise.all([
      this.db
        .select({ sku: marketplaceSkuMap.sku, mid: marketplaceSkuMap.masterProductId })
        .from(marketplaceSkuMap)
        .where(eq(marketplaceSkuMap.userId, userId)),
      this.db
        .select({
          productId: masterPostingMappings.productId,
          postingId: masterPostingMappings.masterPostingId,
          status: masterPostingMappings.status,
        })
        .from(masterPostingMappings)
        .where(eq(masterPostingMappings.userId, userId)),
      this.db
        .select({
          postingId: masterPostingSkus.masterPostingId,
          combo: masterPostingSkus.combo,
          mid: masterPostingSkus.masterProductId,
        })
        .from(masterPostingSkus)
        .where(eq(masterPostingSkus.userId, userId)),
      this.db
        .select({ id: masterProducts.id, name: masterProducts.name })
        .from(masterProducts)
        .where(eq(masterProducts.userId, userId)),
      this.costing.pricingBasis(userId),
    ]);

    const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
    const manual = new Map(manualRows.map((r) => [String(r.sku), r.mid] as const));
    const mappingByProduct = new Map<string, string>();
    for (const m of mappingRows) {
      if (m.productId && m.status !== "create") mappingByProduct.set(String(m.productId), m.postingId);
    }
    const postingMasters = new Map<string, { vals: string[]; mid: string }[]>();
    for (const r of postingSkuRows) {
      if (!r.mid) continue;
      const combo = r.combo && typeof r.combo === "object" ? (r.combo as Record<string, string>) : {};
      const vals = Object.values(combo).map(norm).filter(Boolean);
      const arr = postingMasters.get(r.postingId) ?? [];
      arr.push({ vals, mid: r.mid });
      postingMasters.set(r.postingId, arr);
    }
    const masterName = new Map(masterRows.map((r) => [r.id, r.name] as const));
    const basisByMaster = new Map((basisList as Basis[]).map((b) => [b.productId, b] as const));
    return { manual, mappingByProduct, postingMasters, masterName, basisByMaster };
  }

  /** Item pesanan -> master produk, atau null bila tak dikenali. */
  resolveItemMaster(item: Record<string, unknown>, ctx: ProfitContext): { mid: string; name: string | null } | null {
    const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
    const skuId = item.skuId != null ? String(item.skuId) : "";
    if (skuId && ctx.manual.has(skuId)) {
      const mid = ctx.manual.get(skuId)!;
      return { mid, name: ctx.masterName.get(mid) ?? null };
    }
    const productId = item.productId != null ? String(item.productId) : "";
    if (!productId) return null;
    const postingId = ctx.mappingByProduct.get(productId);
    if (!postingId) return null;
    const masters = ctx.postingMasters.get(postingId) ?? [];
    if (!masters.length) return null;
    const distinct = [...new Set(masters.map((m) => m.mid))];
    let mid: string | undefined;
    if (distinct.length === 1) {
      mid = distinct[0];
    } else {
      // Multi-varian: cocokkan nama varian pesanan (skuName) dgn nilai kombinasi.
      const name = norm(item.skuName ?? item.skuId);
      const hit = masters.find((m) => m.vals.length && m.vals.every((v) => name.includes(v)));
      mid = hit?.mid;
    }
    if (!mid) return null;
    return { mid, name: ctx.masterName.get(mid) ?? null };
  }

  /** Nama master produk utk sebuah item (null bila tak dikenali). */
  masterNameForItem(item: Record<string, unknown>, ctx: ProfitContext): string | null {
    return this.resolveItemMaster(item, ctx)?.name ?? null;
  }

  /** ID master produk utk sebuah item (null bila tak dikenali). */
  masterIdForItem(item: Record<string, unknown>, ctx: ProfitContext): string | null {
    return this.resolveItemMaster(item, ctx)?.mid ?? null;
  }

  /**
   * Estimasi PROFIT BERSIH utk kumpulan item pesanan (rupiah, string) atau null
   * bila tak ada satu pun item yang dikenali+ber-costing. Pakai harga jual aktual
   * tiap item lewat calculatePublishPricing (logika menu HPP & Harga Jual).
   */
  netProfitForItems(items: unknown, ctx: ProfitContext): string | null {
    const n = this.netProfitNumber(items, ctx);
    return n == null ? null : String(Math.round(n));
  }

  /**
   * Harga jual REAL per unit dari item order (yg tampil di halaman Order):
   * `salePrice`, atau `subtotal`/qty. null bila item tak membawa harga.
   */
  private realUnitPrice(item: Record<string, unknown>): number | null {
    const sp = Number(item.salePrice);
    if (Number.isFinite(sp) && sp > 0) return sp;
    const sub = Number(item.subtotal);
    const qty = Number(item.qty ?? item.quantity ?? 0) || 0;
    if (Number.isFinite(sub) && sub > 0 && qty > 0) return sub / qty;
    return null;
  }

  /**
   * Profit bersih per 1 unit. Basis harga = HARGA JUAL REAL dari order (halaman
   * Order) bila ada, fallback ke harga publish master (menu HPP). Potongan
   * (marketplace fee/event/affiliator, sedekah, sub-seller, ads) + HPP/bahan baku
   * tetap dari rumus & rate Master Produk/HPP. null bila master tak ber-costing
   * atau tak ada harga sama sekali.
   */
  unitProfitForItem(item: Record<string, unknown>, ctx: ProfitContext): number | null {
    const m = this.resolveItemMaster(item, ctx);
    if (!m) return null;
    const basis = ctx.basisByMaster.get(m.mid);
    if (!basis) return null;
    const real = this.realUnitPrice(item);
    const priceCents =
      real != null
        ? Math.round(real * 100)
        : basis.publishPrice != null && basis.publishPrice > 0
          ? Math.round(basis.publishPrice * 100)
          : null;
    if (priceCents == null || priceCents <= 0) return null;
    const pr = calculatePublishPricing({
      publishPriceCents: priceCents,
      hppCents: basis.hppCents,
      marketplaceFeeRate: basis.marketplaceFeeRate,
      eventRate: basis.eventRate,
      affiliatorRate: basis.affiliatorRate,
      adsRate: basis.adsRate,
      adsFixedCents: basis.adsFixedCents,
      sedekahRate: basis.sedekahRate,
      resellerRate: basis.resellerRate,
    });
    return pr.netProfitCents / 100;
  }

  /**
   * Profit bersih per unit JIKA dijual di HARGA PUBLISH master (abaikan harga
   * order) — untuk membandingkan "harusnya" vs "jadi" saat harga jual beda.
   * null bila master tak punya harga publish.
   */
  publishUnitProfitForItem(item: Record<string, unknown>, ctx: ProfitContext): number | null {
    const m = this.resolveItemMaster(item, ctx);
    if (!m) return null;
    const basis = ctx.basisByMaster.get(m.mid);
    if (!basis || basis.publishPrice == null || basis.publishPrice <= 0) return null;
    const pr = calculatePublishPricing({
      publishPriceCents: Math.round(basis.publishPrice * 100),
      hppCents: basis.hppCents,
      marketplaceFeeRate: basis.marketplaceFeeRate,
      eventRate: basis.eventRate,
      affiliatorRate: basis.affiliatorRate,
      adsRate: basis.adsRate,
      adsFixedCents: basis.adsFixedCents,
      sedekahRate: basis.sedekahRate,
      resellerRate: basis.resellerRate,
    });
    return pr.netProfitCents / 100;
  }

  /**
   * Profit bersih SATU item pesanan (rupiah) = profit per unit (HARGA JUAL REAL
   * order, rumus + rate menu HPP) x qty terjual. null bila tak dikenali / tak ada harga.
   */
  netProfitForItem(item: Record<string, unknown>, ctx: ProfitContext): number | null {
    const perUnit = this.unitProfitForItem(item, ctx);
    if (perUnit == null) return null;
    const qty = Number(item.qty ?? item.quantity ?? 0) || 0;
    if (qty <= 0) return null;
    return perUnit * qty;
  }

  /**
   * Item pesanan yang HARGA JUAL REAL-nya beda (>=0.5%) dari harga publish master.
   * Dikelompokkan per master + dampak profit (harusnya di harga master -> jadi di
   * harga real). Dipakai menandai order & menautkan ke menu Master Produk/HPP.
   */
  itemsPriceDiff(
    items: unknown,
    ctx: ProfitContext,
  ): Array<{
    masterId: string;
    nama: string;
    hargaMaster: number;
    hargaJual: number[];
    qty: number;
    profitHarusnya: number;
    profitJadi: number;
    selisih: number;
  }> {
    if (!Array.isArray(items)) return [];
    const byMaster = new Map<
      string,
      { masterId: string; nama: string; hargaMaster: number; hargaJual: Set<number>; qty: number; profitHarusnya: number; profitJadi: number }
    >();
    for (const it of items) {
      const o2 = (it && typeof it === "object" ? it : {}) as Record<string, unknown>;
      const m = this.resolveItemMaster(o2, ctx);
      if (!m) continue;
      const basis = ctx.basisByMaster.get(m.mid);
      if (!basis || basis.publishPrice == null || basis.publishPrice <= 0) continue;
      const qty = Number(o2.qty ?? o2.quantity ?? 0) || 0;
      if (qty <= 0) continue;
      const realUnit = this.realUnitPrice(o2);
      if (realUnit == null || realUnit <= 0) continue;
      if (Math.abs(realUnit - basis.publishPrice) / basis.publishPrice < 0.005) continue;
      const pubUnit = this.publishUnitProfitForItem(o2, ctx);
      const realLine = this.netProfitForItem(o2, ctx);
      const e =
        byMaster.get(m.mid) ??
        { masterId: m.mid, nama: m.name ?? "(tanpa nama)", hargaMaster: Math.round(basis.publishPrice), hargaJual: new Set<number>(), qty: 0, profitHarusnya: 0, profitJadi: 0 };
      e.qty += qty;
      e.hargaJual.add(Math.round(realUnit));
      if (pubUnit != null) e.profitHarusnya += pubUnit * qty;
      if (realLine != null) e.profitJadi += realLine;
      byMaster.set(m.mid, e);
    }
    return [...byMaster.values()].map((e) => ({
      masterId: e.masterId,
      nama: e.nama,
      hargaMaster: e.hargaMaster,
      hargaJual: [...e.hargaJual].sort((a, b) => a - b),
      qty: e.qty,
      profitHarusnya: Math.round(e.profitHarusnya),
      profitJadi: Math.round(e.profitJadi),
      selisih: Math.round(e.profitJadi - e.profitHarusnya),
    }));
  }

    /** Versi numerik (rupiah) — dipakai dashboard utk menjumlah lintas order. */
  netProfitNumber(items: unknown, ctx: ProfitContext): number | null {
    if (!Array.isArray(items)) return null;
    let total = 0;
    let ada = false;
    for (const it of items) {
      const o2 = (it && typeof it === "object" ? it : {}) as Record<string, unknown>;
      const np = this.netProfitForItem(o2, ctx);
      if (np != null) {
        total += np;
        ada = true;
      }
    }
    return ada ? total : null;
  }
}
