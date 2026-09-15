import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  marketplaceSkus,
  marketplaceSkuMap,
  masterProducts,
  shops,
} from "../../database/schema/index.js";

/**
 * Fase 2 — monitoring stok omnichannel (web-only, read-only).
 *
 * Menyatukan stok tiap SKU marketplace (marketplace_skus, hasil sinkron API)
 * lintas toko/channel menjadi satu layar kesehatan stok: mana yang HABIS, mana
 * yang MENIPIS, mana yang TAK-TAHU (stok null = marketplace tak melaporkan),
 * dan — untuk SKU yang sudah dipetakan ke master (marketplace_sku_map) — mana
 * yang stoknya TAK-SINKRON antar listing dari master yang sama.
 *
 * Tidak menulis apa pun ke marketplace. Push stok/harga adalah tulisan keluar
 * ke listing live: itu aksi manual+konfirmasi tersendiri (lihat push-nama pada
 * marketplace-sync) dan kontrak endpoint inventory/price-nya diverifikasi saat
 * scope Product-write dipakai — didokumentasikan sebagai homework, bukan di
 * sini. Layar ini murni pemantauan.
 */
const AMBANG_MENIPIS = 5;

export type StatusStok = "habis" | "menipis" | "aman" | "tak_tahu";

function statusDari(stok: number | null): StatusStok {
  if (stok == null) return "tak_tahu";
  if (stok <= 0) return "habis";
  if (stok <= AMBANG_MENIPIS) return "menipis";
  return "aman";
}

@Injectable()
export class InventoryService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async omnichannel(userId: string) {
    const rows = await this.db
      .select({
        id: marketplaceSkus.id,
        marketplace: marketplaceSkus.marketplace,
        shopId: marketplaceSkus.shopId,
        shopName: sql<string>`coalesce(${shops.displayName}, ${shops.shopName})`,
        productId: marketplaceSkus.productId,
        productName: marketplaceSkus.productName,
        skuId: marketplaceSkus.skuId,
        skuName: marketplaceSkus.skuName,
        sellerSku: marketplaceSkus.sellerSku,
        price: marketplaceSkus.price,
        stock: marketplaceSkus.stock,
        syncedAt: marketplaceSkus.syncedAt,
        masterId: marketplaceSkuMap.masterProductId,
        masterName: masterProducts.name,
      })
      .from(marketplaceSkus)
      .leftJoin(shops, eq(shops.id, marketplaceSkus.shopId))
      .leftJoin(
        marketplaceSkuMap,
        and(
          eq(marketplaceSkuMap.userId, marketplaceSkus.userId),
          eq(marketplaceSkuMap.marketplace, marketplaceSkus.marketplace),
          eq(marketplaceSkuMap.sku, marketplaceSkus.skuId),
        ),
      )
      .leftJoin(masterProducts, eq(masterProducts.id, marketplaceSkuMap.masterProductId))
      .where(eq(marketplaceSkus.userId, userId));

    // Deteksi TAK-SINKRON: master yang stok antar listing/varian-nya berbeda.
    // Hanya menghitung nilai stok yang diketahui (null diabaikan); butuh >= 2
    // nilai yang berbeda untuk disebut tak sinkron.
    const stokPerMaster = new Map<string, Set<number>>();
    for (const r of rows) {
      if (!r.masterId || r.stock == null) continue;
      if (!stokPerMaster.has(r.masterId)) stokPerMaster.set(r.masterId, new Set());
      stokPerMaster.get(r.masterId)!.add(r.stock);
    }
    const masterTakSinkron = new Set<string>();
    for (const [mid, set] of stokPerMaster) if (set.size > 1) masterTakSinkron.add(mid);

    const items = rows
      .map((r) => {
        const stock = r.stock;
        const status = statusDari(stock);
        return {
          id: r.id,
          marketplace: r.marketplace,
          shopId: r.shopId,
          shopName: r.shopName ?? "(toko tak dikenal)",
          productId: r.productId,
          productName: r.productName,
          skuId: r.skuId,
          skuName: r.skuName,
          sellerSku: r.sellerSku,
          price: r.price != null ? Number(r.price) : null,
          stock,
          status,
          masterId: r.masterId,
          masterName: r.masterName,
          takSinkron: r.masterId ? masterTakSinkron.has(r.masterId) : false,
          syncedAt: r.syncedAt,
        };
      })
      // Yang butuh perhatian didahulukan: habis, menipis, tak-tahu, lalu aman.
      .sort((a, b) => {
        const order: Record<StatusStok, number> = { habis: 0, menipis: 1, tak_tahu: 2, aman: 3 };
        const d = order[a.status] - order[b.status];
        if (d !== 0) return d;
        return (a.stock ?? 0) - (b.stock ?? 0);
      });

    const perToko = new Map<
      string,
      { shopId: string; shopName: string; marketplace: string; total: number; habis: number; menipis: number; takTahu: number }
    >();
    for (const it of items) {
      const key = it.shopId ?? "?";
      if (!perToko.has(key)) {
        perToko.set(key, {
          shopId: it.shopId ?? "?",
          shopName: it.shopName,
          marketplace: it.marketplace,
          total: 0,
          habis: 0,
          menipis: 0,
          takTahu: 0,
        });
      }
      const t = perToko.get(key)!;
      t.total += 1;
      if (it.status === "habis") t.habis += 1;
      else if (it.status === "menipis") t.menipis += 1;
      else if (it.status === "tak_tahu") t.takTahu += 1;
    }

    const ringkasan = {
      totalSku: items.length,
      habis: items.filter((i) => i.status === "habis").length,
      menipis: items.filter((i) => i.status === "menipis").length,
      takTahu: items.filter((i) => i.status === "tak_tahu").length,
      terpetakan: items.filter((i) => i.masterId).length,
      takSinkron: masterTakSinkron.size,
      ambangMenipis: AMBANG_MENIPIS,
    };

    return { ringkasan, perToko: [...perToko.values()], items };
  }
}
