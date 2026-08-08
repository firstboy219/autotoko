import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  bomItems,
  masterProducts,
  materialPurchaseItems,
  materialPurchases,
  materials,
  packingMaterials,
} from "../../database/schema/index.js";
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
  ) {}

  /* ------------------------------------------------------------ catalog */

  async list(userId: string) {
    const rows = await this.db
      .select()
      .from(materials)
      .where(eq(materials.userId, userId))
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
      items: {
        materialId: string;
        rawName?: string;
        qtyPcs: number;
        /** Optional: blank means one unit per package, handled below. */
        contentPerPcs?: number;
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
        totalCost: dto.codAmount != null ? dto.codAmount.toFixed(2) : "0",
      })
      .returning();

    const lines: (typeof materialPurchaseItems.$inferInsert)[] = [];
    const applied: { name: string; qty: number; unit: string | null }[] = [];
    let grandTotal = 0;

    for (const i of wanted) {
      const material = ownedById.get(i.materialId);
      if (!material) continue;
      const pcs = Number(i.qtyPcs);
      const per = Number(i.contentPerPcs);
      if (!Number.isFinite(pcs) || pcs <= 0) continue;
      // A blank content box means one unit per package, which is what "pcs"
      // materials always are; treating it as zero would add nothing at all.
      const content = Number.isFinite(per) && per > 0 ? per : 1;
      const qty = pcs * content;

      // A COD parcel holding ONE material tells us exactly what that material
      // cost, and the weighted average should learn from it. Two or more and
      // the amount belongs to the parcel, not to any one of them — see the
      // note on codAmount. Guessing a split there would be worse than not
      // knowing, because nothing downstream would ever show it was a guess.
      const soleLineCost =
        wanted.length === 1 && dto.codAmount != null ? dto.codAmount : null;

      const cost = i.totalCost != null && Number.isFinite(Number(i.totalCost))
        ? Number(i.totalCost)
        : soleLineCost;
      if (cost != null) grandTotal += cost;

      lines.push({
        purchaseId: purchase!.id,
        userId,
        materialId: material.id,
        quantity: qty.toFixed(3),
        qtyPcs: pcs.toFixed(3),
        contentPerPcs: content.toFixed(3),
        totalCost: cost != null ? cost.toFixed(2) : null,
        unitCost: cost != null && qty > 0 ? (cost / qty).toFixed(2) : null,
        createdMaterial: false,
      });
      await this.applyStockIn(userId, material.id, qty, cost);
      applied.push({ name: material.name, qty, unit: material.unit });
    }

    if (!lines.length) {
      // Nothing survived validation — every line pointed at a material this
      // tenant does not own. Leave no empty report behind.
      await this.db.delete(materialPurchases).where(eq(materialPurchases.id, purchase!.id));
      throw new BadRequestException("Tidak ada bahan yang bisa dicatat dari laporan ini.");
    }

    await this.db.insert(materialPurchaseItems).values(lines);
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

      await this.db.insert(materialPurchaseItems).values({
        purchaseId: purchase!.id,
        userId,
        materialId: materialId!,
        quantity: qty.toFixed(3),
        totalCost: lineTotal.toFixed(2),
        unitCost: lineUnitCost.toFixed(2),
        createdMaterial: created,
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
          .select({ purchaseId: materialPurchaseItems.purchaseId, n: sql<number>`count(*)::int` })
          .from(materialPurchaseItems)
          .where(inArray(materialPurchaseItems.purchaseId, ids))
          .groupBy(materialPurchaseItems.purchaseId)
      : [];
    const byId = new Map(counts.map((c) => [c.purchaseId, Number(c.n)]));

    return rows.map((p) => ({
      id: p.id,
      purchasedAt: p.purchasedAt,
      supplierName: p.supplierName,
      note: p.note,
      receiptUrl: p.receiptUrl,
      totalCost: num(p.totalCost),
      itemCount: byId.get(p.id) ?? 0,
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
      items: items.map((i) => ({
        ...i,
        quantity: num(i.quantity),
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
