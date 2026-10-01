import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  masterPostings,
  masterPostingSkus,
  masterPostingMappings,
  masterProducts,
  marketplaceProducts,
  marketplaceSkus,
  productCosting,
  shops,
} from "../../database/schema/index.js";
import { CryptoService } from "../../common/crypto/crypto.service.js";
import { TikTokAdapter } from "../../marketplace/adapters/tiktok.adapter.js";
import { ShopsService } from "../shops/shops.service.js";
import { MarketplaceSyncService } from "../marketplace-sync/marketplace-sync.service.js";
import { CostingService } from "../costing/costing.service.js";
import { TikTokApiError, TikTokClient } from "../marketplace-sync/tiktok-client.js";
import type {
  AddMappingDto,
  CreateMasterPostingDto,
  SetSkuDto,
  UpdateMasterPostingDto,
} from "./dto/master-postings.dto.js";

type VariantGroup = { name: string; values: string[] };

/**
 * Master Postingan: template listing lintas toko + varian→SKU + terapkan ke
 * marketplace.
 *
 * Tenancy: setiap query difilter user_id (mengikuti products.service — request
 * membawa app.user_id, tanpa bypass). Tulisan keluar ke marketplace HANYA lewat
 * apply() yang dipicu klik eksplisit penjual; simpan biasa tidak menyentuh
 * marketplace kecuali autoApply dinyalakan.
 */
@Injectable()
export class MasterPostingsService {
  private readonly logger = new Logger(MasterPostingsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly tiktok: TikTokAdapter,
    private readonly shops: ShopsService,
    private readonly sync: MarketplaceSyncService,
    private readonly costing: CostingService,
  ) {}

  // ---------------------------------------------------------------- varian → SKU

  /** Bereskan grup varian dari input longgar: nama non-kosong, nilai unik non-kosong. */
  private sanitizeGroups(input: unknown): VariantGroup[] {
    if (!Array.isArray(input)) return [];
    const out: VariantGroup[] = [];
    for (const g of input) {
      if (!g || typeof g !== "object") continue;
      const name = String((g as VariantGroup).name ?? "").trim();
      const rawVals = (g as VariantGroup).values;
      if (!name || !Array.isArray(rawVals)) continue;
      const seen = new Set<string>();
      const values: string[] = [];
      for (const v of rawVals) {
        const s = String(v ?? "").trim();
        if (!s || seen.has(s.toLowerCase())) continue;
        seen.add(s.toLowerCase());
        values.push(s);
      }
      if (values.length) out.push({ name, values });
    }
    return out;
  }

  /** Perkalian kartesian grup → daftar kombinasi {grup: nilai} + kunci kanonik. */
  private buildCombos(groups: VariantGroup[]): { combo: Record<string, string>; comboKey: string }[] {
    if (!groups.length) return [{ combo: {}, comboKey: "" }];
    let acc: { combo: Record<string, string>; parts: string[] }[] = [{ combo: {}, parts: [] }];
    for (const g of groups) {
      const next: { combo: Record<string, string>; parts: string[] }[] = [];
      for (const a of acc) {
        for (const v of g.values) {
          next.push({ combo: { ...a.combo, [g.name]: v }, parts: [...a.parts, v] });
        }
      }
      acc = next;
    }
    return acc.map((a) => ({ combo: a.combo, comboKey: a.parts.join("|") }));
  }

  /**
   * Regenerasi SKU dari grup varian, mempertahankan baris lama menurut combo_key
   * (sku/master/harga/stok/gambar tidak hilang saat varian ditambah/diubah).
   * Kombinasi yang tak lagi ada dihapus.
   */
  private async regenerateSkus(userId: string, postingId: string, groups: VariantGroup[]): Promise<void> {
    const wanted = this.buildCombos(groups);
    const wantedKeys = new Set(wanted.map((w) => w.comboKey));
    const existing = await this.db
      .select()
      .from(masterPostingSkus)
      .where(and(eq(masterPostingSkus.userId, userId), eq(masterPostingSkus.masterPostingId, postingId)));
    const byKey = new Map(existing.map((e) => [e.comboKey, e] as const));

    // Hapus kombinasi usang.
    const staleIds = existing.filter((e) => !wantedKeys.has(e.comboKey)).map((e) => e.id);
    if (staleIds.length) {
      await this.db.delete(masterPostingSkus).where(inArray(masterPostingSkus.id, staleIds));
    }
    // Tambah kombinasi baru; yang sudah ada dibiarkan apa adanya (hanya combo di-refresh).
    const toInsert = wanted
      .filter((w) => !byKey.has(w.comboKey))
      .map((w) => ({
        userId,
        masterPostingId: postingId,
        combo: w.combo,
        comboKey: w.comboKey,
      }));
    if (toInsert.length) {
      await this.db.insert(masterPostingSkus).values(toInsert);
    }
    // Segarkan label combo baris lama (nama grup bisa berubah walau key sama).
    for (const w of wanted) {
      const cur = byKey.get(w.comboKey);
      if (cur && JSON.stringify(cur.combo) !== JSON.stringify(w.combo)) {
        await this.db
          .update(masterPostingSkus)
          .set({ combo: w.combo, updatedAt: new Date() })
          .where(eq(masterPostingSkus.id, cur.id));
      }
    }
  }

  // ---------------------------------------------------------------- CRUD

  async create(userId: string, dto: CreateMasterPostingDto) {
    const groups = this.sanitizeGroups(dto.variantGroups);
    const [row] = await this.db
      .insert(masterPostings)
      .values({
        userId,
        name: dto.name.trim(),
        description: dto.description ?? null,
        categoryId: dto.categoryId ?? null,
        brand: dto.brand ?? null,
        images: dto.images ?? [],
        variantGroups: groups,
        attributes: dto.attributes ?? {},
        autoApply: dto.autoApply ?? false,
        status: dto.status ?? "draft",
      })
      .returning();
    await this.regenerateSkus(userId, row!.id, groups);
    return this.get(userId, row!.id);
  }

  /** Unit & omzet 30 hari per (shop, productId) dari orders.items. */
  private async aggSalesByPair(userId: string, shopIds: string[], pids: string[]): Promise<Map<string, { units: number; revenue: number; orders: number }>> {
    const out = new Map<string, { units: number; revenue: number; orders: number }>();
    if (!shopIds.length || !pids.length) return out;
    const res = (await this.db.execute(sql`
      SELECT o.shop_id AS shop_id, it->>'productId' AS pid,
             COALESCE(SUM((it->>'qty')::int), 0) AS units,
             COALESCE(SUM((it->>'subtotal')::numeric), 0) AS revenue,
             COUNT(DISTINCT o.id) AS orders
      FROM orders o, jsonb_array_elements(COALESCE(o.items, '[]'::jsonb)) it
      WHERE o.user_id = ${userId}::uuid
        AND o.shop_id IN (${sql.join(shopIds.map((x) => sql`${x}::uuid`), sql`, `)})
        AND it->>'productId' IN (${sql.join(pids.map((x) => sql`${x}`), sql`, `)})
        AND COALESCE(o.created_at_marketplace, o.created_at) >= now() - interval '30 days'
      GROUP BY o.shop_id, it->>'productId'
    `)) as unknown;
    const arr: Array<Record<string, unknown>> = Array.isArray(res) ? (res as any) : ((res as any)?.rows ?? []);
    for (const r of arr) {
      out.set(`${String(r.shop_id)}:${String(r.pid)}`, {
        units: Number(r.units) || 0,
        revenue: Number(r.revenue) || 0,
        orders: Number(r.orders) || 0,
      });
    }
    return out;
  }

