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

  /**
   * Estimasi PROFIT BERSIH utk kumpulan item pesanan (rupiah, string) atau null
   * bila tak ada satu pun item yang dikenali+ber-costing. Pakai harga jual aktual
   * tiap item lewat calculatePublishPricing (logika menu HPP & Harga Jual).
   */
  netProfitForItems(items: unknown, ctx: ProfitContext): string | null {
    const n = this.netProfitNumber(items, ctx);
    return n == null ? null : String(Math.round(n));
  }

  /** Profit bersih SATU item pesanan (rupiah) atau null bila tak dikenali/ber-costing. */
  netProfitForItem(item: Record<string, unknown>, ctx: ProfitContext): number | null {
    const m = this.resolveItemMaster(item, ctx);
    if (!m) return null;
    const basis = ctx.basisByMaster.get(m.mid);
    if (!basis) return null;
    const salePrice = Number(item.salePrice ?? item.sale_price ?? 0);
    const qty = Number(item.qty ?? item.quantity ?? 0) || 0;
    if (!Number.isFinite(salePrice) || salePrice <= 0 || qty <= 0) return null;
    const pr = calculatePublishPricing({
      publishPriceCents: Math.round(salePrice * 100),
      hppCents: basis.hppCents,
      marketplaceFeeRate: basis.marketplaceFeeRate,
      eventRate: basis.eventRate,
      affiliatorRate: basis.affiliatorRate,
      adsRate: basis.adsRate,
      adsFixedCents: basis.adsFixedCents,
      sedekahRate: basis.sedekahRate,
      resellerRate: basis.resellerRate,
    });
    return (pr.netProfitCents / 100) * qty;
  }

  /** Versi numerik (rupiah) — dipakai dashboard utk menjumlah lintas order. */
  netProfitNumber(items: unknown, ctx: ProfitContext): number | null {
    if (!Array.isArray(items)) return null;
    let total = 0;
    let ada = false;
    for (const it of items) {
      const o2 = (it && typeof it === "object" ? it : {}) as Record<string, unknown>;
      const m = this.resolveItemMaster(o2, ctx);
      if (!m) continue;
      const basis = ctx.basisByMaster.get(m.mid);
      if (!basis) continue;
      const salePrice = Number(o2.salePrice ?? o2.sale_price ?? 0);
      const qty = Number(o2.qty ?? o2.quantity ?? 0) || 0;
      if (!Number.isFinite(salePrice) || salePrice <= 0 || qty <= 0) continue;
      const pr = calculatePublishPricing({
        publishPriceCents: Math.round(salePrice * 100),
        hppCents: basis.hppCents,
        marketplaceFeeRate: basis.marketplaceFeeRate,
        eventRate: basis.eventRate,
        affiliatorRate: basis.affiliatorRate,
        adsRate: basis.adsRate,
        adsFixedCents: basis.adsFixedCents,
        sedekahRate: basis.sedekahRate,
        resellerRate: basis.resellerRate,
      });
      total += (pr.netProfitCents / 100) * qty;
      ada = true;
    }
    return ada ? total : null;
  }
}
