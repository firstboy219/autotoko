import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  bomItems,
  masterProducts,
  materialMovements,
  materialPurchaseItems,
  materialPurchases,
  materials,
  packingMaterials,
} from "../../database/schema/index.js";
import { convertUnit } from "@autotoko/shared";
import { OcrMemoryService } from "../resi/ocr-memory.service.js";
import { UploadsService } from "../uploads/uploads.service.js";
import { OcrService } from "../payout/ocr.service.js";
import type { CreatePurchaseDto, UpdateMaterialDto } from "./dto/materials.dto.js";

const num = (v: string | number | null | undefined) => Number(v ?? 0);

/** Matching key: case- and whitespace-insensitive, mirroring the DB backfill. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

@Injectable()
export class MaterialsService {
  private readonly logger = new Logger(MaterialsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly uploads: UploadsService,
    private readonly ocr: OcrService,
    private readonly memory: OcrMemoryService,
  ) {}

  /* ------------------------------------------------------------ catalog */

  /**
   * `brandId` filters to one business; "none" is its own answer.
   *
   * Unassigned materials are reachable on purpose rather than being swept into
   * whichever brand happens to be selected — a filter that silently hides rows
   * is how a catalogue quietly loses things.
   */
  async list(userId: string, brandId?: string | null) {
    // "none" is a real answer, not the absence of one: unassigned rows have to
    // be reachable, or a catalogue quietly loses whatever nobody categorised.
    const brandWhere =
      brandId === "none"
        ? isNull(materials.shopCategoryId)
        : brandId
          ? eq(materials.shopCategoryId, brandId)
          : undefined;

    const rows = await this.db
      .select()
      .from(materials)
      .where(brandWhere ? and(eq(materials.userId, userId), brandWhere) : eq(materials.userId, userId))
      .orderBy(materials.name);

    // Which products consume each material — the recipe side stays per-product.
    const ids = rows.map((r) => r.id);
    const links = ids.length
      ? await this.db
          .select({ materialId: bomItems.materialId, productId: bomItems.masterProductId })
          .from(bomItems)
          .where(inArray(bomItems.materialId, ids))
      : [];
    const usedBy = new Map<string, number>();
    for (const l of links) {
      if (!l.materialId) continue;
      usedBy.set(l.materialId, (usedBy.get(l.materialId) ?? 0) + 1);
    }

    return rows.map((m) => ({
      id: m.id,
      name: m.name,
      unit: m.unit,
      currentStock: num(m.currentStock),
      unitCost: num(m.unitCost),
      unitCostUpdatedAt: m.unitCostUpdatedAt,
      stockLevel: m.stockLevel,
      stockLevelAt: m.stockLevelAt,
      shopCategoryId: m.shopCategoryId,
      minimumThreshold: num(m.minimumThreshold),
      stockValue: num(m.currentStock) * num(m.unitCost),
      usedByProducts: usedBy.get(m.id) ?? 0,
      isLow: num(m.currentStock) <= num(m.minimumThreshold),
    }));
  }

  /**
   * What would break if this material went away.
   *
   * Asked for before the delete rather than discovered during it, so the page
   * can show the operator what they are about to affect and offer somewhere to
   * move it — a material used by nine products is not something to remove on a
   * single click.
   */
  async materialUsage(userId: string, id: string) {
    await this.getOrThrow(userId, id);

    const recipes = await this.db
      .select({
        bomItemId: bomItems.id,
        productId: masterProducts.id,
        productName: masterProducts.name,
        quantity: bomItems.quantity,
      })
      .from(bomItems)
      .innerJoin(masterProducts, eq(bomItems.masterProductId, masterProducts.id))
      .where(and(eq(masterProducts.userId, userId), eq(bomItems.materialId, id)));

    const [packing] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(packingMaterials)
      .where(and(eq(packingMaterials.userId, userId), eq(packingMaterials.materialId, id)));

    const [purchases] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(materialPurchaseItems)
      .where(
        and(eq(materialPurchaseItems.userId, userId), eq(materialPurchaseItems.materialId, id)),
      );

    return {
      products: recipes.map((r) => ({
        id: r.productId,
        name: r.productName,
        quantity: num(r.quantity),
      })),
      packingLines: packing?.count ?? 0,
      purchaseLines: purchases?.count ?? 0,
      inUse: recipes.length > 0 || (packing?.count ?? 0) > 0,
    };
  }

  /**
   * Deletes a material, optionally moving everything that used it somewhere
   * else first.
   *
   * Without a replacement, bom_items.material_id is ON DELETE SET NULL — the
   * recipe line survives but stops being linked to the catalogue, quietly
   * falling back to its own stale copy of the price. That is a bad default for
   * a delete button, so this refuses when the material is in use and nothing
   * was named to take its place; the page then asks where to move it.
   *
   * Quantities are SUMMED when a product already has the replacement in its
   * recipe. Merging two entries for what turned out to be the same thing
   * should leave that product's total unchanged — dropping one of them would
   * silently reduce its HPP.
   */
  async deleteMaterial(userId: string, id: string, replaceWithId?: string | null) {
    const material = await this.getOrThrow(userId, id);
    const usage = await this.materialUsage(userId, id);

    if (usage.inUse && !replaceWithId) {
      throw new ConflictException({
        code: "IN_USE",
        message:
          `"${material.name}" dipakai ${usage.products.length} produk` +
          (usage.packingLines ? " dan ada di daftar bahan packing" : "") +
          ". Pilih bahan penggantinya.",
        products: usage.products,
        packingLines: usage.packingLines,
        purchaseLines: usage.purchaseLines,
      });
    }

    let moved = { recipes: 0, merged: 0, packing: 0, purchases: 0 };

    if (replaceWithId) {
      if (replaceWithId === id) {
        throw new BadRequestException("Bahan pengganti tidak boleh bahan yang sama.");
      }
      const target = await this.getOrThrow(userId, replaceWithId);

      // --- recipes
      const targetRows = await this.db
        .select({ id: bomItems.id, productId: bomItems.masterProductId, quantity: bomItems.quantity })
        .from(bomItems)
        .innerJoin(masterProducts, eq(bomItems.masterProductId, masterProducts.id))
        .where(and(eq(masterProducts.userId, userId), eq(bomItems.materialId, replaceWithId)));
      const targetByProduct = new Map(targetRows.map((r) => [r.productId, r]));

      const sourceRows = await this.db
        .select({ id: bomItems.id, productId: bomItems.masterProductId, quantity: bomItems.quantity })
        .from(bomItems)
        .innerJoin(masterProducts, eq(bomItems.masterProductId, masterProducts.id))
        .where(and(eq(masterProducts.userId, userId), eq(bomItems.materialId, id)));

      for (const row of sourceRows) {
        const existing = targetByProduct.get(row.productId);
        if (existing) {
          await this.db
            .update(bomItems)
            .set({ quantity: (num(existing.quantity) + num(row.quantity)).toFixed(3) })
            .where(eq(bomItems.id, existing.id));
          await this.db.delete(bomItems).where(eq(bomItems.id, row.id));
          moved.merged += 1;
        } else {
          await this.db
            .update(bomItems)
            .set({
              materialId: replaceWithId,
              materialName: target.name,
              unit: target.unit,
              unitCost: target.unitCost,
            })
            .where(eq(bomItems.id, row.id));
          moved.recipes += 1;
        }
      }

      // --- packing list. unique(user, material), so a collision is a merge.
      const [targetPacking] = await this.db
        .select()
        .from(packingMaterials)
        .where(
          and(
            eq(packingMaterials.userId, userId),
            eq(packingMaterials.materialId, replaceWithId),
          ),
        )
        .limit(1);
      const sourcePacking = await this.db
        .select()
        .from(packingMaterials)
        .where(and(eq(packingMaterials.userId, userId), eq(packingMaterials.materialId, id)));

      for (const p of sourcePacking) {
        if (targetPacking) {
          await this.db
            .update(packingMaterials)
            .set({
              defaultQuantity: (
                num(targetPacking.defaultQuantity) + num(p.defaultQuantity)
              ).toFixed(3),
            })
            .where(eq(packingMaterials.id, targetPacking.id));
          await this.db.delete(packingMaterials).where(eq(packingMaterials.id, p.id));
        } else {
          await this.db
            .update(packingMaterials)
            .set({ materialId: replaceWithId })
            .where(eq(packingMaterials.id, p.id));
        }
        moved.packing += 1;
      }

      // --- purchase history moves too: if these were the same thing all
      // along, what was bought under the old name was bought for the new one.
      const purch = await this.db
        .update(materialPurchaseItems)
        .set({ materialId: replaceWithId })
        .where(
          and(
            eq(materialPurchaseItems.userId, userId),
            eq(materialPurchaseItems.materialId, id),
          ),
        )
        .returning({ id: materialPurchaseItems.id });
      moved.purchases = purch.length;
    }

    await this.db
      .delete(materials)
      .where(and(eq(materials.userId, userId), eq(materials.id, id)));

    this.logger.log(
      `Material ${material.name} deleted by ${userId}` +
        (replaceWithId ? ` (moved ${JSON.stringify(moved)})` : ""),
    );
    return { ok: true as const, name: material.name, moved };
  }

  /**
   * Create a material, or hand back the one that already answers to that name.
   *
   * Find-or-create rather than insert-or-409, matching what the HPP page does.
   * Somebody scanning a shelf has no way to know whether "Lakban" is already in
   * the catalogue, and refusing them with a constraint error would teach them
   * to invent "Lakban 2" — which is exactly the duplicate the unique index
   * exists to prevent.
   */
  async createMaterial(
    userId: string,
    dto: {
      name: string;
      unit?: string;
      unitCost?: number;
      currentStock?: number;
      minimumThreshold?: number;
    },
  ) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException("Nama bahan tidak boleh kosong.");
    const normalized = name.toLowerCase().replace(/\s+/g, " ");

    const [found] = await this.db
      .select()
      .from(materials)
      .where(and(eq(materials.userId, userId), eq(materials.normalizedName, normalized)))
      .limit(1);
    if (found) {
      return { created: false as const, id: found.id, name: found.name, unit: found.unit };
    }

    const [made] = await this.db
      .insert(materials)
      .values({
        userId,
        name,
        normalizedName: normalized,
        unit: dto.unit?.trim() || null,
        unitCost: (dto.unitCost ?? 0).toFixed(2),
        // A price given now IS the moment it was set; without this the BOM page
        // reports "belum pernah diisi" beside a figure just typed in.
        unitCostUpdatedAt: dto.unitCost != null ? new Date() : null,
        currentStock: (dto.currentStock ?? 0).toFixed(3),
        minimumThreshold: (dto.minimumThreshold ?? 0).toFixed(3),
      })
      .returning();
    if (!made) throw new Error("Insert materials returned no row");
    return { created: true as const, id: made.id, name: made.name, unit: made.unit };
  }

  async updateMaterial(userId: string, id: string, dto: UpdateMaterialDto) {
    await this.getOrThrow(userId, id);
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.name != null) {
      set.name = dto.name.trim();
      set.normalizedName = normalizeName(dto.name);
    }
    if (dto.unit !== undefined) set.unit = dto.unit?.trim() || null;
    if (dto.minimumThreshold != null) set.minimumThreshold = dto.minimumThreshold.toFixed(3);
    // Cost and stock ARE settable, having originally been locked here.
    //
    // Both are normally derived — cost from the weighted average of purchases,
    // stock from purchases minus what orders consume — and typing over them
    // does overwrite that derivation until the next purchase recomputes it.
    // But the HPP page already writes unitCost directly when a seller edits a
    // material's price there, so refusing it here left the same field editable
    // in one place and silently ignored in another: the form accepted a new
    // figure, saved without error, and changed nothing. Sellers who do not
    // record every purchase have no other way to state a price, and a stock
    // count has to be enterable somewhere. The page says the next purchase
    // will recompute the average.
    // Stamped so a list of levels can say how old it is. A stock reading
    // nobody has touched for a month is not a stock reading.
    if (dto.stockLevel != null) {
      set.stockLevel = dto.stockLevel;
      set.stockLevelAt = new Date();
    }
    if (dto.unitCost != null) {
      set.unitCost = dto.unitCost.toFixed(2);
      set.unitCostUpdatedAt = new Date();
    }
    if (dto.currentStock != null) set.currentStock = dto.currentStock.toFixed(3);
    // undefined leaves it alone; an explicit null clears the assignment. The
    // same distinction a label PATCH once got wrong, emptying every column the
    // form had not sent.
    if (dto.shopCategoryId !== undefined) set.shopCategoryId = dto.shopCategoryId || null;
    await this.db.update(materials).set(set).where(eq(materials.id, id));
    return this.list(userId);
  }

  /* ------------------------------------------------------------- OCR */

  /**
   * Best-effort parse of a purchase receipt screenshot into line items.
   *
   * OCR of a table is unreliable by nature, so this NEVER writes anything — it
   * only proposes rows for the admin to correct and confirm. Each candidate is
   * matched against the existing catalog so the UI can show "top up" vs "new".
   */
  /**
   * Store an order screenshot and read it, in one call.
   *
   * The phone has the image and no url; parseReceipt needs a url. Doing both
   * here saves a round trip in front of a packer holding a box, and means the
   * screenshot is already stored when the reading comes back — so a parse the
   * operator disagrees with still leaves the evidence behind.
   */
  async scanOrderPhoto(userId: string, photoBase64: string) {
    const { url } = await this.uploads.saveImage(photoBase64, "jpg");
    try {
      const parsed = await this.parseReceipt(userId, url);
      return { url, ...parsed };
    } catch (e) {
      // A failed read is not a failed upload. The screenshot is the record
      // that matters; the numbers can be typed.
      this.logger.warn(`Foto pesanan tidak terbaca: ${(e as Error).message}`);
      return { url, raw: "", items: [] as unknown[] };
    }
  }

  async parseReceipt(userId: string, imageUrl: string) {
    const text = await this.ocr.readText(imageUrl);
    const lines = parsePurchaseLines(text);

    const existing = await this.db
      .select({ id: materials.id, name: materials.name, normalizedName: materials.normalizedName, unit: materials.unit })
      .from(materials)
      .where(eq(materials.userId, userId));
    const byName = new Map(existing.map((m) => [m.normalizedName, m]));

    return {
      raw: text,
      items: lines.map((l) => {
        const match = byName.get(normalizeName(l.name));
        return {
          materialName: l.name,
          quantity: l.quantity,
          unit: l.unit ?? match?.unit ?? null,
          totalCost: l.totalCost,
          matchedMaterialId: match?.id ?? null,
          matchedMaterialName: match?.name ?? null,
        };
      }),
    };
  }

  /* --------------------------------------------------------- purchases */

  /**
   * Commits a purchase: tops up stock and recomputes the weighted-average unit
   * cost for every line, creating materials that do not exist yet.
   *
   * Weighted average (not "latest price") because HPP should reflect what the
   * stock actually on hand cost — buying 1 unit at a spike price should not
   * reprice 500 units already in the warehouse.
   */
  /**
   * Add stock to one material, and move its average cost only if a cost was given.
   *
   * The cost guard is the whole reason this is shared. Stock coming in from a
   * delivery report carries no price, and running it through the averaging
   * formula as zero would pull the material's unit cost toward nothing — which
   * is not a visible error anywhere, it just quietly understates the HPP of
   * every product built from it.
   */
  private async applyStockIn(
    userId: string,
    materialId: string,
    qty: number,
    lineTotal: number | null,
    /** The purchase line this came from, so deleting it can give it back. */
    refId: string | null = null,
    reason: string = "purchase",
  ): Promise<void> {
    const [current] = await this.db
      .select({ stock: materials.currentStock, cost: materials.unitCost })
      .from(materials)
      .where(and(eq(materials.id, materialId), eq(materials.userId, userId)))
      .limit(1);
    if (!current) return;

    const oldStock = num(current.stock);
    const oldCost = num(current.cost);
    const newStock = oldStock + qty;

    const set: Record<string, unknown> = { currentStock: newStock.toFixed(3) };

    if (lineTotal != null) {
      const lineUnitCost = qty > 0 ? lineTotal / qty : 0;
      // Guard the divide: nothing to average against means the price paid
      // simply becomes the cost.
      const newCost =
        newStock > 0 && oldStock > 0
          ? (oldStock * oldCost + qty * lineUnitCost) / newStock
          : lineUnitCost;
      set.unitCost = newCost.toFixed(2);
      set.unitCostUpdatedAt = new Date();
    }
    set.updatedAt = new Date();

    await this.db.update(materials).set(set).where(eq(materials.id, materialId));

    // The total and the row that explains it, always together. A total nobody
    // can account for is the thing that makes a stocktake unarguable-with.
    if (refId) {
      await this.db.insert(materialMovements).values({
        userId,
        materialId,
        quantity: qty.toFixed(3),
        reason,
        refTable: "material_purchase_items",
        refId,
        note: lineTotal != null ? `Harga baris Rp ${lineTotal}` : "Tanpa harga",
      });
    }
  }

  /**
   * Give back everything a purchase ever put on the shelf.
   *
   * Compensating rows rather than deleted ones: the ledger is what explains
   * the running total, and one that can lose entries explains nothing.
   *
   * The weighted-average cost is recomputed from the purchases that remain
   * rather than reversed. An average cannot be unwound from its result — and
   * leaving it alone would keep costing every product from a receipt the
   * seller has just said was wrong.
   */
  private async reversePurchaseStock(userId: string, purchaseId: string) {
    const items = await this.db
      .select({ id: materialPurchaseItems.id, materialId: materialPurchaseItems.materialId })
      .from(materialPurchaseItems)
      .where(
        and(
          eq(materialPurchaseItems.purchaseId, purchaseId),
          eq(materialPurchaseItems.userId, userId),
        ),
      );
    if (!items.length) return;

    const touched = new Set<string>();
    for (const item of items) {
      const [prior] = await this.db
        .select({ net: sql<string>`coalesce(sum(${materialMovements.quantity}), 0)` })
        .from(materialMovements)
        .where(
          and(
            eq(materialMovements.userId, userId),
            eq(materialMovements.refTable, "material_purchase_items"),
            eq(materialMovements.refId, item.id),
          ),
        );
      const net = num(prior?.net ?? "0");
      touched.add(item.materialId);
      if (net === 0) continue;

      await this.db.insert(materialMovements).values({
        userId,
        materialId: item.materialId,
        quantity: (-net).toFixed(3),
        reason: "reversal",
        refTable: "material_purchase_items",
        refId: item.id,
        note: "Pembelian dihapus atau diubah",
      });
      await this.db
        .update(materials)
        .set({
          currentStock: sql`${materials.currentStock} - ${net.toFixed(3)}`,
          updatedAt: new Date(),
        })
        .where(and(eq(materials.id, item.materialId), eq(materials.userId, userId)));
    }

    for (const materialId of touched) {
      await this.recomputeUnitCost(userId, materialId, purchaseId);
    }
  }

  /**
   * The average price of what is on the shelf, from the receipts that remain.
   *
   * `excludePurchaseId` is the one being deleted or rewritten: its rows are
   * still in the table at this point and must not be counted.
   */
  private async recomputeUnitCost(userId: string, materialId: string, excludePurchaseId?: string) {
    const [agg] = await this.db
      .select({
        qty: sql<string>`coalesce(sum(${materialPurchaseItems.quantity}), 0)`,
        cost: sql<string>`coalesce(sum(${materialPurchaseItems.totalCost}), 0)`,
      })
      .from(materialPurchaseItems)
      .where(
        and(
          eq(materialPurchaseItems.userId, userId),
          eq(materialPurchaseItems.materialId, materialId),
          isNotNull(materialPurchaseItems.totalCost),
          excludePurchaseId
            ? ne(materialPurchaseItems.purchaseId, excludePurchaseId)
            : sql`true`,
        ),
      );

    const qty = num(agg?.qty ?? "0");
    const cost = num(agg?.cost ?? "0");
    // No priced purchase left to average. Leaving the last known cost standing
    // beats writing zero, which would silently price every product at nothing.
    if (qty <= 0 || cost <= 0) return;

    await this.db
      .update(materials)
      .set({ unitCost: (cost / qty).toFixed(2), unitCostUpdatedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(materials.id, materialId), eq(materials.userId, userId)));
  }

  /**
   * Remove a purchase and everything it did.
   *
   * The packer scans the wrong parcel, or scans the right one twice. Until now
   * the only fix was somebody editing stock by hand to a number they worked
   * out themselves, which is how a shelf and its record stop matching.
   */
  async deletePurchase(userId: string, id: string) {
    const [p] = await this.db
      .select()
      .from(materialPurchases)
      .where(and(eq(materialPurchases.id, id), eq(materialPurchases.userId, userId)))
      .limit(1);
    if (!p) throw new NotFoundException("Pembelian tidak ditemukan");

    await this.reversePurchaseStock(userId, id);
    await this.db.delete(materialPurchases).where(eq(materialPurchases.id, id));

    this.logger.log(`Purchase ${id} deleted and stock reversed for user ${userId}`);
    return { deleted: id, resi: p.resi };
  }

  /**
   * Correct a purchase after the fact.
   *
   * Everything it did is undone first and the new version applied from
   * scratch, rather than the difference being worked out. A diff has to be
   * right about the previous state; a reversal only has to be right about what
   * is written down.
   */
  async updatePurchase(
    userId: string,
    id: string,
    dto: {
      purchasedAt?: string;
      supplierName?: string | null;
      note?: string | null;
      isCod?: boolean;
      codAmount?: number | null;
      /** Attached or replaced from the web, for a parcel the phone sent bare. */
      orderPhotoUrl?: string | null;
      items?: {
        materialId: string;
        qtyPcs?: number;
        contentPerPcs?: number;
        contentUnit?: string;
        totalCost?: number;
      }[];
    },
  ) {
    const [p] = await this.db
      .select()
      .from(materialPurchases)
      .where(and(eq(materialPurchases.id, id), eq(materialPurchases.userId, userId)))
      .limit(1);
    if (!p) throw new NotFoundException("Pembelian tidak ditemukan");

    const header: Record<string, unknown> = {};
    // undefined means "not sent". Only an explicit null or empty string clears
    // a field -- the same distinction a PATCH of the label fields once got
    // wrong, emptying every column the form had not included.
    if (dto.purchasedAt !== undefined) header.purchasedAt = dto.purchasedAt;
    if (dto.supplierName !== undefined) header.supplierName = dto.supplierName?.trim() || null;
    if (dto.note !== undefined) header.note = dto.note?.trim() || null;
    if (dto.isCod !== undefined) header.isCod = dto.isCod;
    if (dto.codAmount !== undefined) {
      header.codAmount = dto.codAmount != null ? dto.codAmount.toFixed(2) : null;
    }
    if (dto.orderPhotoUrl !== undefined) {
      header.orderPhotoUrl = dto.orderPhotoUrl || null;
    }
    if (Object.keys(header).length) {
      await this.db.update(materialPurchases).set(header).where(eq(materialPurchases.id, id));
    }

    if (dto.items) {
      await this.reversePurchaseStock(userId, id);
      await this.db
        .delete(materialPurchaseItems)
        .where(eq(materialPurchaseItems.purchaseId, id));

      const owned = await this.db
        .select({ id: materials.id, unit: materials.unit, name: materials.name })
        .from(materials)
        .where(
          and(
            eq(materials.userId, userId),
            inArray(materials.id, dto.items.map((i) => i.materialId)),
          ),
        );
      const ownedById = new Map(owned.map((m) => [m.id, m]));

      let grandTotal = 0;
      for (const i of dto.items) {
        const material = ownedById.get(i.materialId);
        if (!material) continue;
        const pcs = Number(i.qtyPcs ?? 1);
        if (!Number.isFinite(pcs) || pcs <= 0) continue;
        const entered = Number.isFinite(Number(i.contentPerPcs)) && Number(i.contentPerPcs) > 0
          ? Number(i.contentPerPcs)
          : 1;
        const enteredUnit = i.contentUnit?.trim() || null;
        const content = convertUnit(entered, enteredUnit ?? material.unit, material.unit);
        if (content === null) {
          throw new BadRequestException(
            `${material.name}: "${enteredUnit}" tidak bisa dikonversi ke "${material.unit}"`,
          );
        }
        const qty = pcs * content;
        const cost = i.totalCost != null && Number.isFinite(Number(i.totalCost))
          ? Number(i.totalCost)
          : null;
        if (cost != null) grandTotal += cost;

        const [row] = await this.db
          .insert(materialPurchaseItems)
          .values({
            purchaseId: id,
            userId,
            materialId: material.id,
            quantity: qty.toFixed(3),
            qtyPcs: pcs.toFixed(3),
            contentPerPcs: content.toFixed(3),
            enteredContent: entered.toFixed(3),
            enteredUnit: enteredUnit ?? material.unit ?? null,
            totalCost: cost != null ? cost.toFixed(2) : null,
            unitCost: cost != null && qty > 0 ? (cost / qty).toFixed(2) : null,
            createdMaterial: false,
          })
          .returning();

        await this.applyStockIn(userId, material.id, qty, cost, row!.id, p.source === "delivery_scan" ? "delivery" : "purchase");
      }

      await this.db
        .update(materialPurchases)
        .set({ totalCost: grandTotal.toFixed(2) })
        .where(eq(materialPurchases.id, id));
    }

    this.logger.log(`Purchase ${id} updated for user ${userId}`);
    return this.getPurchase(userId, id);
  }

  /**
   * A parcel of raw materials arriving at the packing room.
   *
   * Deliberately the same record as a purchase — stock arriving against a
   * document — so there is one way stock goes up rather than two that drift.
   * What it does not have is prices, and the line below leaves the averages
   * alone rather than guessing at them.
   */
  async recordDelivery(
    userId: string,
    dto: {
      resi: string;
      photoBase64?: string;
      deviceText?: string;
      note?: string;
      isCod?: boolean;
      codAmount?: number;
      /**
       * What the parcel cost, for the far commoner case of a bill already
       * paid. COD was the only way to record a price, so every transfer-paid
       * delivery arrived priceless and dragged nothing into the HPP.
       */
      totalCost?: number;
      /** The marketplace order detail this was ordered from. */
      orderPhotoUrl?: string;
      items: {
        materialId: string;
        rawName?: string;
        qtyPcs: number;
        /** Optional: blank means one unit per package, handled below. */
        contentPerPcs?: number;
        /** Unit of the line above; blank means the catalogue's own. */
        contentUnit?: string;
        totalCost?: number;
      }[];
    },
  ) {
    const resi = (dto.resi ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (resi.length < 6) {
      throw new BadRequestException({
        code: "INVALID",
        message: "Nomor resi terlalu pendek.",
      });
    }

    // Read before writing. The unique index is the real guard — two phones can
    // scan the same parcel at once — but a request inside one transaction can
    // no longer read anything after a constraint violation aborts it, so the
    // details of the earlier report have to be fetched first or not at all.
    const [existing] = await this.db
      .select()
      .from(materialPurchases)
      .where(and(eq(materialPurchases.userId, userId), eq(materialPurchases.resi, resi)))
      .limit(1);
    if (existing) {
      throw new ConflictException({
        code: "DUPLICATE",
        message: "Resi ini sudah pernah dilaporkan.",
        resi,
        firstReportedAt: existing.createdAt,
      });
    }

    const wanted = dto.items.filter((i) => i.materialId);
    if (!wanted.length) throw new BadRequestException("Belum ada bahan yang dipetakan.");

    // Only this tenant's materials, checked in one query rather than per line:
    // a stale id from a phone that synced yesterday must not touch somebody
    // else's stock, and must not cost the whole report either.
    const owned = await this.db
      .select({ id: materials.id, unit: materials.unit, name: materials.name })
      .from(materials)
      .where(
        and(
          eq(materials.userId, userId),
          inArray(materials.id, wanted.map((i) => i.materialId)),
        ),
      );
    const ownedById = new Map(owned.map((m) => [m.id, m]));

    // Stored before the report exists, so a row never claims a photo it has
    // not got. A failed upload must not sink the report either: the stock
    // really did arrive, and that is the part worth keeping.
    let receiptUrl: string | null = null;
    if (dto.photoBase64) {
      try {
        receiptUrl = (await this.uploads.saveImage(dto.photoBase64, "jpg")).url;
      } catch (e) {
        this.logger.warn(`Delivery photo for ${resi} not stored: ${(e as Error).message}`);
      }
    }

    const [purchase] = await this.db
      .insert(materialPurchases)
      .values({
        userId,
        purchasedAt: new Date().toISOString().slice(0, 10),
        note: dto.note?.trim() || null,
        receiptUrl,
        ocrRawResult: dto.deviceText ? { deviceText: dto.deviceText.slice(0, 20_000) } : null,
        resi,
        source: "delivery_scan",
        isCod: dto.isCod === true,
        codAmount: dto.codAmount != null ? dto.codAmount.toFixed(2) : null,
        orderPhotoUrl: dto.orderPhotoUrl ?? null,
        // An explicit total wins over the COD amount: on a COD parcel they are
        // the same figure, and on a paid one only the total exists.
        totalCost:
          dto.totalCost != null
            ? dto.totalCost.toFixed(2)
            : dto.codAmount != null
              ? dto.codAmount.toFixed(2)
              : "0",
      })
      .returning();

    const lines: (typeof materialPurchaseItems.$inferInsert)[] = [];
    const applied: { name: string; qty: number; unit: string | null }[] = [];
    /** Lines whose unit could not be converted; reported, never guessed at. */
    const rejected: string[] = [];
    let grandTotal = 0;

    for (const i of wanted) {
      const material = ownedById.get(i.materialId);
      if (!material) continue;
      const pcs = Number(i.qtyPcs);
      const per = Number(i.contentPerPcs);
      if (!Number.isFinite(pcs) || pcs <= 0) continue;
      // A blank content box means one unit per package, which is what "pcs"
      // materials always are; treating it as zero would add nothing at all.
      const entered = Number.isFinite(per) && per > 0 ? per : 1;

      // The package is labelled in whatever the supplier uses; the shelf is
      // counted in whatever a recipe consumes. Converting here rather than in
      // the packer's head is the whole point of asking for the unit.
      const enteredUnit = i.contentUnit?.trim() || null;
      const content = convertUnit(entered, enteredUnit ?? material.unit, material.unit);
      if (content === null) {
        // Mass into volume needs a density nobody recorded. Refusing one line
        // and naming it beats crediting the shelf with a number that is not
        // the quantity of anything.
        rejected.push(
          `${material.name}: "${enteredUnit}" tidak bisa dikonversi ke "${material.unit}"`,
        );
        continue;
      }
      const qty = pcs * content;

      // A COD parcel holding ONE material tells us exactly what that material
      // cost, and the weighted average should learn from it. Two or more and
      // the amount belongs to the parcel, not to any one of them — see the
      // note on codAmount. Guessing a split there would be worse than not
      // knowing, because nothing downstream would ever show it was a guess.
      // The parcel's price reaches a line only when the parcel holds one
      // material, where it is exact rather than apportioned. Same rule as
      // before; it just no longer depends on the payment being COD.
      const parcelTotal = dto.totalCost ?? dto.codAmount ?? null;
      const soleLineCost = wanted.length === 1 && parcelTotal != null ? parcelTotal : null;

      const cost = i.totalCost != null && Number.isFinite(Number(i.totalCost))
        ? Number(i.totalCost)
        : soleLineCost;
      if (cost != null) grandTotal += cost;

      lines.push({
        purchaseId: purchase!.id,
        userId,
        materialId: material.id,
        rawName: i.rawName?.slice(0, 255) ?? null,
        quantity: qty.toFixed(3),
        qtyPcs: pcs.toFixed(3),
        contentPerPcs: content.toFixed(3),
        enteredContent: entered.toFixed(3),
        enteredUnit: enteredUnit ?? material.unit ?? null,
        totalCost: cost != null ? cost.toFixed(2) : null,
        unitCost: cost != null && qty > 0 ? (cost / qty).toFixed(2) : null,
        createdMaterial: false,
      });
      // Stock is applied after the rows exist, below: a movement has to name
      // the line it came from or deleting the parcel cannot give it back.
      applied.push({ name: material.name, qty, unit: material.unit });
    }

    if (!lines.length) {
      // Nothing survived validation — every line pointed at a material this
      // tenant does not own, or none could be converted. Leave no empty report
      // behind, and say which it was.
      await this.db.delete(materialPurchases).where(eq(materialPurchases.id, purchase!.id));
      throw new BadRequestException(
        rejected.length
          ? `Satuan tidak cocok: ${rejected.join("; ")}`
          : "Tidak ada bahan yang bisa dicatat dari laporan ini.",
      );
    }

    const written = await this.db.insert(materialPurchaseItems).values(lines).returning();
    // What the supplier's resi said, beside the material the packer chose.
    // Kept per line: a supplier's wording repeats across their deliveries.
    for (const row of written) {
      if (row.rawName) {
        await this.memory.remember(userId, "material", row.rawName, { id: row.materialId });
      }
    }
    for (const row of written) {
      await this.applyStockIn(
        userId,
        row.materialId,
        num(row.quantity),
        row.totalCost != null ? num(row.totalCost) : null,
        row.id,
        "delivery",
      );
    }
    if (grandTotal > 0) {
      await this.db
        .update(materialPurchases)
        .set({ totalCost: grandTotal.toFixed(2) })
        .where(eq(materialPurchases.id, purchase!.id));
    }

    this.logger.log(
      `Delivery ${resi} recorded: ${lines.length} material(s)` +
        `${dto.isCod ? `, COD ${dto.codAmount ?? 0}` : ""} for user ${userId}`,
    );
    return {
      id: purchase!.id,
      resi,
      items: applied,
      isCod: dto.isCod === true,
      codAmount: dto.codAmount ?? null,
      /** Named so the phone can show what did NOT go in, not just what did. */
      rejected,
      /** True when the COD amount became a real unit cost rather than just a total. */
      costApplied: wanted.length === 1 && dto.codAmount != null,
    };
  }

  async createPurchase(userId: string, dto: CreatePurchaseDto) {
    const [purchase] = await this.db
      .insert(materialPurchases)
      .values({
        userId,
        purchasedAt: dto.purchasedAt,
        supplierName: dto.supplierName?.trim() || null,
        note: dto.note?.trim() || null,
        receiptUrl: dto.receiptUrl || null,
        ocrRawResult: dto.ocrRaw ?? null,
        totalCost: "0",
      })
      .returning();

    let grandTotal = 0;

    for (const line of dto.items) {
      const qty = Number(line.quantity);
      const lineTotal = Number(line.totalCost) || 0;
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const lineUnitCost = lineTotal / qty;

      let materialId = line.materialId ?? null;
      let created = false;

      if (!materialId) {
        // Match by normalized name before creating, so a slightly different
        // spelling from OCR doesn't fork the catalog.
        const normalized = normalizeName(line.materialName ?? "");
        if (!normalized) continue;
        const [found] = await this.db
          .select({ id: materials.id })
          .from(materials)
          .where(and(eq(materials.userId, userId), eq(materials.normalizedName, normalized)))
          .limit(1);
        if (found) {
          materialId = found.id;
        } else {
          const [made] = await this.db
            .insert(materials)
            .values({
              userId,
              name: (line.materialName ?? "").trim(),
              normalizedName: normalized,
              unit: line.unit?.trim() || null,
              currentStock: "0",
              unitCost: "0",
            })
            .returning({ id: materials.id });
          materialId = made!.id;
          created = true;
        }
      }

      const [current] = await this.db
        .select({ stock: materials.currentStock, cost: materials.unitCost })
        .from(materials)
        .where(and(eq(materials.id, materialId!), eq(materials.userId, userId)))
        .limit(1);
      if (!current) continue;

      const oldStock = num(current.stock);
      const oldCost = num(current.cost);
      const newStock = oldStock + qty;
      // Guard the divide: a zero/negative prior stock means there is nothing to
      // average against, so the purchase price simply becomes the cost.
      const newCost =
        newStock > 0 && oldStock > 0
          ? (oldStock * oldCost + qty * lineUnitCost) / newStock
          : lineUnitCost;

      await this.db
        .update(materials)
        .set({
          currentStock: newStock.toFixed(3),
          unitCost: newCost.toFixed(2),
          // A purchase is the commonest way a price moves, so it stamps the
          // date too — otherwise the BOM page would show a months-old date
          // beside a figure that changed this morning.
          unitCostUpdatedAt: new Date(),
          ...(line.unit?.trim() ? { unit: line.unit.trim() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(materials.id, materialId!));

      const [lineRow] = await this.db
        .insert(materialPurchaseItems)
        .values({
          purchaseId: purchase!.id,
          userId,
          materialId: materialId!,
          quantity: qty.toFixed(3),
          totalCost: lineTotal.toFixed(2),
          unitCost: lineUnitCost.toFixed(2),
          createdMaterial: created,
        })
        .returning();

      // The stock change above was written straight to the total. Record it
      // here so this purchase can be deleted like any other.
      await this.db.insert(materialMovements).values({
        userId,
        materialId: materialId!,
        quantity: qty.toFixed(3),
        reason: "purchase",
        refTable: "material_purchase_items",
        refId: lineRow!.id,
        note: `Harga baris Rp ${lineTotal}`,
      });

      grandTotal += lineTotal;
    }

    await this.db
      .update(materialPurchases)
      .set({ totalCost: grandTotal.toFixed(2) })
      .where(eq(materialPurchases.id, purchase!.id));

    this.logger.log(`Purchase ${purchase!.id} recorded for user ${userId} (${dto.items.length} lines)`);
    return this.getPurchase(userId, purchase!.id);
  }

  /**
   * Whether today's stock check has been done, and what is still outstanding.
   *
   * Answered here rather than on the phone because the shelf is shared: the
   * packer asking may not be the person who already did it this morning, and a
   * reminder that fires anyway is one people learn to swipe away.
   *
   * "Today" is the seller's day, not the server's. The server runs in UTC and
   * Jakarta is seven hours ahead, so a naive comparison would treat everything
   * done before 07:00 local as yesterday's work — every morning.
   */
  async stockFreshness(userId: string, timeZone = "Asia/Jakarta") {
    const rows = await this.db
      .select({
        id: materials.id,
        name: materials.name,
        stockLevel: materials.stockLevel,
        stockLevelAt: materials.stockLevelAt,
      })
      .from(materials)
      .where(eq(materials.userId, userId));

    /** The calendar date in the seller's zone, as YYYY-MM-DD. */
    const dayIn = (d: Date) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d);

    const today = dayIn(new Date());
    let updatedToday = 0;
    let newest: Date | null = null;
    const stale: { id: string; name: string; lastAt: Date | null }[] = [];

    for (const r of rows) {
      const at = r.stockLevelAt ? new Date(r.stockLevelAt) : null;
      if (at && (!newest || at > newest)) newest = at;
      if (at && dayIn(at) === today) updatedToday++;
      else stale.push({ id: r.id, name: r.name, lastAt: at });
    }

    // Oldest first: the material nobody has looked at for longest is the one
    // worth naming in a one-line notification.
    stale.sort((a, b) => {
      if (!a.lastAt) return -1;
      if (!b.lastAt) return 1;
      return a.lastAt.getTime() - b.lastAt.getTime();
    });

    return {
      total: rows.length,
      updatedToday,
      staleCount: stale.length,
      /** Named so a notification can say what, not just how many. */
      oldest: stale[0] ? { name: stale[0].name, lastAt: stale[0].lastAt } : null,
      lastUpdatedAt: newest,
      /**
       * False when there is nothing to chase — no materials at all, or every
       * one already seen today. A reminder that fires on a finished day is how
       * a reminder stops being read.
       */
      due: rows.length > 0 && stale.length > 0,
      today,
    };
  }

  /**
   * Every movement of one material, newest first, with a running balance.
   *
   * The balance is computed forwards from the oldest row and attached to each,
   * so a reader can point at any line and say what the shelf held immediately
   * after it. Working backwards from the current total would give the same
   * numbers and would also quietly hide a disagreement between the total and
   * the ledger, which is the one thing this page exists to expose.
   */
  async listMovements(userId: string, materialId: string, limit = 200) {
    const [material] = await this.db
      .select({
        id: materials.id,
        name: materials.name,
        unit: materials.unit,
        currentStock: materials.currentStock,
      })
      .from(materials)
      .where(and(eq(materials.id, materialId), eq(materials.userId, userId)))
      .limit(1);
    if (!material) throw new NotFoundException("Bahan baku tidak ditemukan");

    const rows = await this.db
      .select({
        id: materialMovements.id,
        quantity: materialMovements.quantity,
        reason: materialMovements.reason,
        refTable: materialMovements.refTable,
        refId: materialMovements.refId,
        note: materialMovements.note,
        createdAt: materialMovements.createdAt,
      })
      .from(materialMovements)
      .where(
        and(
          eq(materialMovements.userId, userId),
          eq(materialMovements.materialId, materialId),
        ),
      )
      .orderBy(asc(materialMovements.createdAt))
      .limit(limit);

    let running = 0;
    const withBalance = rows.map((r) => {
      const qty = num(r.quantity);
      running += qty;
      return {
        ...r,
        quantity: qty,
        balance: running,
        /**
         * Only what a person entered by hand can be changed by hand.
         *
         * A delivery's movement is the arithmetic of a purchase line; editing
         * it here would leave the two saying different things with no way to
         * tell which was meant. Correct those on the purchase itself, where
         * the reversal is done properly.
         */
        editable: r.reason === "adjustment",
      };
    });

    const ledgerTotal = running;
    const total = num(material.currentStock);

    return {
      material: { ...material, currentStock: total },
      /**
       * True when the running total and the ledger disagree.
       *
       * Should never happen. Surfaced rather than reconciled silently, because
       * the difference is evidence of a bug and papering over it would destroy
       * the only trace of one.
       */
      outOfSync: Math.abs(ledgerTotal - total) > 0.0005,
      ledgerTotal,
      movements: withBalance.reverse(),
    };
  }

  /**
   * A stock change somebody entered themselves.
   *
   * A stocktake finds more or less than the books say; a bottle is dropped;
   * something is taken for a sample. None of these has a document behind it,
   * and until now the only way to record one was to overwrite the stock figure
   * — which changes the number and destroys the reason.
   */
  async addMovement(
    userId: string,
    materialId: string,
    dto: { quantity: number; note?: string },
  ) {
    const [material] = await this.db
      .select({ id: materials.id })
      .from(materials)
      .where(and(eq(materials.id, materialId), eq(materials.userId, userId)))
      .limit(1);
    if (!material) throw new NotFoundException("Bahan baku tidak ditemukan");

    const qty = Number(dto.quantity);
    if (!Number.isFinite(qty) || qty === 0) {
      throw new BadRequestException("Jumlah harus diisi dan tidak boleh nol.");
    }

    const [row] = await this.db
      .insert(materialMovements)
      .values({
        userId,
        materialId,
        quantity: qty.toFixed(3),
        reason: "adjustment",
        refTable: null,
        refId: null,
        note: dto.note?.trim().slice(0, 500) || null,
      })
      .returning();

    await this.db
      .update(materials)
      .set({
        currentStock: sql`${materials.currentStock} + ${qty.toFixed(3)}`,
        updatedAt: new Date(),
      })
      .where(and(eq(materials.id, materialId), eq(materials.userId, userId)));

    this.logger.log(`Manual stock movement ${qty} on ${materialId} by ${userId}`);
    return row;
  }

  /**
   * Correct a hand-entered movement.
   *
   * The running total moves by the difference rather than being recomputed,
   * so a correction cannot silently discard a movement written between the
   * read and the write.
   */
  async updateMovement(
    userId: string,
    movementId: string,
    dto: { quantity?: number; note?: string },
  ) {
    const [row] = await this.db
      .select()
      .from(materialMovements)
      .where(
        and(eq(materialMovements.id, movementId), eq(materialMovements.userId, userId)),
      )
      .limit(1);
    if (!row) throw new NotFoundException("Mutasi tidak ditemukan");
    if (row.reason !== "adjustment") {
      throw new BadRequestException(
        "Mutasi ini berasal dari pembelian atau scan resi. Ubah di dokumen asalnya " +
          "supaya keduanya tetap sama.",
      );
    }

    const set: Record<string, unknown> = {};
    let delta = 0;
    if (dto.quantity !== undefined) {
      const qty = Number(dto.quantity);
      if (!Number.isFinite(qty) || qty === 0) {
        throw new BadRequestException("Jumlah harus diisi dan tidak boleh nol.");
      }
      delta = qty - num(row.quantity);
      set.quantity = qty.toFixed(3);
    }
    if (dto.note !== undefined) set.note = dto.note?.trim().slice(0, 500) || null;
    if (!Object.keys(set).length) throw new BadRequestException("Tidak ada perubahan.");

    await this.db
      .update(materialMovements)
      .set(set)
      .where(eq(materialMovements.id, movementId));

    if (delta !== 0) {
      await this.db
        .update(materials)
        .set({
          currentStock: sql`${materials.currentStock} + ${delta.toFixed(3)}`,
          updatedAt: new Date(),
        })
        .where(and(eq(materials.id, row.materialId), eq(materials.userId, userId)));
    }
    return { ok: true as const };
  }

  /** Remove a hand-entered movement and take its effect off the shelf. */
  async deleteMovement(userId: string, movementId: string) {
    const [row] = await this.db
      .select()
      .from(materialMovements)
      .where(
        and(eq(materialMovements.id, movementId), eq(materialMovements.userId, userId)),
      )
      .limit(1);
    if (!row) throw new NotFoundException("Mutasi tidak ditemukan");
    if (row.reason !== "adjustment") {
      throw new BadRequestException(
        "Mutasi ini berasal dari pembelian atau scan resi dan tidak bisa dihapus di sini.",
      );
    }

    await this.db.delete(materialMovements).where(eq(materialMovements.id, movementId));
    await this.db
      .update(materials)
      .set({
        currentStock: sql`${materials.currentStock} - ${num(row.quantity).toFixed(3)}`,
        updatedAt: new Date(),
      })
      .where(and(eq(materials.id, row.materialId), eq(materials.userId, userId)));

    return { deleted: movementId };
  }

  async listPurchases(userId: string) {
    const rows = await this.db
      .select()
      .from(materialPurchases)
      .where(eq(materialPurchases.userId, userId))
      .orderBy(desc(materialPurchases.purchasedAt), desc(materialPurchases.createdAt))
      .limit(100);

    const ids = rows.map((r) => r.id);
    const counts = ids.length
      ? await this.db
          .select({
            purchaseId: materialPurchaseItems.purchaseId,
            n: sql<number>`count(*)::int`,
            // What the seller counted off the trolley, summed. Shown beside
            // the converted total so the row can be checked against a parcel
            // without opening it.
            pcs: sql<string>`coalesce(sum(${materialPurchaseItems.qtyPcs}), 0)`,
          })
          .from(materialPurchaseItems)
          .where(inArray(materialPurchaseItems.purchaseId, ids))
          .groupBy(materialPurchaseItems.purchaseId)
      : [];
    const byId = new Map(counts.map((c) => [c.purchaseId, Number(c.n)]));
    const pcsById = new Map(counts.map((c) => [c.purchaseId, num(c.pcs)]));

    return rows.map((p) => ({
      id: p.id,
      purchasedAt: p.purchasedAt,
      supplierName: p.supplierName,
      note: p.note,
      receiptUrl: p.receiptUrl,
      totalCost: num(p.totalCost),
      itemCount: byId.get(p.id) ?? 0,
      /** Total packages counted, null when nothing recorded one. */
      totalPcs: pcsById.get(p.id) || null,
      /** Set when this came from the scanner rather than the form. */
      resi: p.resi,
      source: p.source,
      isCod: p.isCod,
      codAmount: p.codAmount != null ? num(p.codAmount) : null,
    }));
  }

  async getPurchase(userId: string, id: string) {
    const [p] = await this.db
      .select()
      .from(materialPurchases)
      .where(and(eq(materialPurchases.id, id), eq(materialPurchases.userId, userId)))
      .limit(1);
    if (!p) throw new NotFoundException("Pembelian tidak ditemukan");

    const items = await this.db
      .select({
        id: materialPurchaseItems.id,
        materialId: materialPurchaseItems.materialId,
        materialName: materials.name,
        unit: materials.unit,
        quantity: materialPurchaseItems.quantity,
        /** How the quantity was counted, kept beside what it became. */
        qtyPcs: materialPurchaseItems.qtyPcs,
        contentPerPcs: materialPurchaseItems.contentPerPcs,
        enteredContent: materialPurchaseItems.enteredContent,
        enteredUnit: materialPurchaseItems.enteredUnit,
        totalCost: materialPurchaseItems.totalCost,
        unitCost: materialPurchaseItems.unitCost,
        createdMaterial: materialPurchaseItems.createdMaterial,
      })
      .from(materialPurchaseItems)
      .innerJoin(materials, eq(materialPurchaseItems.materialId, materials.id))
      .where(eq(materialPurchaseItems.purchaseId, id));

    return {
      id: p.id,
      purchasedAt: p.purchasedAt,
      supplierName: p.supplierName,
      note: p.note,
      receiptUrl: p.receiptUrl,
      totalCost: num(p.totalCost),
      /** The order screenshot, when one was attached. */
      orderPhotoUrl: p.orderPhotoUrl,
      /** Present for a scanned parcel; the editor uses these to label it. */
      resi: p.resi,
      source: p.source,
      isCod: p.isCod,
      codAmount: p.codAmount != null ? num(p.codAmount) : null,
      items: items.map((i) => ({
        ...i,
        quantity: num(i.quantity),
        qtyPcs: i.qtyPcs != null ? num(i.qtyPcs) : null,
        contentPerPcs: i.contentPerPcs != null ? num(i.contentPerPcs) : null,
        enteredContent: i.enteredContent != null ? num(i.enteredContent) : null,
        totalCost: num(i.totalCost),
        unitCost: num(i.unitCost),
      })),
    };
  }

  private async getOrThrow(userId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(materials)
      .where(and(eq(materials.id, id), eq(materials.userId, userId)))
      .limit(1);
    if (!row) throw new NotFoundException("Bahan baku tidak ditemukan");
    return row;
  }
}

/* --------------------------------------------------------------- parsing */

export interface ParsedLine {
  name: string;
  quantity: number;
  unit: string | null;
  totalCost: number;
}

const UNIT_WORDS =
  "pcs|pc|buah|bh|lusin|box|dus|pack|pak|sachet|roll|meter|mtr|m|cm|kg|gr|gram|g|ml|liter|ltr|l|lembar|label|set";

/**
 * Pulls {name, qty, unit, total} out of OCR'd receipt text, one line at a time.
 *
 * Handles the two layouts these screenshots usually take:
 *   "Biji Kopi Arabika   2 kg   Rp240.000"
 *   "2x Tabung                  Rp13.000"
 *
 * Lines without both a quantity and an amount are skipped — a receipt is full
 * of headers, addresses and totals, and inventing rows from them would be
 * worse than missing one the admin can add by hand.
 */
export function parsePurchaseLines(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  const moneyRe = /(?:Rp\.?\s*)?(\d{1,3}(?:\.\d{3})+|\d{4,})(?:,\d{2})?/g;
  const leadingQtyRe = new RegExp(`^\\s*(\\d+(?:[.,]\\d+)?)\\s*(?:x|×)?\\s*(${UNIT_WORDS})?\\b`, "i");
  // Global: a line like "Kemasan Kraft 200gr  100 pcs  Rp150.000" contains a
  // size inside the NAME as well as the real quantity. In a table layout the
  // quantity column sits to the right of the name, so the RIGHTMOST match is
  // the quantity — taking the first one read 200 instead of 100.
  const trailingQtyRe = new RegExp(`\\b(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_WORDS})\\b`, "gi");

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.length < 3) continue;
    // Skip obvious summary rows so they don't become phantom materials.
    if (/^(total|subtotal|ongkir|ongkos|diskon|voucher|biaya|pajak|ppn|grand)/i.test(line)) continue;

    const amounts = [...line.matchAll(moneyRe)].map((m) => Number(m[1]!.replace(/\./g, "")));
    const money = amounts.filter((n) => n >= 100);
    if (!money.length) continue;
    // The largest figure on the line is the line total; a unit price, if
    // printed too, is smaller.
    const totalCost = Math.max(...money);

    let quantity = 0;
    let unit: string | null = null;
    let name = line;

    const lead = line.match(leadingQtyRe);
    trailingQtyRe.lastIndex = 0;
    const trailAll = [...line.matchAll(trailingQtyRe)];
    const trail = trailAll.length ? trailAll[trailAll.length - 1]! : null;
    if (lead && Number(lead[1]!.replace(",", ".")) > 0) {
      quantity = Number(lead[1]!.replace(",", "."));
      unit = lead[2] ?? null;
      name = line.slice(lead[0].length);
    } else if (trail) {
      quantity = Number(trail[1]!.replace(",", "."));
      unit = trail[2] ?? null;
      // Remove only that occurrence, so a size baked into the name survives.
      name = line.slice(0, trail.index) + " " + line.slice(trail.index! + trail[0].length);
    } else {
      continue; // no quantity — not a line item
    }

    // Strip every money token and leftover separators from the name.
    name = name
      .replace(moneyRe, " ")
      .replace(/Rp\.?/gi, " ")
      .replace(/[|·•,;:]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .replace(/^[\s\-–—x×]+|[\s\-–—]+$/g, "")
      .trim();

    if (name.length < 2 || quantity <= 0) continue;
    out.push({ name, quantity, unit, totalCost });
  }
  return out;
}
