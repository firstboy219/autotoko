import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { and, eq, inArray, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  masterProducts,
  productPostings,
  shops,
} from "../../database/schema/index.js";
import type {
  CreateMasterDto,
  UpdateMasterDto,
  CreatePostingDto,
} from "./dto/products.dto.js";

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

    // Auto-link any existing postings that already carry this SKU (PRD 6.1).
    const linked = await this.linkPostingsBySku(userId, row!.id, dto.sku);
    return { ...row, linkedPostings: linked };
  }

  /** List masters with posting aggregates for the dashboard (PRD 6.2). */
  async listMasters(userId: string) {
    const masters = await this.db
      .select()
      .from(masterProducts)
      .where(eq(masterProducts.userId, userId));
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
    return masters.map((m) => ({
      ...m,
      postingCount: byId.get(m.id)?.postingCount ?? 0,
      totalStock: byId.get(m.id)?.totalStock ?? 0,
      gmv7d: byId.get(m.id)?.gmv7d ?? "0",
    }));
  }

  /** Master detail with postings grouped by shop (PRD 6.2 dashboard). */
  async getMaster(userId: string, id: string) {
    const master = await this.requireMaster(userId, id);

    const rows = await this.db
      .select({
        posting: productPostings,
        shopName: shops.shopName,
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

    return { ...master, shops: [...byShop.values()] };
  }

  async updateMaster(userId: string, id: string, dto: UpdateMasterDto) {
    await this.requireMaster(userId, id);
    const [row] = await this.db
      .update(masterProducts)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(masterProducts.id, id), eq(masterProducts.userId, userId)))
      .returning();
    return row;
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
