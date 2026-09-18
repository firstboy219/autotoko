import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  masterPostings,
  masterPostingSkus,
  masterPostingMappings,
  masterProducts,
  marketplaceProducts,
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
    const [row] = await this.db
      .insert(masterPostingMappings)
      .values({
        userId,
        masterPostingId: postingId,
        shopId: dto.shopId,
        marketplace,
        productId: dto.productId,
        status: "mapped",
      })
      .onConflictDoUpdate({
        target: [
          masterPostingMappings.masterPostingId,
          masterPostingMappings.shopId,
          masterPostingMappings.productId,
        ],
        set: { status: "mapped", updatedAt: new Date() },
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
