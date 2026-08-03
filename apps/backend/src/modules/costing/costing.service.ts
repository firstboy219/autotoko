import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  calculateHpp,
  calculatePublishPricing,
  requiredPublishPriceCents,
  type PublishPriceTarget,
} from "@autotoko/shared";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  bomItems,
  masterProducts,
  orders,
  payoutSettings,
  productCosting,
} from "../../database/schema/index.js";
import type {
  CreateMaterialDto,
  SuggestPriceDto,
  UpdateCostingDto,
  UpdateMaterialCostDto,
} from "./dto/costing.dto.js";

const num = (v: string | number | null | undefined) => Number(v ?? 0);
const rupiah = (cents: number) => cents / 100;

type CostingRow = typeof productCosting.$inferSelect;

/**
 * Harga Pokok Produksi (COGS) + publish-price modelling.
 *
 * All arithmetic is delegated to @autotoko/shared (calculateHpp /
 * calculatePublishPricing), which in turn reuses calculatePayoutSplit — so the
 * profit projection shown here is computed by the same code that will actually
 * split the money in the Pencairan module.
 */
@Injectable()
export class CostingService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Overview: every product with its HPP, publish price and projected profit. */
  async list(userId: string) {
    const products = await this.db
      .select()
      .from(masterProducts)
      .where(eq(masterProducts.userId, userId))
      .orderBy(asc(masterProducts.name));
    if (!products.length) return [];

    const ids = products.map((p) => p.id);
    const [materials, costings] = await Promise.all([
      this.db.select().from(bomItems).where(inArray(bomItems.masterProductId, ids)),
      this.db.select().from(productCosting).where(inArray(productCosting.masterProductId, ids)),
    ]);

    const matByProduct = new Map<string, typeof materials>();
    for (const m of materials) {
      const arr = matByProduct.get(m.masterProductId) ?? [];
      arr.push(m);
      matByProduct.set(m.masterProductId, arr);
    }
    const costByProduct = new Map(costings.map((c) => [c.masterProductId, c]));

    return products.map((p) => {
      const mats = matByProduct.get(p.id) ?? [];
      const cfg = costByProduct.get(p.id);
      const hpp = calculateHpp({
        materials: mats.map((m) => ({ quantity: num(m.quantity), unitCost: num(m.unitCost) })),
        serviceCostPerPcs: num(cfg?.serviceCostPerPcs),
        packingCostPerOrder: num(cfg?.packingCostPerOrder),
        avgUnitsPerOrder: cfg ? num(cfg.avgUnitsPerOrder) : 1,
      });
      const publishPrice = cfg?.publishPrice != null ? num(cfg.publishPrice) : null;
      const pricing =
        publishPrice != null && cfg
          ? calculatePublishPricing(this.pricingInput(cfg, publishPrice, hpp.hppCents))
          : null;

      return {
        productId: p.id,
        sku: p.sku,
        name: p.name,
        materialCount: mats.length,
        // Flagged so the UI can tell "no materials yet" apart from "materials
        // exist but nobody has priced them".
        missingCost: mats.some((m) => num(m.unitCost) <= 0),
        hpp: rupiah(hpp.hppCents),
        publishPrice,
        netProfit: pricing ? rupiah(pricing.netProfitCents) : null,
        netMarginRate: pricing ? pricing.netMarginRate : null,
      };
    });
  }

  /** Full detail for one product: recipe lines, config, and the breakdown. */
  async detail(userId: string, productId: string) {
    const product = await this.getProductOrThrow(userId, productId);
    const cfg = await this.getOrCreateCosting(userId, productId);
    const materials = await this.db
      .select()
      .from(bomItems)
      .where(eq(bomItems.masterProductId, productId))
      .orderBy(asc(bomItems.materialName));

    const lines = materials.map((m) => ({
      id: m.id,
      materialName: m.materialName,
      unit: m.unit,
      quantity: num(m.quantity),
      unitCost: num(m.unitCost),
      lineCost: num(m.quantity) * num(m.unitCost),
    }));

    const hpp = calculateHpp({
      materials: lines.map((l) => ({ quantity: l.quantity, unitCost: l.unitCost })),
      serviceCostPerPcs: num(cfg.serviceCostPerPcs),
      packingCostPerOrder: num(cfg.packingCostPerOrder),
      avgUnitsPerOrder: num(cfg.avgUnitsPerOrder),
    });

    const publishPrice = cfg.publishPrice != null ? num(cfg.publishPrice) : null;
    const pricing =
      publishPrice != null
        ? calculatePublishPricing(this.pricingInput(cfg, publishPrice, hpp.hppCents))
        : null;

    return {
      product: { id: product.id, sku: product.sku, name: product.name },
      materials: lines,
      costing: this.serialiseCosting(cfg),
      hpp: {
        materialCost: rupiah(hpp.materialCostCents),
        serviceCost: rupiah(hpp.serviceCostCents),
        packingCost: rupiah(hpp.packingCostCents),
        total: rupiah(hpp.hppCents),
      },
      pricing: pricing ? this.serialisePricing(pricing) : null,
    };
  }

  async updateCosting(userId: string, productId: string, dto: UpdateCostingDto) {
    await this.getProductOrThrow(userId, productId);
    await this.getOrCreateCosting(userId, productId);

    const set: Record<string, unknown> = { updatedAt: new Date() };
    const rate = (v: number) => v.toFixed(4);
    const money = (v: number) => v.toFixed(2);

    if (dto.serviceCostPerPcs != null) set.serviceCostPerPcs = money(dto.serviceCostPerPcs);
    if (dto.packingCostPerOrder != null) set.packingCostPerOrder = money(dto.packingCostPerOrder);
    if (dto.avgUnitsPerOrder != null) set.avgUnitsPerOrder = dto.avgUnitsPerOrder.toFixed(2);
    // publishPrice is explicitly nullable — null clears it back to "not set".
    if (dto.publishPrice !== undefined) {
      set.publishPrice = dto.publishPrice == null ? null : money(dto.publishPrice);
    }
    if (dto.marketplaceFeeRate != null) set.marketplaceFeeRate = rate(dto.marketplaceFeeRate);
    if (dto.eventRate != null) set.eventRate = rate(dto.eventRate);
    if (dto.affiliatorRate != null) set.affiliatorRate = rate(dto.affiliatorRate);
    if (dto.adsRate != null) set.adsRate = rate(dto.adsRate);
    if (dto.adsFixedPerPcs != null) set.adsFixedPerPcs = money(dto.adsFixedPerPcs);
    if (dto.sedekahRate != null) set.sedekahRate = rate(dto.sedekahRate);
    if (dto.resellerRate != null) set.resellerRate = rate(dto.resellerRate);
    if (dto.targetProfitRate != null) set.targetProfitRate = rate(dto.targetProfitRate);

    await this.db
      .update(productCosting)
      .set(set)
      .where(eq(productCosting.masterProductId, productId));

    return this.detail(userId, productId);
  }

  /**
   * Adds a recipe line without leaving the costing page. Supplier/restock
   * columns keep their defaults — those are BOM-module concerns.
   */
  async addMaterial(userId: string, productId: string, dto: CreateMaterialDto) {
    await this.getProductOrThrow(userId, productId);
    await this.db.insert(bomItems).values({
      masterProductId: productId,
      materialName: dto.materialName.trim(),
      quantity: dto.quantity.toFixed(3),
      unit: dto.unit?.trim() || null,
      unitCost: (dto.unitCost ?? 0).toFixed(2),
    });
    return this.detail(userId, productId);
  }

  /** Removes a recipe line. Ownership is proven by joining through the product. */
  async removeMaterial(userId: string, bomItemId: string) {
    const productId = await this.getMaterialProductOrThrow(userId, bomItemId);
    await this.db.delete(bomItems).where(eq(bomItems.id, bomItemId));
    return this.detail(userId, productId);
  }

  /** Quantity + unit cost only; the rest of a material lives in the BOM module. */
  async updateMaterial(userId: string, bomItemId: string, dto: UpdateMaterialCostDto) {
    const productId = await this.getMaterialProductOrThrow(userId, bomItemId);

    const set: Record<string, unknown> = {};
    if (dto.quantity != null) set.quantity = dto.quantity.toFixed(3);
    if (dto.unitCost != null) set.unitCost = dto.unitCost.toFixed(2);
    if (Object.keys(set).length) {
      await this.db.update(bomItems).set(set).where(eq(bomItems.id, bomItemId));
    }
    return this.detail(userId, productId);
  }

  /** Suggests the publish price that would hit a target margin or profit. */
  async suggestPrice(userId: string, productId: string, dto: SuggestPriceDto) {
    await this.getProductOrThrow(userId, productId);
    const cfg = await this.getOrCreateCosting(userId, productId);
    const materials = await this.db
      .select({ quantity: bomItems.quantity, unitCost: bomItems.unitCost })
      .from(bomItems)
      .where(eq(bomItems.masterProductId, productId));

    const hpp = calculateHpp({
      materials: materials.map((m) => ({ quantity: num(m.quantity), unitCost: num(m.unitCost) })),
      serviceCostPerPcs: num(cfg.serviceCostPerPcs),
      packingCostPerOrder: num(cfg.packingCostPerOrder),
      avgUnitsPerOrder: num(cfg.avgUnitsPerOrder),
    });

    const target: PublishPriceTarget =
      dto.kind === "margin"
        ? { kind: "margin", marginRate: dto.value }
        : { kind: "profit", profitCents: Math.round(dto.value * 100) };

    const raw = requiredPublishPriceCents({
      hppCents: hpp.hppCents,
      marketplaceFeeRate: num(cfg.marketplaceFeeRate),
      eventRate: num(cfg.eventRate),
      affiliatorRate: num(cfg.affiliatorRate),
      adsRate: num(cfg.adsRate),
      adsFixedCents: Math.round(num(cfg.adsFixedPerPcs) * 100),
      sedekahRate: num(cfg.sedekahRate),
      resellerRate: num(cfg.resellerRate),
      target,
    });

    if (raw == null) {
      return {
        suggestedPrice: null,
        reason:
          "Target tidak tercapai dengan komposisi biaya saat ini — total potongan sudah menghabiskan harga jual. Turunkan target atau kurangi persentase biaya.",
        preview: null,
      };
    }

    // Nobody lists a price of Rp 9.259,26 — round UP to a whole rupiah so the
    // suggestion is directly usable and still clears the target.
    const cents = Math.ceil(raw / 100) * 100;

    // Round-trip the suggestion so the seller sees the exact rounded figures,
    // not the closed-form approximation.
    const preview = calculatePublishPricing(this.pricingInput(cfg, rupiah(cents), hpp.hppCents));
    return { suggestedPrice: rupiah(cents), reason: null, preview: this.serialisePricing(preview) };
  }


  /**
   * Suggests avgUnitsPerOrder from the tenant's actual order history.
   *
   * orders.items is a JSON array of {quantity, seller_sku, ...}; the average is
   * total units shipped / number of orders. Returns null when there is no data
   * rather than a made-up figure, so the UI can say so instead of showing a
   * confident-looking default.
   */
  async suggestAvgUnitsPerOrder(userId: string) {
    const rows = await this.db
      .select({ items: orders.items })
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt))
      .limit(200);

    let totalUnits = 0;
    let counted = 0;
    for (const r of rows) {
      const items = r.items as { quantity?: number | string }[] | null;
      if (!Array.isArray(items) || !items.length) continue;
      const units = items.reduce((n, it) => n + (Number(it?.quantity) || 0), 0);
      if (units <= 0) continue;
      totalUnits += units;
      counted += 1;
    }

    if (!counted) return { suggested: null as number | null, basedOnOrders: 0 };
    return {
      suggested: Number((totalUnits / counted).toFixed(2)),
      basedOnOrders: counted,
    };
  }

  /* ------------------------------------------------------------ helpers */

  private pricingInput(cfg: CostingRow, publishPrice: number, hppCents: number) {
    return {
      publishPriceCents: Math.round(publishPrice * 100),
      hppCents,
      marketplaceFeeRate: num(cfg.marketplaceFeeRate),
      eventRate: num(cfg.eventRate),
      affiliatorRate: num(cfg.affiliatorRate),
      adsRate: num(cfg.adsRate),
      adsFixedCents: Math.round(num(cfg.adsFixedPerPcs) * 100),
      sedekahRate: num(cfg.sedekahRate),
      resellerRate: num(cfg.resellerRate),
    };
  }

  private serialiseCosting(c: CostingRow) {
    return {
      serviceCostPerPcs: num(c.serviceCostPerPcs),
      packingCostPerOrder: num(c.packingCostPerOrder),
      avgUnitsPerOrder: num(c.avgUnitsPerOrder),
      publishPrice: c.publishPrice != null ? num(c.publishPrice) : null,
      marketplaceFeeRate: num(c.marketplaceFeeRate),
      eventRate: num(c.eventRate),
      affiliatorRate: num(c.affiliatorRate),
      adsRate: num(c.adsRate),
      adsFixedPerPcs: num(c.adsFixedPerPcs),
      sedekahRate: num(c.sedekahRate),
      resellerRate: num(c.resellerRate),
      targetProfitRate: num(c.targetProfitRate),
    };
  }

  private serialisePricing(p: ReturnType<typeof calculatePublishPricing>) {
    return {
      publishPrice: rupiah(p.publishPriceCents),
      marketplaceFee: rupiah(p.marketplaceFeeCents),
      event: rupiah(p.eventCents),
      affiliator: rupiah(p.affiliatorCents),
      marketplaceWithheld: rupiah(p.marketplaceWithheldCents),
      payout: rupiah(p.payoutCents),
      sedekah: rupiah(p.sedekahCents),
      reseller: rupiah(p.resellerCents),
      sellerShare: rupiah(p.sellerShareCents),
      hpp: rupiah(p.hppCents),
      ads: rupiah(p.adsCents),
      netProfit: rupiah(p.netProfitCents),
      netMarginRate: p.netMarginRate,
    };
  }

  /**
   * bom_items has no user_id of its own (it is keyed by product), so tenant
   * ownership is proven by joining through master_products — this is the only
   * thing standing between one tenant and another's recipe lines.
   */
  private async getMaterialProductOrThrow(userId: string, bomItemId: string): Promise<string> {
    const [row] = await this.db
      .select({ productId: bomItems.masterProductId })
      .from(bomItems)
      .innerJoin(masterProducts, eq(bomItems.masterProductId, masterProducts.id))
      .where(and(eq(bomItems.id, bomItemId), eq(masterProducts.userId, userId)))
      .limit(1);
    if (!row) throw new NotFoundException("Bahan baku tidak ditemukan");
    return row.productId;
  }

  private async getProductOrThrow(userId: string, productId: string) {
    const [row] = await this.db
      .select()
      .from(masterProducts)
      .where(and(eq(masterProducts.id, productId), eq(masterProducts.userId, userId)))
      .limit(1);
    if (!row) throw new NotFoundException("Produk tidak ditemukan");
    return row;
  }

  /**
   * Costing rows are created lazily on first open. Sedekah defaults to the
   * tenant's configured payout rate so the projection matches their real
   * setup out of the box; it stays independently editable afterwards.
   */
  private async getOrCreateCosting(userId: string, productId: string): Promise<CostingRow> {
    const [existing] = await this.db
      .select()
      .from(productCosting)
      .where(eq(productCosting.masterProductId, productId))
      .limit(1);
    if (existing) return existing;

    const [settings] = await this.db
      .select({ sedekahRate: payoutSettings.sedekahRate })
      .from(payoutSettings)
      .where(eq(payoutSettings.userId, userId))
      .limit(1);

    const [created] = await this.db
      .insert(productCosting)
      .values({
        masterProductId: productId,
        userId,
        ...(settings?.sedekahRate ? { sedekahRate: settings.sedekahRate } : {}),
      })
      .returning();
    return created!;
  }
}
