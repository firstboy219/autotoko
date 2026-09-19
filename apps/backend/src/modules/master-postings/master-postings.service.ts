import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  masterPostings,
  masterPostingSkus,
  masterPostingMappings,
  masterProducts,
  marketplaceProducts,
  marketplaceSkus,
  shops,
} from "../../database/schema/index.js";
import { CryptoService } from "../../common/crypto/crypto.service.js";
import { TikTokAdapter } from "../../marketplace/adapters/tiktok.adapter.js";
import { ShopsService } from "../shops/shops.service.js";
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

  async list(userId: string) {
    const rows = await this.db
      .select()
      .from(masterPostings)
      .where(eq(masterPostings.userId, userId))
      .orderBy(desc(masterPostings.updatedAt));
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const skus = await this.db
      .select({ postingId: masterPostingSkus.masterPostingId, mapped: masterPostingSkus.masterProductId })
      .from(masterPostingSkus)
      .where(inArray(masterPostingSkus.masterPostingId, ids));
    const maps = await this.db
      .select({ postingId: masterPostingMappings.masterPostingId })
      .from(masterPostingMappings)
      .where(inArray(masterPostingMappings.masterPostingId, ids));
    const skuCount = new Map<string, number>();
    const mappedCount = new Map<string, number>();
    for (const s of skus) {
      skuCount.set(s.postingId, (skuCount.get(s.postingId) ?? 0) + 1);
      if (s.mapped) mappedCount.set(s.postingId, (mappedCount.get(s.postingId) ?? 0) + 1);
    }
    const mapCount = new Map<string, number>();
    for (const m of maps) mapCount.set(m.postingId, (mapCount.get(m.postingId) ?? 0) + 1);
    return rows.map((r) => ({
      ...r,
      imageCount: r.images?.length ?? 0,
      skuCount: skuCount.get(r.id) ?? 0,
      skuMappedCount: mappedCount.get(r.id) ?? 0,
      mappingCount: mapCount.get(r.id) ?? 0,
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
    return {
      ...posting,
      skus: skus.map((s) => ({
        ...s,
        master: s.masterProductId ? masterById.get(s.masterProductId) ?? null : null,
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

  /** Daftar ringkas master produk AutoToko untuk dropdown pemetaan SKU. */
  async masterProductOptions(userId: string) {
    return this.db
      .select({ id: masterProducts.id, sku: masterProducts.sku, name: masterProducts.name })
      .from(masterProducts)
      .where(eq(masterProducts.userId, userId))
      .orderBy(masterProducts.name);
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
    return this.db
      .select({
        productId: marketplaceProducts.productId,
        title: marketplaceProducts.title,
        status: marketplaceProducts.status,
        marketplace: marketplaceProducts.marketplace,
      })
      .from(marketplaceProducts)
      .where(and(eq(marketplaceProducts.userId, userId), eq(marketplaceProducts.shopId, shopId)))
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

  // ---------------------------------------------------------------- TERAPKAN (push)

  /**
   * Terapkan master posting ke semua listing marketplace termapping.
   *
   * TULISAN KELUAR yang nyata. Memakai partial_edit (aman: hanya menyentuh field
   * yang dikirim, tak menghapus kategori/atribut). v1: nama (title) + deskripsi.
   * Gambar & atribut disiapkan tetapi butuh endpoint unggah gambar TikTok yang
   * belum terpasang → dilaporkan "belum didukung" per-mapping, tidak gagal diam.
   */
  async apply(userId: string, postingId: string) {
    const posting = await this.requirePosting(userId, postingId);
    const mappings = await this.db
      .select()
      .from(masterPostingMappings)
      .where(and(eq(masterPostingMappings.userId, userId), eq(masterPostingMappings.masterPostingId, postingId)));
    if (!mappings.length) {
      return { postingId, total: 0, ok: 0, gagal: 0, dilewati: 0, hasil: [], catatan: "Belum ada listing termapping." };
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
    };
    const hasil: Baris[] = [];

    for (const m of mappings) {
      let shop = shopById.get(m.shopId);
      const nama = shop?.shopName ?? null;
      // Mode "create" (posting baru): pembuatan listing baru butuh unggah gambar
      // TikTok yang belum terpasang → distage, tidak difire (hindari listing rusak).
      if (m.status === "create") {
        const alasan = "Posting baru — pembuatan listing baru belum didukung (butuh unggah gambar TikTok, tahap berikutnya)";
        hasil.push({ mappingId: m.id, productId: m.productId, shop: nama, status: "skipped", reason: alasan });
        await this.tandaiMapping(m.id, "skipped", alasan);
        continue;
      }
      if (!m.productId) {
        hasil.push({ mappingId: m.id, productId: m.productId, shop: nama, status: "skipped", reason: "listing belum dipilih" });
        await this.tandaiMapping(m.id, "skipped", "listing belum dipilih");
        continue;
      }
      if (!shop || !shop.accessToken || !shop.shopCipher) {
        hasil.push({ mappingId: m.id, productId: m.productId, shop: nama, status: "skipped", reason: "toko tidak tersambung API" });
        await this.tandaiMapping(m.id, "skipped", "toko tidak tersambung API");
        continue;
      }
      if (m.marketplace !== "tiktok") {
        hasil.push({ mappingId: m.id, productId: m.productId, shop: nama, status: "skipped", reason: `${m.marketplace} belum didukung` });
        await this.tandaiMapping(m.id, "skipped", `${m.marketplace} belum didukung`);
        continue;
      }
      const body: Record<string, unknown> = { title };
      if (description !== null) body.description = description;
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
        const applied = ["nama"];
        if (description !== null) applied.push("deskripsi");
        const pending = gambarBelumDidukung ? ["gambar (butuh unggah gambar TikTok)"] : [];
        hasil.push({ mappingId: m.id, productId: m.productId, shop: nama, status: "ok", applied, pending });
        await this.tandaiMapping(m.id, "ok", `Diterapkan: ${applied.join(", ")}${pending.length ? " · tertunda: " + pending.join(", ") : ""}`);
      } catch (e) {
        this.logger.warn(`Terapkan master posting ${postingId} → ${m.productId} (${nama}): ${(e as Error).message}`);
        hasil.push({ mappingId: m.id, productId: m.productId, shop: nama, status: "failed", error: (e as Error).message });
        await this.tandaiMapping(m.id, "failed", (e as Error).message);
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
}
