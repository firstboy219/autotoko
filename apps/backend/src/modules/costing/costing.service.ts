import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
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
  materials,
  orders,
  packingMaterials,
  payoutSettings,
  productCosting,
  productPackingQuantities,
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
  // ---------------------------------------------------------------- packing

  /**
   * The shared packing list: which materials every shipment uses.
   *
   * Cost comes from the catalogue rather than being copied here, so a price
   * change from a purchase reaches every product's HPP at once — the whole
   * reason these are catalogue materials and not numbers typed per product.
   */
  async listPackingMaterials(userId: string) {
    const rows = await this.db
      .select({
        id: packingMaterials.id,
        materialId: packingMaterials.materialId,
        name: materials.name,
        unit: materials.unit,
        defaultQuantity: packingMaterials.defaultQuantity,
        unitCost: materials.unitCost,
        currentStock: materials.currentStock,
      })
      .from(packingMaterials)
      .innerJoin(materials, eq(packingMaterials.materialId, materials.id))
      .where(eq(packingMaterials.userId, userId))
      .orderBy(asc(materials.name));

    return rows.map((r) => ({
      id: r.id,
      materialId: r.materialId,
      name: r.name,
      unit: r.unit,
      defaultQuantity: num(r.defaultQuantity),
      unitCost: num(r.unitCost),
      currentStock: num(r.currentStock),
    }));
  }

  /**
   * The same list resolved for ONE product: its own amount where it has set
   * one, the shared default otherwise. `isOverride` comes back so the page can
   * show which figures this product actually chose, instead of leaving the
   * operator guessing whether a number is theirs or inherited.
   */
  async packingForProduct(userId: string, productId: string) {
    const shared = await this.listPackingMaterials(userId);
    if (!shared.length) return [];

    const overrides = await this.db
      .select()
      .from(productPackingQuantities)
      .where(eq(productPackingQuantities.masterProductId, productId));
    const byPackingId = new Map(overrides.map((o) => [o.packingMaterialId, num(o.quantity)]));

    return shared.map((m) => {
      const override = byPackingId.get(m.id);
      const quantity = override ?? m.defaultQuantity;
      return {
        ...m,
        quantity,
        isOverride: override !== undefined,
        lineCost: quantity * m.unitCost,
      };
    });
  }

  async addPackingMaterial(userId: string, materialId: string, defaultQuantity: number) {
    if (!Number.isFinite(defaultQuantity) || defaultQuantity <= 0) {
      throw new BadRequestException("Jumlah harus lebih dari 0.");
    }
    // Confirm the material belongs to the caller before linking: no RLS policy
    // on packing_materials would catch a foreign materialId, because the row
    // being written is legitimately theirs.
    const [mat] = await this.db
      .select({ id: materials.id })
      .from(materials)
      .where(and(eq(materials.userId, userId), eq(materials.id, materialId)))
      .limit(1);
    if (!mat) throw new NotFoundException("Bahan baku tidak ditemukan.");

    try {
      const [row] = await this.db
        .insert(packingMaterials)
        .values({ userId, materialId, defaultQuantity: defaultQuantity.toFixed(3) })
        .returning();
      return row;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") {
        throw new ConflictException("Bahan ini sudah ada di daftar packing.");
      }
      throw e;
    }
  }

  async updatePackingDefault(userId: string, id: string, defaultQuantity: number) {
    if (!Number.isFinite(defaultQuantity) || defaultQuantity <= 0) {
      throw new BadRequestException("Jumlah harus lebih dari 0.");
    }
    const [row] = await this.db
      .update(packingMaterials)
      .set({ defaultQuantity: defaultQuantity.toFixed(3) })
      .where(and(eq(packingMaterials.userId, userId), eq(packingMaterials.id, id)))
      .returning();
    if (!row) throw new NotFoundException("Bahan packing tidak ditemukan.");
    return row;
  }

  /**
   * Removes it from the packing list. The material stays in the catalogue, and
   * the per-product amounts go with it via ON DELETE CASCADE — leaving those
   * behind would resurrect stale numbers if the same material were re-added.
   */
  async removePackingMaterial(userId: string, id: string) {
    const [row] = await this.db
      .delete(packingMaterials)
      .where(and(eq(packingMaterials.userId, userId), eq(packingMaterials.id, id)))
      .returning();
    if (!row) throw new NotFoundException("Bahan packing tidak ditemukan.");
    return { ok: true as const };
  }

  /** Set what ONE product uses. Pass null to fall back to the shared default. */
  async setProductPackingQuantity(
    userId: string,
    productId: string,
    packingMaterialId: string,
    quantity: number | null,
  ) {
    await this.getProductOrThrow(userId, productId);
    const [pm] = await this.db
      .select({ id: packingMaterials.id })
      .from(packingMaterials)
      .where(and(eq(packingMaterials.userId, userId), eq(packingMaterials.id, packingMaterialId)))
      .limit(1);
    if (!pm) throw new NotFoundException("Bahan packing tidak ditemukan.");

    if (quantity == null) {
      await this.db
        .delete(productPackingQuantities)
        .where(
          and(
            eq(productPackingQuantities.masterProductId, productId),
            eq(productPackingQuantities.packingMaterialId, packingMaterialId),
          ),
        );
      return { ok: true as const, usingDefault: true };
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException("Jumlah harus lebih dari 0.");
    }
    await this.db
      .insert(productPackingQuantities)
      .values({ masterProductId: productId, packingMaterialId, quantity: quantity.toFixed(3) })
      .onConflictDoUpdate({
        target: [
          productPackingQuantities.masterProductId,
          productPackingQuantities.packingMaterialId,
        ],
        set: { quantity: quantity.toFixed(3) },
      });
    return { ok: true as const, usingDefault: false };
  }

  async detail(userId: string, productId: string) {
    const product = await this.getProductOrThrow(userId, productId);
    const cfg = await this.getOrCreateCosting(userId, productId);
    // Left join: the catalogue is the price of record when a line is linked,
    // so raising a material's cost once reaches every product that uses it.
    // Unlinked lines fall back to their own copy — those are pre-catalogue
    // rows, and dropping them to zero would understate HPP without warning.
    const recipe = await this.db
      .select({
        bom: bomItems,
        catalogName: materials.name,
        catalogUnit: materials.unit,
        catalogCost: materials.unitCost,
        catalogStock: materials.currentStock,
      })
      .from(bomItems)
      .leftJoin(materials, eq(bomItems.materialId, materials.id))
      .where(eq(bomItems.masterProductId, productId))
      .orderBy(asc(bomItems.materialName));

    const lines = recipe.map(({ bom: m, catalogName, catalogUnit, catalogCost, catalogStock }) => {
      const linked = m.materialId != null && catalogName != null;
      const unitCost = linked ? num(catalogCost) : num(m.unitCost);
      return {
        id: m.id,
        materialId: m.materialId,
        materialName: linked ? catalogName! : m.materialName,
        unit: linked ? catalogUnit : m.unit,
        quantity: num(m.quantity),
        unitCost,
        lineCost: num(m.quantity) * unitCost,
        currentStock: linked ? num(catalogStock) : null,
        /** False for rows written before the catalogue existed. */
        isLinked: linked,
      };
    });

    const packing = await this.packingForProduct(userId, productId);

    const hpp = calculateHpp({
      materials: lines.map((l) => ({ quantity: l.quantity, unitCost: l.unitCost })),
      serviceCostPerPcs: num(cfg.serviceCostPerPcs),
      packingCostPerOrder: num(cfg.packingCostPerOrder),
      packingMaterials: packing.map((p) => ({ quantity: p.quantity, unitCost: p.unitCost })),
      avgUnitsPerOrder: num(cfg.avgUnitsPerOrder),
    });

    // Same guard the shared calculator uses: a blank or zero average would
    // send the per-unit share to Infinity.
    const unitsPerOrder = num(cfg.avgUnitsPerOrder) > 0 ? num(cfg.avgUnitsPerOrder) : 1;
    const packingMaterialPerUnitCents = Math.round(hpp.packingMaterialCostCents / unitsPerOrder);

    const publishPrice = cfg.publishPrice != null ? num(cfg.publishPrice) : null;
    const pricing =
      publishPrice != null
        ? calculatePublishPricing(this.pricingInput(cfg, publishPrice, hpp.hppCents))
        : null;

    return {
      product: { id: product.id, sku: product.sku, name: product.name },
      materials: lines,
      packingMaterials: packing,
      costing: this.serialiseCosting(cfg),
      hpp: {
        materialCost: rupiah(hpp.materialCostCents),
        serviceCost: rupiah(hpp.serviceCostCents),
        packingCost: rupiah(hpp.packingCostCents),
        // Split so the page can show WHERE the packing cost comes from. The
        // "other" share is derived by subtraction rather than rounded
        // separately, so the two lines always add up to packingCost exactly —
        // a breakdown whose parts do not sum to its total is worse than no
        // breakdown at all.
        packingMaterialCost: rupiah(packingMaterialPerUnitCents),
        packingOtherCost: rupiah(hpp.packingCostCents - packingMaterialPerUnitCents),
        /** Per shipment, before being spread across the units in it. */
        packingMaterialPerOrder: rupiah(hpp.packingMaterialCostCents),
        packingOtherPerOrder: rupiah(hpp.packingPerOrderCents - hpp.packingMaterialCostCents),
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
  /**
   * Adds a recipe line, ALWAYS linked to the shared material catalogue.
   *
   * Previously this wrote a free-text name with its own copy of the price, so
   * the same material entered on two products became two unrelated things —
   * visible in this tenant's own data as "Botol" and "botol", each with their
   * own stock and cost. One material used by several products is the whole
   * point of having a catalogue, so a line can no longer exist outside it:
   * either pick an existing material, or a new one is created and linked.
   */
  async addMaterial(userId: string, productId: string, dto: CreateMaterialDto) {
    await this.getProductOrThrow(userId, productId);

    let material: { id: string; name: string; unit: string | null; unitCost: string };

    if (dto.materialId) {
      const [found] = await this.db
        .select({
          id: materials.id,
          name: materials.name,
          unit: materials.unit,
          unitCost: materials.unitCost,
        })
        .from(materials)
        .where(and(eq(materials.userId, userId), eq(materials.id, dto.materialId)))
        .limit(1);
      if (!found) throw new NotFoundException("Bahan baku tidak ditemukan di master data.");
      material = found;
    } else {
      const name = (dto.materialName ?? "").trim();
      if (!name) throw new BadRequestException("Pilih bahan dari master data atau isi namanya.");
      material = await this.findOrCreateMaterial(userId, name, dto.unit, dto.unitCost);
    }

    // The same material twice in one recipe is an editing slip, never an
    // intent, and would silently double that ingredient's cost.
    const [existing] = await this.db
      .select({ id: bomItems.id })
      .from(bomItems)
      .where(
        and(eq(bomItems.masterProductId, productId), eq(bomItems.materialId, material.id)),
      )
      .limit(1);
    if (existing) {
      throw new ConflictException(
        `"${material.name}" sudah ada di resep produk ini. Ubah takarannya saja.`,
      );
    }

    await this.db.insert(bomItems).values({
      masterProductId: productId,
      materialId: material.id,
      // Kept in step with the catalogue so the legacy columns are not stale if
      // anything still reads them; the catalogue is what HPP actually uses.
      materialName: material.name,
      quantity: dto.quantity.toFixed(3),
      unit: material.unit,
      unitCost: material.unitCost,
    });
    return this.detail(userId, productId);
  }

  /**
   * Finds a catalogue material by normalised name, or creates it.
   *
   * Matching on the normalised name is what stops "Botol" and "botol" becoming
   * two materials — the same collapse the catalogue already uses for its own
   * uniqueness, so a name that would collide is reused rather than rejected.
   */
  private async findOrCreateMaterial(
    userId: string,
    name: string,
    unit?: string,
    unitCost?: number,
  ) {
    const normalized = name.trim().toLowerCase().replace(/\s+/g, " ");
    const [found] = await this.db
      .select({
        id: materials.id,
        name: materials.name,
        unit: materials.unit,
        unitCost: materials.unitCost,
      })
      .from(materials)
      .where(and(eq(materials.userId, userId), eq(materials.normalizedName, normalized)))
      .limit(1);
    if (found) return found;

    const [created] = await this.db
      .insert(materials)
      .values({
        userId,
        name: name.trim(),
        normalizedName: normalized,
        unit: unit?.trim() || null,
        unitCost: (unitCost ?? 0).toFixed(2),
      })
      .returning({
        id: materials.id,
        name: materials.name,
        unit: materials.unit,
        unitCost: materials.unitCost,
      });
    if (!created) throw new Error("Insert materials returned no row");
    return created;
  }

  /**
   * Attaches an old free-text recipe line to the catalogue, reusing a material
   * of the same name or creating one from the line's own figures.
   *
   * Needed because linking only new lines would leave every recipe written
   * before this change orphaned, which is where the duplicates already are.
   */
  async linkMaterialToCatalog(userId: string, bomItemId: string, materialId?: string) {
    const productId = await this.getMaterialProductOrThrow(userId, bomItemId);
    const [row] = await this.db.select().from(bomItems).where(eq(bomItems.id, bomItemId)).limit(1);
    if (!row) throw new NotFoundException("Baris resep tidak ditemukan.");

    let material;
    if (materialId) {
      const [found] = await this.db
        .select({
          id: materials.id,
          name: materials.name,
          unit: materials.unit,
          unitCost: materials.unitCost,
        })
        .from(materials)
        .where(and(eq(materials.userId, userId), eq(materials.id, materialId)))
        .limit(1);
      if (!found) throw new NotFoundException("Bahan baku tidak ditemukan di master data.");
      material = found;
    } else {
      material = await this.findOrCreateMaterial(
        userId,
        row.materialName,
        row.unit ?? undefined,
        num(row.unitCost),
      );
    }

    await this.db
      .update(bomItems)
      .set({
        materialId: material.id,
        materialName: material.name,
        unit: material.unit,
        unitCost: material.unitCost,
      })
      .where(eq(bomItems.id, bomItemId));
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
    // Same catalogue-first pricing as detail(); otherwise the suggested price
    // would be derived from a different HPP than the one on screen.
    const recipeRows = await this.db
      .select({
        quantity: bomItems.quantity,
        ownCost: bomItems.unitCost,
        materialId: bomItems.materialId,
        catalogCost: materials.unitCost,
      })
      .from(bomItems)
      .leftJoin(materials, eq(bomItems.materialId, materials.id))
      .where(eq(bomItems.masterProductId, productId));
    const recipe = recipeRows.map((m) => ({
      quantity: num(m.quantity),
      unitCost: m.materialId != null && m.catalogCost != null ? num(m.catalogCost) : num(m.ownCost),
    }));

    const hpp = calculateHpp({
      materials: recipe,
      serviceCostPerPcs: num(cfg.serviceCostPerPcs),
      packingCostPerOrder: num(cfg.packingCostPerOrder),
      packingMaterials: (await this.packingForProduct(userId, productId)).map((p) => ({
        quantity: p.quantity,
        unitCost: p.unitCost,
      })),
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
