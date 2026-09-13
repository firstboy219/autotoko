import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  masterProductCategories,
  masterProducts,
  marketplaceCatalogs,
  marketplaceProducts,
  marketplaceSkus,
  marketplaceSkuMap,
  shopCategories,
  productPostings,
  shops,
} from "../../database/schema/index.js";
import type {
  CreateMasterDto,
  UpdateMasterDto,
  CreatePostingDto,
} from "./dto/products.dto.js";

/**
 * Kunci pengelompokan "produk yang sama lintas toko" dari judul postingan.
 *
 * Judul toko berbeda untuk produk yang sama nyaris selalu beda di ekor
 * (embel-embel promo) dan kadang di spasi/tanda baca ("COOL MINT" vs
 * "COOLMINT"). Jadi: huruf kecilkan, buang segala non-alfanumerik (spasi
 * termasuk), lalu ambil awalannya. Awalan cukup panjang untuk memisahkan
 * produk berbeda dari brand yang sama, cukup pendek untuk memaafkan ekor yang
 * berbeda. Ini heuristik awal; pengguna tetap bisa gabung/pisah manual.
 */
export const CATALOG_KEY_LEN = 24;
export function catalogMatchKey(title: string | null | undefined): string {
  const norm = String(title ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm.slice(0, CATALOG_KEY_LEN);
}

@Injectable()
export class ProductsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async createMaster(userId: string, dto: CreateMasterDto) {
    const [existing] = await this.db
      .select({ id: masterProducts.id })
      .from(masterProducts)
      .where(and(eq(masterProducts.userId, userId), eq(masterProducts.sku, dto.sku)))
      .limit(1);
    if (existing) {
      throw new BadRequestException(`Master product with SKU ${dto.sku} already exists`);
    }

    const [row] = await this.db
      .insert(masterProducts)
      .values({
        userId,
        sku: dto.sku,
        name: dto.name,
        description: dto.description,
        categoryId: dto.categoryId,
        basePrice: dto.basePrice,
        weightGram: dto.weightGram,
        images: dto.images ?? [],
        status: dto.status ?? "draft",
      })
      .returning();

    // Kategori ditulis lewat pembantunya, yang sekaligus mengisi kolom utama
    // shopCategoryId supaya penyaring lama langsung melihat produk baru ini.
    const kategori = (dto as CreateMasterDto & { shopCategoryIds?: string[] })
      .shopCategoryIds;
    const terpasang = kategori?.length
      ? await this.setCategories(userId, row!.id, kategori)
      : [];

    // Auto-link any existing postings that already carry this SKU (PRD 6.1).
    const linked = await this.linkPostingsBySku(userId, row!.id, dto.sku);
    return { ...row, linkedPostings: linked, shopCategoryIds: terpasang };
  }

  /** List masters with posting aggregates for the dashboard (PRD 6.2). */
  /** `brandId` narrows to one business; "none" means the unassigned ones. */
  async listMasters(userId: string, brandId?: string | null) {
    // "none" is a real answer, not the absence of one: unassigned rows have to
    // be reachable, or a catalogue quietly loses whatever nobody categorised.
    const brandWhere =
      brandId === "none"
        ? isNull(masterProducts.shopCategoryId)
        : brandId
          ? eq(masterProducts.shopCategoryId, brandId)
          : undefined;

    const masters = await this.db
      .select()
      .from(masterProducts)
      .where(
        brandWhere
          ? and(eq(masterProducts.userId, userId), brandWhere)
          : eq(masterProducts.userId, userId),
      );
    if (masters.length === 0) return [];

    const ids = masters.map((m) => m.id);
    const aggs = await this.db
      .select({
        masterId: productPostings.masterProductId,
        postingCount: sql<number>`count(*)::int`,
        totalStock: sql<number>`coalesce(sum(${productPostings.stock}), 0)::int`,
        gmv7d: sql<string>`coalesce(sum(${productPostings.gmv7d}), 0)`,
      })
      .from(productPostings)
      .where(inArray(productPostings.masterProductId, ids))
      .groupBy(productPostings.masterProductId);

    const byId = new Map(aggs.map((a) => [a.masterId, a]));
    const kategori = await this.categoriesFor(userId, ids);
    return masters.map((m) => ({
      ...m,
      postingCount: byId.get(m.id)?.postingCount ?? 0,
      totalStock: byId.get(m.id)?.totalStock ?? 0,
      gmv7d: byId.get(m.id)?.gmv7d ?? "0",
      // Kolom shopCategoryId tetap dikirim apa adanya sebagai kategori utama;
      // ini daftar lengkapnya.
      shopCategoryIds: kategori.get(m.id) ?? [],
    }));
  }

  /** Master detail with postings grouped by shop (PRD 6.2 dashboard). */
  async getMaster(userId: string, id: string) {
    const master = await this.requireMaster(userId, id);

    const rows = await this.db
      .select({
        posting: productPostings,
        shopName: sql<string>`coalesce(${shops.displayName}, ${shops.shopName})`,
        marketplace: shops.marketplace,
      })
      .from(productPostings)
      .innerJoin(shops, eq(productPostings.shopId, shops.id))
      .where(eq(productPostings.masterProductId, id));

    const byShop = new Map<string, { shopId: string; shopName: string | null; marketplace: string; postings: unknown[] }>();
    for (const r of rows) {
      const key = r.posting.shopId;
      if (!byShop.has(key)) {
        byShop.set(key, {
          shopId: key,
          shopName: r.shopName,
          marketplace: r.marketplace,
          postings: [],
        });
      }
      byShop.get(key)!.postings.push(r.posting);
    }

    const kategori = await this.categoriesFor(userId, [id]);
    return {
      ...master,
      shops: [...byShop.values()],
      shopCategoryIds: kategori.get(id) ?? [],
    };
  }

  /**
   * `shopCategoryId` is handled below like every other optional field.
   *
   * `shopCategoryIds` TIDAK ikut disebar ke .set(): ia bukan kolom, dan
   * menyebarnya akan membuat Drizzle menulis kolom yang tidak ada. Ia ditangani
   * pembantunya sendiri, yang sekaligus menjaga kolom utama tetap sinkron.
   */
  async updateMaster(userId: string, id: string, dto: UpdateMasterDto) {
    await this.requireMaster(userId, id);
    const { shopCategoryIds, ...kolom } = dto as UpdateMasterDto & {
      shopCategoryIds?: string[];
    };

    let ids: string[] | null = null;
    if (shopCategoryIds !== undefined) {
      ids = await this.setCategories(userId, id, shopCategoryIds);
    }

    // Kalau yang dikirim HANYA kategori, tidak ada kolom lain yang perlu
    // ditulis -- dan .set({}) adalah galat SQL, bukan tanpa efek.
    let row;
    if (Object.keys(kolom).length > 0) {
      [row] = await this.db
        .update(masterProducts)
        .set({ ...kolom, updatedAt: new Date() })
        .where(and(eq(masterProducts.id, id), eq(masterProducts.userId, userId)))
        .returning();
    } else {
      row = await this.requireMaster(userId, id);
    }

    const kategori = ids ?? (await this.categoriesFor(userId, [id])).get(id) ?? [];
    return { ...row, shopCategoryIds: kategori };
  }

  /** Hard delete (cascades postings). Frontend must confirm (PRD 19.2). */
  async deleteMaster(userId: string, id: string) {
    await this.requireMaster(userId, id);
    await this.db
      .delete(masterProducts)
      .where(and(eq(masterProducts.id, id), eq(masterProducts.userId, userId)));
    return { deleted: id };
  }

  async createPosting(userId: string, dto: CreatePostingDto) {
    // Verify the shop belongs to the user (multi-tenant isolation).
    const [shop] = await this.db
      .select({ id: shops.id })
      .from(shops)
      .where(and(eq(shops.id, dto.shopId), eq(shops.userId, userId)))
      .limit(1);
    if (!shop) throw new BadRequestException("Shop not found for this user");

    // SKU matching — the heart of master<->posting linking (PRD 1.2 / 17.4).
    const master = await this.resolveMasterBySku(userId, dto.marketplaceSku);
    if (!master) {
      throw new BadRequestException(
        `No master product with SKU ${dto.marketplaceSku}; create the master first`,
      );
    }

    const [row] = await this.db
      .insert(productPostings)
      .values({
        masterProductId: master.id,
        shopId: dto.shopId,
        marketplaceItemId: dto.marketplaceItemId,
        marketplaceSku: dto.marketplaceSku,
        title: dto.title,
        price: dto.price,
        stock: dto.stock,
        status: dto.status ?? "active",
      })
      .returning();
    return row;
  }

  async deletePosting(userId: string, postingId: string) {
    // Ensure the posting's master belongs to the user before deleting.
    const [row] = await this.db
      .select({ id: productPostings.id })
      .from(productPostings)
      .innerJoin(masterProducts, eq(productPostings.masterProductId, masterProducts.id))
      .where(and(eq(productPostings.id, postingId), eq(masterProducts.userId, userId)))
      .limit(1);
    if (!row) throw new NotFoundException("Posting not found");
    await this.db.delete(productPostings).where(eq(productPostings.id, postingId));
    return { deleted: postingId };
  }

  /** Find the master product owning a given SKU (PRD 1.2). */
  async resolveMasterBySku(userId: string, sku: string) {
    const [master] = await this.db
      .select()
      .from(masterProducts)
      .where(and(eq(masterProducts.userId, userId), eq(masterProducts.sku, sku)))
      .limit(1);
    return master ?? null;
  }


  /**
   * Pohon Katalog > Postingan > Varian, dengan harga API dan master tiap varian.
   *
   * Postingan  = satu listing marketplace (marketplace_products) di satu toko.
   * Varian     = satu SKU (marketplace_skus), dipetakan ke master lewat
   *              marketplace_sku_map (per-varian) atau seller_sku==sku master.
   * Katalog    = kumpulan postingan produk yang sama lintas toko.
   *
   * Postingan tanpa katalog dikembalikan di bucket "tanpaKatalog" -- terlihat,
   * bukan hilang, dan bisa dikelompokkan lewat regroup atau dipindah manual.
   */
  async catalogTree(userId: string) {
    const [catalogs, postings, skus, masters, maps] = await Promise.all([
      this.db.select().from(marketplaceCatalogs).where(eq(marketplaceCatalogs.userId, userId)),
      this.db
        .select({
          productId: marketplaceProducts.productId,
          catalogId: marketplaceProducts.catalogId,
          title: marketplaceProducts.title,
          status: marketplaceProducts.status,
          marketplace: marketplaceProducts.marketplace,
          shopName: sql`coalesce(${shops.displayName}, ${shops.shopName})`.as("shop_name"),
        })
        .from(marketplaceProducts)
        .innerJoin(shops, eq(shops.id, marketplaceProducts.shopId))
        .where(eq(marketplaceProducts.userId, userId)),
      this.db
        .select({
          productId: marketplaceSkus.productId,
          skuId: marketplaceSkus.skuId,
          sellerSku: marketplaceSkus.sellerSku,
          skuName: marketplaceSkus.skuName,
          productName: marketplaceSkus.productName,
          price: marketplaceSkus.price,
          currency: marketplaceSkus.currency,
          stock: marketplaceSkus.stock,
        })
        .from(marketplaceSkus)
        .where(eq(marketplaceSkus.userId, userId)),
      this.db
        .select({ id: masterProducts.id, sku: masterProducts.sku, name: masterProducts.name })
        .from(masterProducts)
        .where(eq(masterProducts.userId, userId)),
      this.db
        .select({ sku: marketplaceSkuMap.sku, masterId: marketplaceSkuMap.masterProductId })
        .from(marketplaceSkuMap)
        .where(eq(marketplaceSkuMap.userId, userId)),
    ]);

    const masterName = new Map(masters.map((m) => [m.id, m.name] as const));
    const masterBySku = new Map<string, string>();
    for (const m of masters) if (m.sku) masterBySku.set(m.sku.trim().toLowerCase(), m.id);
    const mapBySkuId = new Map(maps.map((m) => [m.sku, m.masterId] as const));

    const varByProduct = new Map<string, unknown[]>();
    let totalVar = 0;
    let mapped = 0;
    for (const s2 of skus) {
      if (!s2.productId) continue;
      totalVar += 1;
      let masterId: string | null = mapBySkuId.get(s2.skuId) ?? null;
      let via: "map" | "sku" | null = masterId ? "map" : null;
      if (masterId && !masterName.has(masterId)) { masterId = null; via = null; }
      if (!masterId && s2.sellerSku) {
        const mm = masterBySku.get(s2.sellerSku.trim().toLowerCase());
        if (mm) { masterId = mm; via = "sku"; }
      }
      if (masterId) mapped += 1;
      const arr = varByProduct.get(s2.productId) ?? [];
      arr.push({
        skuId: s2.skuId,
        nama: s2.skuName ?? s2.productName ?? "(varian)",
        sellerSku: s2.sellerSku,
        harga: s2.price != null ? Number(s2.price) : null,
        currency: s2.currency ?? "IDR",
        stok: s2.stock,
        masterId,
        masterName: masterId ? masterName.get(masterId) ?? null : null,
        via,
      });
      varByProduct.set(s2.productId, arr);
    }

    const asPosting = (p: (typeof postings)[number]) => ({
      productId: p.productId,
      title: p.title,
      status: p.status,
      marketplace: p.marketplace,
      shopName: p.shopName as string | null,
      varian: varByProduct.get(p.productId) ?? [],
    });

    const perCatalog = new Map<string, { postings: (typeof postings) }>();
    const tanpaKatalog: unknown[] = [];
    for (const p of postings) {
      if (p.catalogId) {
        const g = perCatalog.get(p.catalogId) ?? { postings: [] as typeof postings };
        g.postings.push(p);
        perCatalog.set(p.catalogId, g);
      } else {
        tanpaKatalog.push(asPosting(p));
      }
    }

    const katalog = catalogs
      .map((c) => ({
        id: c.id,
        name: c.name,
        note: c.note,
        postingan: (perCatalog.get(c.id)?.postings ?? []).map(asPosting),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      ringkas: {
        katalog: katalog.length,
        postingan: postings.length,
        varian: totalVar,
        varianTerpetakan: mapped,
        postinganTanpaKatalog: tanpaKatalog.length,
      },
      katalog,
      tanpaKatalog,
      masters: masters.map((m) => ({ id: m.id, name: m.name, sku: m.sku })),
    };
  }

  /**
   * Mengelompokkan postingan yang belum berkatalog menurut kesamaan judul.
   *
   * Hanya menyentuh postingan ber-catalog_id NULL: pengelompokan/pemindahan
   * manual yang sudah ada TIDAK ditimpa. Postingan baru dari kesamaan judul
   * menempel ke katalog lama yang match_key-nya sama; sisanya bikin katalog
   * baru bernama judul postingannya.
   */
  async regroupCatalogs(userId: string) {
    const belum = await this.db
      .select({ productId: marketplaceProducts.productId, title: marketplaceProducts.title })
      .from(marketplaceProducts)
      .where(and(eq(marketplaceProducts.userId, userId), isNull(marketplaceProducts.catalogId)));

    const existing = await this.db
      .select({ id: marketplaceCatalogs.id, key: marketplaceCatalogs.matchKey })
      .from(marketplaceCatalogs)
      .where(eq(marketplaceCatalogs.userId, userId));
    const byKey = new Map<string, string>();
    for (const c of existing) if (c.key) byKey.set(c.key, c.id);

    let dibuat = 0;
    let ditugaskan = 0;
    for (const p of belum) {
      const key = catalogMatchKey(p.title);
      if (!key) continue; // tak berjudul -> biarkan tanpa katalog
      let catId = byKey.get(key);
      if (!catId) {
        const [c] = await this.db
          .insert(marketplaceCatalogs)
          .values({ userId, name: (p.title ?? "Tanpa nama").slice(0, 120), matchKey: key })
          .returning({ id: marketplaceCatalogs.id });
        catId = c!.id;
        byKey.set(key, catId);
        dibuat += 1;
      }
      await this.db
        .update(marketplaceProducts)
        .set({ catalogId: catId })
        .where(and(eq(marketplaceProducts.userId, userId), eq(marketplaceProducts.productId, p.productId)));
      ditugaskan += 1;
    }
    return { dibuat, ditugaskan, sisaTanpaKatalog: belum.length - ditugaskan };
  }

  async createCatalog(userId: string, name: string) {
    const nm = (name ?? "").trim();
    if (!nm) throw new BadRequestException("Nama katalog wajib diisi");
    const [c] = await this.db
      .insert(marketplaceCatalogs)
      .values({ userId, name: nm })
      .returning();
    return c;
  }

  async renameCatalog(userId: string, id: string, name: string) {
    const nm = (name ?? "").trim();
    if (!nm) throw new BadRequestException("Nama katalog wajib diisi");
    const [c] = await this.db
      .update(marketplaceCatalogs)
      .set({ name: nm, updatedAt: new Date() })
      .where(and(eq(marketplaceCatalogs.id, id), eq(marketplaceCatalogs.userId, userId)))
      .returning();
    if (!c) throw new NotFoundException("Katalog tidak ditemukan");
    return c;
  }

  async deleteCatalog(userId: string, id: string) {
    // ON DELETE SET NULL melepas postingannya, tidak menghapusnya.
    const [c] = await this.db
      .delete(marketplaceCatalogs)
      .where(and(eq(marketplaceCatalogs.id, id), eq(marketplaceCatalogs.userId, userId)))
      .returning({ id: marketplaceCatalogs.id });
    if (!c) throw new NotFoundException("Katalog tidak ditemukan");
    return { deleted: id };
  }

  /** Memindah satu postingan ke sebuah katalog (atau lepas: catalogId null). */
  async assignPostingCatalog(userId: string, productId: string, catalogId: string | null) {
    if (catalogId) {
      const [c] = await this.db
        .select({ id: marketplaceCatalogs.id })
        .from(marketplaceCatalogs)
        .where(and(eq(marketplaceCatalogs.id, catalogId), eq(marketplaceCatalogs.userId, userId)))
        .limit(1);
      if (!c) throw new NotFoundException("Katalog tidak ditemukan");
    }
    const rows = await this.db
      .update(marketplaceProducts)
      .set({ catalogId })
      .where(and(eq(marketplaceProducts.userId, userId), eq(marketplaceProducts.productId, productId)))
      .returning({ productId: marketplaceProducts.productId });
    if (rows.length === 0) throw new NotFoundException("Postingan tidak ditemukan");
    return { productId, catalogId };
  }

  /**
   * Memetakan (atau melepas) satu VARIAN (SKU) ke satu master.
   *
   * Inti revisi: yang menempel ke master adalah varian di dalam postingan,
   * bukan seluruh postingan. Disimpan di marketplace_sku_map (per sku_id) --
   * tabel yang sama dgn audit, jadi nama produk di laporan penyelesaian ikut
   * terisi. masterId null melepas tautan.
   */
  async linkVariant(userId: string, skuId: string, masterId: string | null) {
    const [row] = await this.db
      .select({ marketplace: marketplaceSkus.marketplace })
      .from(marketplaceSkus)
      .where(and(eq(marketplaceSkus.userId, userId), eq(marketplaceSkus.skuId, skuId)))
      .limit(1);
    if (!row) throw new NotFoundException("Varian tidak ditemukan");

    if (!masterId) {
      await this.db
        .delete(marketplaceSkuMap)
        .where(and(
          eq(marketplaceSkuMap.userId, userId),
          eq(marketplaceSkuMap.marketplace, row.marketplace),
          eq(marketplaceSkuMap.sku, skuId),
        ));
      return { skuId, masterId: null };
    }

    const [m] = await this.db
      .select({ id: masterProducts.id })
      .from(masterProducts)
      .where(and(eq(masterProducts.id, masterId), eq(masterProducts.userId, userId)))
      .limit(1);
    if (!m) throw new NotFoundException("Master produk tidak ditemukan");

    await this.db
      .insert(marketplaceSkuMap)
      .values({ userId, marketplace: row.marketplace, sku: skuId, masterProductId: masterId, mappedBy: userId })
      .onConflictDoUpdate({
        target: [marketplaceSkuMap.userId, marketplaceSkuMap.marketplace, marketplaceSkuMap.sku],
        set: { masterProductId: masterId, mappedBy: userId, updatedAt: new Date() },
      });
    return { skuId, masterId };
  }

  /** Link orphan postings (same SKU, no/other master) to this master. */
  private async linkPostingsBySku(userId: string, masterId: string, sku: string) {
    const result = await this.db
      .update(productPostings)
      .set({ masterProductId: masterId })
      .where(
        and(
          eq(productPostings.marketplaceSku, sku),
          inArray(
            productPostings.shopId,
            this.db.select({ id: shops.id }).from(shops).where(eq(shops.userId, userId)),
          ),
        ),
      )
      .returning({ id: productPostings.id });
    return result.length;
  }

  /**
   * Kategori tiap produk, dikembalikan sebagai daftar id.
   *
   * Satu kueri untuk seluruh halaman, bukan satu per produk: daftar produk
   * memuat puluhan baris, dan pertanyaan "kategorinya apa saja" tidak layak
   * dibayar dengan puluhan perjalanan ke database.
   */
  private async categoriesFor(
    userId: string,
    productIds: string[],
  ): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (!productIds.length) return out;
    const rows = await this.db
      .select({
        productId: masterProductCategories.productId,
        shopCategoryId: masterProductCategories.shopCategoryId,
      })
      .from(masterProductCategories)
      .where(
        and(
          eq(masterProductCategories.userId, userId),
          inArray(masterProductCategories.productId, productIds),
        ),
      );
    for (const r of rows) {
      const list = out.get(r.productId) ?? [];
      list.push(r.shopCategoryId);
      out.set(r.productId, list);
    }
    return out;
  }

  /**
   * Ganti seluruh kategori sebuah produk.
   *
   * Yang PERTAMA menjadi kategori utama dan ikut ditulis ke kolom lama
   * shopCategoryId. Tanpa itu, penyaring di halaman produk dan angka per
   * kategori di shop-insights akan diam-diam kehilangan produknya -- keduanya
   * membaca kolom itu, bukan tabel ini.
   *
   * Kategori milik orang lain disaring, bukan ditolak: daftar yang dikirim
   * layar bisa basi setelah sebuah kategori dihapus, dan menggagalkan seluruh
   * penyimpanan karena satu id usang akan menghilangkan suntingan yang lain.
   */
  private async setCategories(userId: string, productId: string, ids: string[]) {
    const sah = ids.length
      ? await this.db
          .select({ id: shopCategories.id })
          .from(shopCategories)
          .where(and(eq(shopCategories.userId, userId), inArray(shopCategories.id, ids)))
      : [];
    const sahIds = ids.filter((x) => sah.some((s) => s.id === x));

    await this.db
      .delete(masterProductCategories)
      .where(
        and(
          eq(masterProductCategories.userId, userId),
          eq(masterProductCategories.productId, productId),
        ),
      );
    if (sahIds.length) {
      await this.db
        .insert(masterProductCategories)
        .values(sahIds.map((id) => ({ productId, shopCategoryId: id, userId })))
        .onConflictDoNothing();
    }
    await this.db
      .update(masterProducts)
      .set({ shopCategoryId: sahIds[0] ?? null, updatedAt: new Date() })
      .where(and(eq(masterProducts.userId, userId), eq(masterProducts.id, productId)));
    return sahIds;
  }

  private async requireMaster(userId: string, id: string) {
    const [master] = await this.db
      .select()
      .from(masterProducts)
      .where(and(eq(masterProducts.id, id), eq(masterProducts.userId, userId)))
      .limit(1);
    if (!master) throw new NotFoundException("Master product not found");
    return master;
  }
}