  async list(userId: string) {
    const rows = await this.db
      .select()
      .from(masterPostings)
      .where(eq(masterPostings.userId, userId))
      .orderBy(desc(masterPostings.updatedAt));
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const skus = await this.db
      .select({ postingId: masterPostingSkus.masterPostingId, mapped: masterPostingSkus.masterProductId, price: masterPostingSkus.price })
      .from(masterPostingSkus)
      .where(inArray(masterPostingSkus.masterPostingId, ids));
    const maps = await this.db
      .select({
        postingId: masterPostingMappings.masterPostingId,
        shopId: masterPostingMappings.shopId,
        productId: masterPostingMappings.productId,
        status: masterPostingMappings.status,
      })
      .from(masterPostingMappings)
      .where(inArray(masterPostingMappings.masterPostingId, ids));
    const skuCount = new Map<string, number>();
    const mappedCount = new Map<string, number>();
    const priceMin = new Map<string, number>();
    const priceMax = new Map<string, number>();
    for (const s of skus) {
      skuCount.set(s.postingId, (skuCount.get(s.postingId) ?? 0) + 1);
      if (s.mapped) mappedCount.set(s.postingId, (mappedCount.get(s.postingId) ?? 0) + 1);
      const p = s.price == null ? null : Number(s.price);
      if (p != null && !Number.isNaN(p)) {
        priceMin.set(s.postingId, Math.min(priceMin.get(s.postingId) ?? Infinity, p));
        priceMax.set(s.postingId, Math.max(priceMax.get(s.postingId) ?? -Infinity, p));
      }
    }
    const mapCount = new Map<string, number>();
    for (const m of maps) mapCount.set(m.postingId, (mapCount.get(m.postingId) ?? 0) + 1);

    // Penjualan 30 hari, roll-up per posting dari listing termapping (mode update).
    const pairMaps = maps.filter((m) => m.status !== "create" && m.productId);
    const salesByPair = await this.aggSalesByPair(
      userId,
      [...new Set(pairMaps.map((m) => m.shopId))],
      [...new Set(pairMaps.map((m) => m.productId as string))],
    );
    const sales30d = new Map<string, number>();
    const revenue30d = new Map<string, number>();
    for (const m of pairMaps) {
      const v = salesByPair.get(`${m.shopId}:${m.productId}`);
      if (!v) continue;
      sales30d.set(m.postingId, (sales30d.get(m.postingId) ?? 0) + v.units);
      revenue30d.set(m.postingId, (revenue30d.get(m.postingId) ?? 0) + v.revenue);
    }
    return rows.map((r) => ({
      ...r,
      imageCount: r.images?.length ?? 0,
      skuCount: skuCount.get(r.id) ?? 0,
      skuMappedCount: mappedCount.get(r.id) ?? 0,
      mappingCount: mapCount.get(r.id) ?? 0,
      priceMin: priceMin.has(r.id) ? priceMin.get(r.id)! : null,
      priceMax: priceMax.has(r.id) ? priceMax.get(r.id)! : null,
      sales30d: sales30d.get(r.id) ?? 0,
      revenue30d: revenue30d.get(r.id) ?? 0,
    }));
  }

  private async requirePosting(userId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(masterPostings)
      .where(and(eq(masterPostings.id, id), eq(masterPostings.userId, userId)))
      .limit(1);
    if (!row) throw new NotFoundException("Master postingan tidak ditemukan");
    return row;
  }

  async get(userId: string, id: string) {
    const posting = await this.requirePosting(userId, id);
    const skus = await this.db
      .select()
      .from(masterPostingSkus)
      .where(and(eq(masterPostingSkus.userId, userId), eq(masterPostingSkus.masterPostingId, id)))
      .orderBy(masterPostingSkus.comboKey);
    // Nama master produk untuk tiap SKU termapping.
    const masterIds = [...new Set(skus.map((s) => s.masterProductId).filter(Boolean) as string[])];
    const masters = masterIds.length
      ? await this.db
          .select({ id: masterProducts.id, sku: masterProducts.sku, name: masterProducts.name })
          .from(masterProducts)
          .where(and(eq(masterProducts.userId, userId), inArray(masterProducts.id, masterIds)))
      : [];
    const masterById = new Map(masters.map((m) => [m.id, m] as const));
    const mappings = await this.db
      .select()
      .from(masterPostingMappings)
      .where(and(eq(masterPostingMappings.userId, userId), eq(masterPostingMappings.masterPostingId, id)))
      .orderBy(desc(masterPostingMappings.createdAt));
    const shopIds = [...new Set(mappings.map((m) => m.shopId))];
    const shopRows = shopIds.length
      ? await this.db.select({ id: shops.id, shopName: shops.shopName }).from(shops).where(inArray(shops.id, shopIds))
      : [];
    const shopById = new Map(shopRows.map((s) => [s.id, s.shopName] as const));
    // Harga publish terkini di marketplace per SKU (dari listing yang dipetakan,
    // dicocokkan via seller_sku; ambil yang paling baru disinkron).
    const mappedShopIds = [...new Set(mappings.filter((m) => m.status !== "create").map((m) => m.shopId))];
    const sellerSkus = [...new Set(skus.map((s) => s.sku).filter((x): x is string => !!x))];
    const mpPriceBySku = new Map<string, string>();
    if (mappedShopIds.length && sellerSkus.length) {
      const mpRows = await this.db
        .select({
          sellerSku: marketplaceSkus.sellerSku,
          price: marketplaceSkus.price,
        })
        .from(marketplaceSkus)
        .where(
          and(
            eq(marketplaceSkus.userId, userId),
            inArray(marketplaceSkus.shopId, mappedShopIds),
            inArray(marketplaceSkus.sellerSku, sellerSkus),
          ),
        )
        .orderBy(desc(marketplaceSkus.syncedAt));
      for (const r of mpRows) {
        if (r.sellerSku && r.price != null && !mpPriceBySku.has(r.sellerSku)) {
          mpPriceBySku.set(r.sellerSku, String(r.price));
        }
      }
    }
    return {
      ...posting,
      skus: skus.map((s) => ({
        ...s,
        master: s.masterProductId ? masterById.get(s.masterProductId) ?? null : null,
        marketplacePrice: s.sku ? mpPriceBySku.get(s.sku) ?? null : null,
      })),
      mappings: mappings.map((m) => ({ ...m, shopName: shopById.get(m.shopId) ?? null })),
    };
  }

  async update(userId: string, id: string, dto: UpdateMasterPostingDto) {
    const posting = await this.requirePosting(userId, id);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.categoryId !== undefined) patch.categoryId = dto.categoryId;
    if (dto.brand !== undefined) patch.brand = dto.brand;
    if (dto.images !== undefined) patch.images = dto.images;
    if (dto.attributes !== undefined) patch.attributes = dto.attributes;
    if (dto.autoApply !== undefined) patch.autoApply = dto.autoApply;
    if (dto.status !== undefined) patch.status = dto.status;
    let groups: VariantGroup[] | null = null;
    if (dto.variantGroups !== undefined) {
      groups = this.sanitizeGroups(dto.variantGroups);
      patch.variantGroups = groups;
    }
    await this.db.update(masterPostings).set(patch).where(eq(masterPostings.id, id));
    if (groups) await this.regenerateSkus(userId, id, groups);

    const detail = await this.get(userId, id);
    // Auto-terapkan bila dinyalakan (klik simpan = aksi eksplisit penjual).
    let applied: unknown = null;
    if (posting.autoApply || dto.autoApply) {
      applied = await this.apply(userId, id).catch((e) => ({ error: (e as Error).message }));
    }
    return { ...detail, applied };
  }

  async remove(userId: string, id: string) {
    await this.requirePosting(userId, id);
    await this.db.delete(masterPostings).where(eq(masterPostings.id, id));
    return { id, deleted: true };
  }

  // ---------------------------------------------------------------- SKU mapping

  async setSku(userId: string, postingId: string, skuRowId: string, dto: SetSkuDto) {
    await this.requirePosting(userId, postingId);
    const [row] = await this.db
      .select({ id: masterPostingSkus.id })
      .from(masterPostingSkus)
      .where(
        and(
          eq(masterPostingSkus.id, skuRowId),
          eq(masterPostingSkus.userId, userId),
          eq(masterPostingSkus.masterPostingId, postingId),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException("SKU tidak ditemukan");
    if (dto.masterProductId) {
      const [m] = await this.db
        .select({ id: masterProducts.id })
        .from(masterProducts)
        .where(and(eq(masterProducts.id, dto.masterProductId), eq(masterProducts.userId, userId)))
        .limit(1);
      if (!m) throw new BadRequestException("Master produk tidak ditemukan");
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.sku !== undefined) patch.sku = dto.sku.trim() || null;
    if (dto.masterProductId !== undefined) patch.masterProductId = dto.masterProductId || null;
    if (dto.price !== undefined) patch.price = dto.price || null;
    if (dto.stock !== undefined) patch.stock = dto.stock;
    if (dto.imageUrl !== undefined) patch.imageUrl = dto.imageUrl || null;
    await this.db.update(masterPostingSkus).set(patch).where(eq(masterPostingSkus.id, skuRowId));
    return this.get(userId, postingId);
  }

  /** "Rp 12.345" / number / null -> number rupiah | null (abaikan pemisah ribuan). */
  private parseRupiah(v: unknown): number | null {
    if (v == null) return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const digits = String(v).replace(/[^0-9]/g, "");
    return digits ? Number(digits) : null;
  }

  /**
   * Daftar ringkas master produk AutoToko untuk dropdown pemetaan SKU.
   * Dilengkapi harga publish + HPP (dari modul costing) agar baris SKU bisa
   * auto-isi harga & menampilkan HPP tanpa panggilan tambahan.
   */
  async masterProductOptions(userId: string) {
    const opts = await this.db
      .select({ id: masterProducts.id, sku: masterProducts.sku, name: masterProducts.name })
      .from(masterProducts)
      .where(eq(masterProducts.userId, userId))
      .orderBy(masterProducts.name);
    let costByProduct = new Map<string, { publishPrice: number | null; hpp: number | null }>();
    try {
      const rows = await this.costing.list(userId);
      costByProduct = new Map(
        rows.map((r: { productId: string; publishPrice: number | null; hpp: unknown }) => [
          String(r.productId),
          { publishPrice: r.publishPrice ?? null, hpp: this.parseRupiah(r.hpp) },
        ]),
      );
    } catch {
      /* costing opsional: kalau gagal, biarkan harga/hpp null */
    }
    return opts.map((o) => {
      const c = costByProduct.get(o.id);
      return { ...o, publishPrice: c?.publishPrice ?? null, hpp: c?.hpp ?? null };
    });
  }

  /**
   * Set harga publish master produk (dua-arah dari baris SKU master postingan).
   * Upsert ke product_costing; tidak menyentuh kolom lain.
   */
  async setMasterPublishPrice(userId: string, masterProductId: string, price: number) {
    const [mp] = await this.db
      .select({ id: masterProducts.id })
      .from(masterProducts)
      .where(and(eq(masterProducts.id, masterProductId), eq(masterProducts.userId, userId)))
      .limit(1);
    if (!mp) throw new NotFoundException("Master produk tidak ditemukan");
    const val = String(Math.max(0, Math.round(Number(price) || 0)));
    await this.db
      .insert(productCosting)
      .values({ userId, masterProductId, publishPrice: val })
      .onConflictDoUpdate({
        target: productCosting.masterProductId,
        set: { publishPrice: val, updatedAt: new Date() },
      });
    return { ok: true, masterProductId, publishPrice: Number(val) };
  }

  /** Penjualan 30 hari per listing termapping (rata-rata per minggu). */
  async salesForPosting(userId: string, postingId: string) {
    await this.requirePosting(userId, postingId);
    const maps = await this.db
      .select({
        shopId: masterPostingMappings.shopId,
        productId: masterPostingMappings.productId,
        status: masterPostingMappings.status,
      })
      .from(masterPostingMappings)
      .where(and(eq(masterPostingMappings.userId, userId), eq(masterPostingMappings.masterPostingId, postingId)));
    const pairs = maps.filter((m) => m.status !== "create" && m.productId);
    const byPair = await this.aggSalesByPair(
      userId,
      [...new Set(pairs.map((m) => m.shopId))],
      [...new Set(pairs.map((m) => m.productId as string))],
    );
    const shopIds = [...new Set(pairs.map((m) => m.shopId))];
    const shopRows = shopIds.length
      ? await this.db.select({ id: shops.id, shopName: shops.shopName }).from(shops).where(inArray(shops.id, shopIds))
      : [];
    const nameById = new Map(shopRows.map((x) => [x.id, x.shopName] as const));
    let totalUnits = 0;
    let totalRevenue = 0;
    const rows = pairs.map((m) => {
      const v = byPair.get(`${m.shopId}:${m.productId}`) ?? { units: 0, revenue: 0, orders: 0 };
      totalUnits += v.units;
      totalRevenue += v.revenue;
      return {
        shopId: m.shopId,
        shopName: nameById.get(m.shopId) ?? null,
        productId: m.productId,
        units30d: v.units,
        revenue30d: v.revenue,
        orders30d: v.orders,
        avgUnitsPerWeek: Math.round((v.units * 7) / 30),
      };
    });
    return { windowDays: 30, totalUnits, totalRevenue, avgUnitsPerWeek: Math.round((totalUnits * 7) / 30), rows };
  }

  /** Promosi marketplace yang terkait sebuah listing termapping (read-only). */
  async productPromotions(userId: string, shopId: string, productId: string) {
    const [shop] = await this.db
      .select({ id: shops.id })
      .from(shops)
      .where(and(eq(shops.id, shopId), eq(shops.userId, userId)))
      .limit(1);
    if (!shop) throw new NotFoundException("Toko tidak ditemukan");
    return this.sync.promotionsForProduct(userId, shopId, productId);
  }

  // ---------------------------------------------------------------- impor dari listing

  /**
   * Impor sebuah listing marketplace menjadi master posting (template induk),
   * agar seller tak perlu mengisi semua field manual di awal.
   *
   * Membaca DETAIL produk (read-only ke TikTok; fallback ke baris tersimpan),
   * lalu prefill: nama, deskripsi, gambar, grup varian, dan SKU (kode seller_sku,
   * harga, stok). SKU yang seller_sku-nya cocok dengan master produk AutoToko
   * langsung dipetakan. Listing sumbernya sekalian dipetakan (siap di-Terapkan).
   * TIDAK menulis apa pun ke marketplace.
   */
  async importFromListing(userId: string, shopId: string, productId: string) {
    const [shop] = await this.db
      .select()
      .from(shops)
      .where(and(eq(shops.id, shopId), eq(shops.userId, userId)))
      .limit(1);
    if (!shop) throw new BadRequestException("Toko tidak ditemukan untuk pengguna ini");
    const marketplace = shop.marketplace ?? "tiktok";

    // Ambil detail produk (READ). TikTok: coba API detail; kalau gagal, pakai raw tersimpan.
    let raw: Record<string, unknown> | null = null;
    if (marketplace === "tiktok" && shop.accessToken && shop.shopCipher) {
      const { appKey, appSecret } = await this.tiktok.credentials();
      const buat = (sh: typeof shops.$inferSelect) =>
        new TikTokClient(appKey, appSecret, this.crypto.decrypt(sh.accessToken!), sh.shopCipher);
      let klien = buat(shop);
      let segar = false;
      for (;;) {
        try {
          raw = await klien.get(`/product/202309/products/${productId}`);
          break;
        } catch (e) {
          if (e instanceof TikTokApiError && e.tokenBermasalah && !segar) {
            segar = true;
            await this.shops.refreshOne(userId, shop.id);
            const [fresh] = await this.db.select().from(shops).where(eq(shops.id, shop.id)).limit(1);
            if (fresh) klien = buat(fresh);
            continue;
          }
          this.logger.warn(`Impor detail ${productId}: ${(e as Error).message}`);
          break;
        }
      }
    }
    if (!raw) {
      const [mp] = await this.db
        .select({ raw: marketplaceProducts.raw, title: marketplaceProducts.title })
        .from(marketplaceProducts)
        .where(and(eq(marketplaceProducts.userId, userId), eq(marketplaceProducts.productId, productId)))
        .limit(1);
      raw = (mp?.raw as Record<string, unknown>) ?? (mp ? { id: productId, title: mp.title } : null);
    }
    if (!raw) throw new NotFoundException("Produk marketplace tidak ditemukan / belum tersinkron");

    const parsed = this.parseListing(raw);

    // Fallback SKU: kalau raw tak memuat skus (mis. hasil search ringkas), pakai marketplace_skus tersimpan.
    if (!parsed.skus.length) {
      const rows = await this.db
        .select()
        .from(marketplaceSkus)
        .where(and(eq(marketplaceSkus.userId, userId), eq(marketplaceSkus.productId, productId)));
      if (rows.length > 1) {
        const seen = new Set<string>();
        const values: string[] = [];
        for (const r of rows) {
          const label = (r.skuName || r.sellerSku || r.skuId).toString();
          if (!seen.has(label)) { seen.add(label); values.push(label); }
        }
        parsed.groups = [{ name: "Varian", values }];
        parsed.skus = rows.map((r) => ({
          combo: { Varian: (r.skuName || r.sellerSku || r.skuId).toString() },
          sellerSku: r.sellerSku ?? null,
          price: r.price ?? null,
          stock: r.stock ?? null,
        }));
      } else if (rows.length === 1) {
        parsed.skus = [{ combo: {}, sellerSku: rows[0]!.sellerSku ?? null, price: rows[0]!.price ?? null, stock: rows[0]!.stock ?? null }];
      }
    }

    const [row] = await this.db
      .insert(masterPostings)
      .values({
        userId,
        name: (parsed.name || "Impor dari marketplace").slice(0, 255),
        description: parsed.description,
        categoryId: parsed.categoryId,
        brand: parsed.brand,
        images: parsed.images,
        variantGroups: parsed.groups,
        attributes: parsed.attributes,
        autoApply: false,
        status: "draft",
      })
      .returning();
    const postingId = row!.id;

    // Auto-peta seller_sku -> master produk AutoToko (bila kode cocok).
    const sellerSkus = [...new Set(parsed.skus.map((x) => x.sellerSku).filter((x): x is string => !!x))];
    const mastersBySku = new Map<string, string>();
    if (sellerSkus.length) {
      const ms = await this.db
        .select({ id: masterProducts.id, sku: masterProducts.sku })
        .from(masterProducts)
        .where(and(eq(masterProducts.userId, userId), inArray(masterProducts.sku, sellerSkus)));
      for (const m of ms) mastersBySku.set(m.sku, m.id);
    }

    // Insert SKU dari sumber (dedup by comboKey untuk jaga unique index).
    const seen = new Set<string>();
    const skuRows = parsed.skus
      .map((x) => {
        const comboKey = parsed.groups.map((g) => x.combo[g.name] ?? "").join("|");
        return {
          userId,
          masterPostingId: postingId,
          combo: x.combo,
          comboKey,
          sku: x.sellerSku ?? null,
          masterProductId: (x.sellerSku && mastersBySku.get(x.sellerSku)) || null,
          price: x.price ?? null,
          stock: x.stock ?? null,
        };
      })
      .filter((r) => (seen.has(r.comboKey) ? false : (seen.add(r.comboKey), true)));
    if (skuRows.length) await this.db.insert(masterPostingSkus).values(skuRows);
    else await this.db.insert(masterPostingSkus).values([{ userId, masterPostingId: postingId, combo: {}, comboKey: "" }]);

    // Peta listing sumber (siap di-Terapkan).
    await this.db
      .insert(masterPostingMappings)
      .values({ userId, masterPostingId: postingId, shopId, marketplace, productId, status: "update" })
      .onConflictDoNothing();

    return this.get(userId, postingId);
  }

  /** Bedah payload produk TikTok menjadi field master posting + varian + SKU. */
  private parseListing(p: Record<string, any>): {
    name: string | null;
    description: string | null;
    categoryId: number | null;
    brand: string | null;
    images: string[];
    groups: VariantGroup[];
    attributes: Record<string, unknown>;
    skus: { combo: Record<string, string>; sellerSku: string | null; price: string | null; stock: number | null }[];
  } {
    const name = typeof p.title === "string" ? p.title : null;
    const description = typeof p.description === "string" ? p.description : null;
    const images: string[] = [];
    for (const im of Array.isArray(p.main_images) ? p.main_images : []) {
      const u = Array.isArray(im?.urls) && im.urls.length ? im.urls[0] : typeof im?.url === "string" ? im.url : null;
      if (typeof u === "string" && u) images.push(u);
    }
    let categoryId: number | null = null;
    if (typeof p.category_id === "string" || typeof p.category_id === "number") categoryId = Number(p.category_id) || null;
    else if (Array.isArray(p.category_chains) && p.category_chains.length) {
      const leaf = p.category_chains[p.category_chains.length - 1];
      categoryId = Number(leaf?.id) || null;
    }
    const brand = typeof p.brand?.name === "string" ? p.brand.name : null;

    const order: string[] = [];
    const vals = new Map<string, string[]>();
    const skus: { combo: Record<string, string>; sellerSku: string | null; price: string | null; stock: number | null }[] = [];
    for (const s of Array.isArray(p.skus) ? p.skus : []) {
      const combo: Record<string, string> = {};
      for (const a of Array.isArray(s.sales_attributes) ? s.sales_attributes : []) {
        const an = typeof a?.name === "string" ? a.name : null;
        const av = typeof a?.value_name === "string" ? a.value_name : null;
        if (!an || !av) continue;
        combo[an] = av;
        if (!vals.has(an)) { vals.set(an, []); order.push(an); }
        const arr = vals.get(an)!;
        if (!arr.includes(av)) arr.push(av);
      }
      const price = s.price?.sale_price ?? s.price?.tax_exclusive_price ?? null;
      const stock = Array.isArray(s.inventory)
        ? s.inventory.reduce((acc: number, i: any) => acc + (Number(i?.quantity) || 0), 0)
        : null;
      skus.push({ combo, sellerSku: s.seller_sku || null, price: price == null ? null : String(price), stock });
    }
    const groups: VariantGroup[] = order.map((n) => ({ name: n, values: vals.get(n)! }));
    const attributes: Record<string, unknown> = {};
    if (p.package_weight) attributes.package_weight = p.package_weight;
    if (p.package_dimensions) attributes.package_dimensions = p.package_dimensions;
    if (p.category_chains) attributes.category_chains = p.category_chains;
    // Atribut produk kategori (mis. 101066 Nomor Ijin Edar / BPOM). Disimpan
    // apa adanya supaya bisa diedit di form & dikirim ulang saat apply.
    if (Array.isArray(p.product_attributes) && p.product_attributes.length) {
      attributes.productAttributes = p.product_attributes
        .filter((a: any) => a?.id)
        .map((a: any) => ({
          id: String(a.id),
          name: String(a.name ?? ""),
          values: (Array.isArray(a.values) ? a.values : [])
            .map((v: any) => ({ ...(v?.id ? { id: String(v.id) } : {}), name: String(v?.name ?? "") })),
        }));
    }
    return { name, description, categoryId, brand, images, groups, attributes, skus };
  }


  // ---------------------------------------------------------------- listing mapping

  /** Produk marketplace di sebuah toko, untuk memilih listing yang dikendalikan. */
  async shopProducts(userId: string, shopId: string) {
    const [shop] = await this.db
      .select({ id: shops.id })
      .from(shops)
      .where(and(eq(shops.id, shopId), eq(shops.userId, userId)))
      .limit(1);
    if (!shop) throw new NotFoundException("Toko tidak ditemukan");
    // Listing yang sudah dipetakan (mode update) ke master mana pun tak boleh
    // muncul lagi: tiap listing marketplace menempel pada satu master AutoToko.
    const mapped = await this.db
      .select({ productId: masterPostingMappings.productId })
      .from(masterPostingMappings)
      .where(and(eq(masterPostingMappings.userId, userId), eq(masterPostingMappings.shopId, shopId)));
    const taken = [...new Set(mapped.map((m) => m.productId).filter((x): x is string => !!x))];
    const conds = [
      eq(marketplaceProducts.userId, userId),
      eq(marketplaceProducts.shopId, shopId),
      // Hanya listing yang masih aktif di marketplace.
      eq(marketplaceProducts.status, "ACTIVATE"),
    ];
    if (taken.length) conds.push(notInArray(marketplaceProducts.productId, taken));
    return this.db
      .select({
        productId: marketplaceProducts.productId,
        title: marketplaceProducts.title,
        status: marketplaceProducts.status,
        marketplace: marketplaceProducts.marketplace,
      })
      .from(marketplaceProducts)
      .where(and(...conds))
      .orderBy(marketplaceProducts.title)
      .limit(500);
  }

  async addMapping(userId: string, postingId: string, dto: AddMappingDto) {
    await this.requirePosting(userId, postingId);
    const [shop] = await this.db
      .select({ id: shops.id })
      .from(shops)
      .where(and(eq(shops.id, dto.shopId), eq(shops.userId, userId)))
      .limit(1);
    if (!shop) throw new BadRequestException("Toko tidak ditemukan untuk pengguna ini");
    const marketplace = dto.marketplace ?? "tiktok";
    // mode disimpan di kolom status: "create" = posting baru, selain itu = update.
    const mode = dto.mode === "create" ? "create" : "update";
    const productId = mode === "create" ? "" : (dto.productId ?? "").trim();
    if (mode === "update" && !productId) throw new BadRequestException("Pilih listing yang akan diperbarui");
    const [row] = await this.db
      .insert(masterPostingMappings)
      .values({
        userId,
        masterPostingId: postingId,
        shopId: dto.shopId,
        marketplace,
        productId,
        status: mode,
      })
      .onConflictDoUpdate({
        target: [
          masterPostingMappings.masterPostingId,
          masterPostingMappings.shopId,
          masterPostingMappings.productId,
        ],
        set: { status: mode, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  /** Atribut produk tersimpan di master posting -> bentuk body TikTok. */
  private postingProductAttributes(posting: Record<string, any>): Array<{ id: string; values: Array<{ id?: string; name: string }> }> {
    const raw = (posting?.attributes as Record<string, any> | null)?.productAttributes;
    if (!Array.isArray(raw)) return [];
    const out: Array<{ id: string; values: Array<{ id?: string; name: string }> }> = [];
    for (const a of raw) {
      if (!a?.id) continue;
      const values = (Array.isArray(a.values) ? a.values : [])
        .map((v: any) => ({ ...(v?.id ? { id: String(v.id) } : {}), name: String(v?.name ?? "") }))
        .filter((v: { name: string }) => v.name !== "");
      if (values.length) out.push({ id: String(a.id), values });
    }
    return out;
  }

  /** Gabung atribut listing LIVE + override master posting (override menang). */
  private static gabungAtribut(
    live: Array<Record<string, any>>,
    override: Array<{ id: string; values: Array<{ id?: string; name: string }> }>,
  ): Array<{ id: string; values: Array<{ id?: string; name: string }> }> {
    const map = new Map<string, { id: string; values: Array<{ id?: string; name: string }> }>();
    for (const a of live) {
      if (!a?.id) continue;
      const values = (Array.isArray(a.values) ? a.values : [])
        .map((v: any) => ({ ...(v?.id ? { id: String(v.id) } : {}), name: String(v?.name ?? "") }))
        .filter((v: { name: string }) => v.name !== "");
      if (values.length) map.set(String(a.id), { id: String(a.id), values });
    }
    for (const a of override) map.set(String(a.id), a);
    return [...map.values()];
  }

  /**
   * Definisi atribut kategori marketplace (TikTok GetAttributes) untuk form
   * create/edit: id, nama, wajib?, boleh custom?, multi?, pilihan nilai. Hanya
   * PRODUCT_PROPERTY (SALES_PROPERTY = varian, ditangani grup varian).
   */
  async categoryAttributes(userId: string, categoryId?: string, shopId?: string, postingId?: string) {
    // Jika diberi postingId: ambil kategori dari posting (bila kosong) & siapkan
    // NILAI SAAT INI untuk prefill form — dari atribut tersimpan posting, lalu
    // dilengkapi dari listing yg dipetakan (POOL lintas-toko). User tinggal edit.
    let posting: Record<string, any> | null = null;
    let mappings: Array<Record<string, any>> = [];
    if (postingId) {
      posting = (await this.requirePosting(userId, postingId)) as Record<string, any>;
      if (!categoryId && posting.categoryId != null) categoryId = String(posting.categoryId);
      mappings = await this.db.select().from(masterPostingMappings)
        .where(and(eq(masterPostingMappings.userId, userId), eq(masterPostingMappings.masterPostingId, postingId)));
    }
    if (!categoryId) throw new BadRequestException("Kategori belum terdeteksi untuk posting ini");

    // Pilih toko utk baca definisi atribut: shopId > toko mapping pertama > toko mana pun.
    const kond = [eq(shops.userId, userId), eq(shops.marketplace, "tiktok")];
    if (shopId) kond.push(eq(shops.id, shopId));
    else if (mappings[0]?.shopId) kond.push(eq(shops.id, mappings[0].shopId));
    let shopRows = await this.db.select().from(shops).where(and(...kond));
    if (!shopRows.find((x) => x.accessToken && x.shopCipher)) {
      shopRows = await this.db.select().from(shops).where(and(eq(shops.userId, userId), eq(shops.marketplace, "tiktok")));
    }
    let shop = shopRows.find((x) => x.accessToken && x.shopCipher);
    if (!shop) throw new BadRequestException("Tidak ada toko TikTok tersambung untuk membaca atribut kategori");
    const { appKey, appSecret } = await this.tiktok.credentials();
    const clientOf = (sh: typeof shops.$inferSelect) => new TikTokClient(appKey, appSecret, this.crypto.decrypt(sh.accessToken!), sh.shopCipher);

    let client = clientOf(shop);
    let segar = false;
    const resp = await (async () => {
      for (;;) {
        try {
          return (await client.get(`/product/202309/categories/${categoryId}/attributes`, { locale: "id-ID" })) as Record<string, any>;
        } catch (e) {
          if (e instanceof TikTokApiError && e.tokenBermasalah && !segar) {
            segar = true;
            await this.shops.refreshOne(userId, shop!.id);
            const [fr] = await this.db.select().from(shops).where(eq(shops.id, shop!.id)).limit(1);
            if (fr) { shop = fr; client = clientOf(fr); }
            continue;
          }
          throw e;
        }
      }
    })();
    const defs = (Array.isArray(resp?.attributes) ? resp.attributes : [])
      .filter((a: any) => a?.type !== "SALES_PROPERTY")
      .map((a: any) => ({
        id: String(a.id),
        name: String(a.name ?? ""),
        required: !!a.is_requried,
        customizable: !!a.is_customizable,
        multiple: !!a.is_multiple_selection,
        values: (Array.isArray(a.values) ? a.values : []).map((v: any) => ({ id: String(v.id), name: String(v.name ?? "") })),
      }));

    // Nilai saat ini (prefill): tersimpan di posting dulu, lalu dari listing live.
    const currentMap = new Map<string, Array<{ id?: string; name: string }>>();
    const serap = (arr: any) => {
      for (const a of Array.isArray(arr) ? arr : []) {
        if (!a?.id) continue;
        const vals = (Array.isArray(a.values) ? a.values : [])
          .map((v: any) => ({ ...(v?.id ? { id: String(v.id) } : {}), name: String(v?.name ?? "") }))
          .filter((v: { name: string }) => v.name !== "");
        if (vals.length && !currentMap.has(String(a.id))) currentMap.set(String(a.id), vals);
      }
    };
    if (posting) serap((posting.attributes as Record<string, any> | null)?.productAttributes);
    const defIds = defs.map((d) => d.id);
    if (posting && !defIds.every((id) => currentMap.has(id))) {
      const shopById = new Map(shopRows.map((x) => [x.id, x] as const));
      let dibaca = 0;
      for (const m of mappings) {
        if (m.marketplace !== "tiktok" || m.status === "create" || !m.productId) continue;
        if (defIds.every((id) => currentMap.has(id)) || dibaca >= 8) break;
        let sh = shopById.get(m.shopId);
        if (!sh?.accessToken || !sh.shopCipher) {
          const [one] = await this.db.select().from(shops).where(and(eq(shops.id, m.shopId), eq(shops.userId, userId))).limit(1);
          if (one?.accessToken && one.shopCipher) { sh = one; shopById.set(m.shopId, one); }
        }
        if (!sh?.accessToken || !sh.shopCipher) continue;
        dibaca++;
        try {
          const cur = (await clientOf(sh).get(`/product/202309/products/${m.productId}`)) as Record<string, any>;
          serap(cur?.product_attributes);
        } catch { /* lewati listing yg gagal/terhapus */ }
      }
    }
    const attrs = defs.map((d) => {
      const cur = currentMap.get(d.id) ?? [];
      return { ...d, current: cur, currentText: cur.map((v) => v.name).join(", ") };
    });
    return { categoryId: String(categoryId), attributes: attrs };
  }

  async removeMapping(userId: string, postingId: string, mappingId: string) {
    await this.requirePosting(userId, postingId);
    await this.db
      .delete(masterPostingMappings)
      .where(
        and(
          eq(masterPostingMappings.id, mappingId),
          eq(masterPostingMappings.userId, userId),
          eq(masterPostingMappings.masterPostingId, postingId),
        ),
      );
    return { id: mappingId, deleted: true };
  }


  /**
   * HAPUS DI MARKETPLACE SAJA. Menghapus listing produk di TikTok untuk tiap
   * mapping posting ini (DELETE /product/202309/products, maks 20/panggilan per
   * toko), lalu membuang baris mapping yang listing-nya sudah mati — TAPI
   * master posting + SKU-nya di AutoToko TETAP ADA. Aksi OUTWARD destruktif →
   * dipicu klik eksplisit penjual. Kebalikan dari remove() (hapus di AutoToko
   * saja, listing marketplace dibiarkan hidup).
   */
  async deleteMarketplace(userId: string, postingId: string) {
    await this.requirePosting(userId, postingId);
    const mappings = await this.db
      .select()
      .from(masterPostingMappings)
      .where(and(eq(masterPostingMappings.userId, userId), eq(masterPostingMappings.masterPostingId, postingId)));
    const aktif = mappings.filter((m) => m.marketplace === "tiktok" && m.productId && m.status !== "create");
    if (!aktif.length) {
      return { postingId, total: 0, ok: 0, gagal: 0, dilewati: mappings.length, hasil: [] as Record<string, unknown>[],
        catatan: "Tidak ada listing TikTok termapping untuk dihapus." };
    }
    const shopIds = [...new Set(aktif.map((m) => m.shopId))];
    const shopRows = await this.db.select().from(shops).where(inArray(shops.id, shopIds));
    const shopById = new Map(shopRows.map((s) => [s.id, s] as const));
    const { appKey, appSecret } = await this.tiktok.credentials();
    const clientOf = (shop: typeof shops.$inferSelect) =>
      new TikTokClient(appKey, appSecret, this.crypto.decrypt(shop.accessToken!), shop.shopCipher);

    const perShop = new Map<string, typeof aktif>();
    for (const m of aktif) {
      const arr = perShop.get(m.shopId) ?? [];
      arr.push(m);
      perShop.set(m.shopId, arr);
    }
    const hasil: Record<string, unknown>[] = [];
    let ok = 0, gagal = 0, dilewati = 0;
    for (const [sid, ms] of perShop) {
      let shop = shopById.get(sid);
      if (!shop || !shop.accessToken || !shop.shopCipher) {
        for (const m of ms) { hasil.push({ mappingId: m.id, productId: m.productId, shop: shop?.shopName ?? null, status: "skipped", reason: "toko tidak tersambung API" }); dilewati++; }
        continue;
      }
      for (let i = 0; i < ms.length; i += 20) {
        const chunk = ms.slice(i, i + 20);
        const ids = chunk.map((m) => m.productId);
        try {
          let segar = false;
          for (;;) {
            try { await clientOf(shop).del("/product/202309/products", { product_ids: ids }); break; }
            catch (e) {
              if (e instanceof TikTokApiError && e.tokenBermasalah && !segar) {
                segar = true;
                await this.shops.refreshOne(userId, shop.id);
                const [fresh] = await this.db.select().from(shops).where(eq(shops.id, shop!.id)).limit(1);
                if (fresh) { shop = fresh; shopById.set(sid, fresh); }
                continue;
              }
              throw e;
            }
          }
          for (const m of chunk) {
            // Listing sudah mati di TikTok → buang mapping (link) saja. Posting + SKU tetap.
            await this.db.delete(masterPostingMappings).where(eq(masterPostingMappings.id, m.id));
            hasil.push({ mappingId: m.id, productId: m.productId, shop: shop.shopName ?? null, status: "ok" });
            ok++;
          }
        } catch (e) {
          for (const m of chunk) { hasil.push({ mappingId: m.id, productId: m.productId, shop: shop?.shopName ?? null, status: "failed", error: (e as Error).message }); gagal++; }
        }
      }
    }
    return { postingId, total: aktif.length, ok, gagal, dilewati, hasil };
  }

  // ---------------------------------------------------------------- TERAPKAN (push)

  /**
   * Terapkan master posting ke semua listing marketplace termapping.
   *
   * TULISAN KELUAR yang nyata. Memakai partial_edit (aman: hanya menyentuh field
   * yang dikirim, tak menghapus kategori/atribut). v1: nama (title) + deskripsi.
   * Gambar & atribut disiapkan tetapi butuh endpoint unggah gambar TikTok yang
   * belum terpasang → dilaporkan "belum didukung" per-mapping, tidak gagal diam.
   */
  async apply(userId: string, postingId: string, mappingId?: string) {
    const posting = await this.requirePosting(userId, postingId);
    const kond = [eq(masterPostingMappings.userId, userId), eq(masterPostingMappings.masterPostingId, postingId)];
    if (mappingId) kond.push(eq(masterPostingMappings.id, mappingId));
    const mappings = await this.db.select().from(masterPostingMappings).where(and(...kond));
    if (!mappings.length) {
      return {
        postingId,
        total: 0,
        ok: 0,
        gagal: 0,
        dilewati: 0,
        hasil: [],
        catatan: mappingId ? "Mapping tidak ditemukan." : "Belum ada listing termapping.",
      };
    }
    const title = (posting.name ?? "").trim().slice(0, 255);
    const description = posting.description ?? null;
    const gambarBelumDidukung = (posting.images?.length ?? 0) > 0;

    const shopIds = [...new Set(mappings.map((m) => m.shopId))];
    const shopRows = await this.db.select().from(shops).where(inArray(shops.id, shopIds));
    const shopById = new Map(shopRows.map((s) => [s.id, s] as const));
    const { appKey, appSecret } = await this.tiktok.credentials();
    const clientOf = (shop: typeof shops.$inferSelect) =>
      new TikTokClient(appKey, appSecret, this.crypto.decrypt(shop.accessToken!), shop.shopCipher);

    type Baris = {
      mappingId: string;
      productId: string;
      shop: string | null;
      status: "ok" | "skipped" | "failed";
      applied?: string[];
      pending?: string[];
      reason?: string;
      error?: string;
      url?: string | null;
      sellerUrl?: string | null;
      verifiedTitle?: string | null;
      verifiedDescription?: string | null;
    };
    const hasil: Baris[] = [];

    // Pra-pass: baca atribut listing LIVE tiap mapping + bangun POOL lintas-toko.
    // Atribut yg hanya terisi di SEBAGIAN toko (mis. Nomor Ijin Edar/BPOM 101066)
    // dipakai mengisi toko lain yg kekurangan, supaya "Jalankan semua baris"
    // tak gagal hanya karena satu toko belum punya atribut wajib itu.
    const liveByMapping = new Map<string, Array<Record<string, any>>>();
    const poolAttrs = new Map<string, { id: string; values: Array<{ id?: string; name: string }> }>();
    const statusByMapping = new Map<string, string>();
    for (const m of mappings) {
      if (m.marketplace !== "tiktok" || m.status === "create" || !m.productId) continue;
      let shopP = shopById.get(m.shopId);
      if (!shopP?.accessToken || !shopP.shopCipher) continue;
      let segarP = false;
      let attrs: Array<Record<string, any>> = [];
      let statusTemp = "";
      for (;;) {
        try {
          const cur = (await clientOf(shopP).get(`/product/202309/products/${m.productId}`)) as Record<string, any>;
          attrs = Array.isArray(cur?.product_attributes) ? cur.product_attributes : [];
          statusTemp = String(cur?.status ?? "");
          break;
        } catch (e) {
          if (e instanceof TikTokApiError && e.tokenBermasalah && !segarP) {
            segarP = true;
            await this.shops.refreshOne(userId, shopP.id);
            const [fr] = await this.db.select().from(shops).where(eq(shops.id, shopP!.id)).limit(1);
            if (fr) { shopP = fr; shopById.set(m.shopId, fr); }
            continue;
          }
          attrs = [];
          break;
        }
      }
      liveByMapping.set(m.id, attrs);
      if (statusTemp) statusByMapping.set(m.id, statusTemp);
      for (const a of attrs) {
        if (!a?.id) continue;
        const values = (Array.isArray(a.values) ? a.values : [])
          .map((v: any) => ({ ...(v?.id ? { id: String(v.id) } : {}), name: String(v?.name ?? "") }))
          .filter((v: { name: string }) => v.name !== "");
        if (values.length && !poolAttrs.has(String(a.id))) poolAttrs.set(String(a.id), { id: String(a.id), values });
      }
    }

    for (const m of mappings) {
      let shop = shopById.get(m.shopId);
      const nama = shop?.shopName ?? null;
      const url = m.productId ? this.listingUrl(m.marketplace, m.productId) : null;
      // Mode "create" (posting baru): pembuatan listing baru butuh unggah gambar
      // TikTok yang belum terpasang → distage, tidak difire (hindari listing rusak).
      if (m.status === "create") {
        const alasan = "Posting baru — pembuatan listing baru belum didukung (butuh unggah gambar TikTok, tahap berikutnya)";
        hasil.push({ mappingId: m.id, productId: m.productId, shop: nama, status: "skipped", reason: alasan, url });
        await this.tandaiMapping(m.id, "skipped", alasan);
        continue;
      }
      if (!m.productId) {
        hasil.push({ mappingId: m.id, productId: m.productId, shop: nama, status: "skipped", reason: "listing belum dipilih", url });
        await this.tandaiMapping(m.id, "skipped", "listing belum dipilih");
        continue;
      }
      if (!shop || !shop.accessToken || !shop.shopCipher) {
        hasil.push({ mappingId: m.id, productId: m.productId, shop: nama, status: "skipped", reason: "toko tidak tersambung API", url });
        await this.tandaiMapping(m.id, "skipped", "toko tidak tersambung API");
        continue;
      }
      if (m.marketplace !== "tiktok") {
        hasil.push({ mappingId: m.id, productId: m.productId, shop: nama, status: "skipped", reason: `${m.marketplace} belum didukung`, url });
        await this.tandaiMapping(m.id, "skipped", `${m.marketplace} belum didukung`);
        continue;
      }
      const stListing = statusByMapping.get(m.id) || "";
      if (stListing && stListing !== "ACTIVATE") {
        const peta: Record<string, string> = {
          DELETED: "Listing sudah DIHAPUS di TikTok",
          FREEZE: "Listing DIBEKUKAN TikTok (freeze)",
          FROZEN: "Listing dibekukan TikTok",
          DEACTIVATED: "Listing nonaktif",
          SELLER_DEACTIVATED: "Listing dinonaktifkan seller",
          PLATFORM_DEACTIVATED: "Listing dinonaktifkan platform",
          DRAFT: "Listing masih draf",
        };
        const alasan = `${peta[stListing] ?? `Listing status ${stListing}`} — tak bisa diedit via API. Benahi di Seller Center lalu terapkan ulang.`;
        hasil.push({ mappingId: m.id, productId: m.productId, shop: nama, status: "skipped", reason: alasan, url });
        await this.tandaiMapping(m.id, "skipped", alasan);
        continue;
      }
      // Atribut WAJIB (mis. 101066 BPOM) harus IKUT. Prioritas nilai:
      // master posting > listing toko ini > POOL lintas-toko (isi yg kurang).
      const liveAttrs = liveByMapping.get(m.id) ?? [];
      const productAttributes = MasterPostingsService.gabungAtribut(liveAttrs, this.postingProductAttributes(posting));
      const sudahAda = new Set(productAttributes.map((a) => a.id));
      for (const [id, a] of poolAttrs) if (!sudahAda.has(id)) productAttributes.push(a);
      const body: Record<string, unknown> = { title };
      if (description !== null) body.description = description;
      if (productAttributes.length) body.product_attributes = productAttributes;
      const path = `/product/202309/products/${m.productId}/partial_edit`;
      try {
        let segar = false;
        for (;;) {
          try {
            await clientOf(shop).post(path, body);
            break;
          } catch (e) {
            if (e instanceof TikTokApiError && e.tokenBermasalah && !segar) {
              segar = true;
              await this.shops.refreshOne(userId, shop.id);
              const [fresh] = await this.db.select().from(shops).where(eq(shops.id, shop!.id)).limit(1);
              if (fresh) { shop = fresh; shopById.set(shop.id, fresh); }
              continue;
            }
            throw e;
          }
        }
        // BUKTI: baca ulang judul listing langsung dari TikTok setelah edit,
        // supaya seller melihat perubahan benar-benar mendarat (bukan sekadar
        // "sukses dikirim"). Best-effort — sukses partial_edit sudah dikonfirmasi.
        let verifiedTitle: string | null = null;
        let verifiedDescription: string | null = null;
        try {
          const fresh = await clientOf(shop).get(`/product/202309/products/${m.productId}`);
          const t = (fresh as { title?: unknown; description?: unknown })?.title;
          const de = (fresh as { description?: unknown })?.description;
          if (typeof t === "string") verifiedTitle = t;
          if (typeof de === "string")
            verifiedDescription = de.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
        } catch {
          /* abaikan; edit sudah sukses */
        }
        const sellerUrl = this.sellerCenterUrl(m.marketplace, shop?.sellerRegion ?? null);
        const applied = ["nama"];
        if (description !== null) applied.push("deskripsi");
        const pending = gambarBelumDidukung ? ["gambar (butuh unggah gambar TikTok)"] : [];
        hasil.push({ mappingId: m.id, productId: m.productId, shop: nama, status: "ok", applied, pending, url, sellerUrl, verifiedTitle, verifiedDescription });
        const jejak = `Diterapkan: ${applied.join(", ")}${verifiedTitle ? ` · judul kini: "${verifiedTitle.slice(0, 80)}"` : ""}`;
        await this.tandaiMapping(m.id, "ok", jejak);
      } catch (e) {
        let pesan = (e as Error).message;
        if (/12052901/.test(pesan)) pesan = "Listing tidak dalam status yang bisa diedit (mis. draf/nonaktif/sedang ditinjau TikTok). Aktifkan/benahi listing di Seller Center lalu terapkan ulang. (" + pesan.slice(0, 80) + "…)";
        else if (/12052104/.test(pesan)) pesan = "Atribut wajib kategori belum terisi & tak ada di toko lain untuk disalin. Isi di kartu \"Atribut Produk (Marketplace)\" lalu terapkan ulang. (" + pesan.slice(0, 90) + "…)";
        this.logger.warn(`Terapkan master posting ${postingId} → ${m.productId} (${nama}): ${(e as Error).message}`);
        hasil.push({ mappingId: m.id, productId: m.productId, shop: nama, status: "failed", error: pesan, url });
        await this.tandaiMapping(m.id, "failed", pesan);
      }
    }
    return {
      postingId,
      total: mappings.length,
      ok: hasil.filter((h) => h.status === "ok").length,
      gagal: hasil.filter((h) => h.status === "failed").length,
      dilewati: hasil.filter((h) => h.status === "skipped").length,
      catatanGambar: gambarBelumDidukung
        ? "Nama & deskripsi diterapkan. Propagasi daftar gambar menunggu endpoint unggah gambar TikTok (tahap berikutnya)."
        : undefined,
      hasil,
    };
  }

  private async tandaiMapping(mappingId: string, status: string, message: string): Promise<void> {
    await this.db
      .update(masterPostingMappings)
      .set({ lastAppliedAt: new Date(), lastStatus: status, lastMessage: message.slice(0, 500), updatedAt: new Date() })
      .where(eq(masterPostingMappings.id, mappingId));
  }

  /** Baca detail listing LIVE dari marketplace (untuk verifikasi/diagnosa). */
  async liveListing(userId: string, shopId: string, productId: string) {
    const [shop] = await this.db
      .select()
      .from(shops)
      .where(and(eq(shops.id, shopId), eq(shops.userId, userId)))
      .limit(1);
    if (!shop) throw new NotFoundException("Toko tidak ditemukan");
    if (!shop.accessToken || !shop.shopCipher) throw new BadRequestException("Toko tidak tersambung API");
    const { appKey, appSecret } = await this.tiktok.credentials();
    const buat = (sh: typeof shops.$inferSelect) =>
      new TikTokClient(appKey, appSecret, this.crypto.decrypt(sh.accessToken!), sh.shopCipher);
    let klien = buat(shop);
    let segar = false;
    let raw: Record<string, any> | null = null;
    for (;;) {
      try {
        raw = await klien.get(`/product/202309/products/${productId}`);
        break;
      } catch (e) {
        if (e instanceof TikTokApiError && e.tokenBermasalah && !segar) {
          segar = true;
          await this.shops.refreshOne(userId, shop.id);
          const [f] = await this.db.select().from(shops).where(eq(shops.id, shop.id)).limit(1);
          if (f) klien = buat(f);
          continue;
        }
        throw e;
      }
    }
    const p = raw || {};
    return {
      productId,
      keys: Object.keys(p),
      title: p.title ?? null,
      description: typeof p.description === "string" ? p.description.slice(0, 400) : null,
      status: p.status ?? null,
      audit: p.audit ?? null,
      auditStatus: p.audit_status ?? null,
      listingQuality: p.listing_quality_tier ?? null,
      updateTime: p.update_time ?? null,
      createTime: p.create_time ?? null,
      isDraft: p.is_draft ?? null,
      hasDraft: p.has_draft ?? null,
      productStatus: p.product_status ?? null,
      mainImages: Array.isArray(p.main_images) ? p.main_images.length : null,
    };
  }

  /** Link publik listing marketplace untuk seller cek perubahan (bukti). */
  private listingUrl(marketplace: string, productId: string): string | null {
    if (!productId) return null;
    if (marketplace === "tiktok") return `https://shop.tiktok.com/view/product/${productId}`;
    return null;
  }

  /** Link TikTok Seller Center (kondisi sebenarnya, tak kena cache etalase). */
  private sellerCenterUrl(marketplace: string, region: string | null): string | null {
    if (marketplace !== "tiktok") return null;
    const r = (region || "id").toLowerCase();
    return `https://seller-${r}.tiktok.com/product/manage`;
  }
}
