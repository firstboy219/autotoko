import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { convertUnit } from "@autotoko/shared";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { bomItems, materialMovements, materials } from "../../database/schema/products.js";

/**
 * Taking raw materials off the shelf when a parcel ships.
 *
 * The packing scan already knows which products went out and how many. What it
 * never did was tell the shelf. Stock only ever went up — deliveries added to
 * it and nothing subtracted — so the BOM page showed what had been bought, not
 * what was left, and every restock decision was made against a number that
 * could not go down.
 *
 * The one rule this file exists to keep: a movement is only ever applied
 * through the ledger, and anything that changes its cause reverses it first.
 * A packer re-maps a wrongly matched product several times a day, and stock
 * that half-remembers the previous mapping is worse than stock nobody touched.
 */
@Injectable()
export class MaterialConsumptionService {
  private readonly logger = new Logger(MaterialConsumptionService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  private static readonly REF = "resi_scan_items";

  /**
   * Make the shelf agree with one line of a packing scan.
   *
   * Called after the line is written, for every path that can change it:
   * created, re-mapped, re-quantified, deleted. `masterProductId` null (a line
   * nobody mapped, or one being deleted) means "take nothing", which after the
   * reversal below leaves the shelf exactly as if the line had never existed.
   *
   * Never throws. A packer standing at a bench with a parcel in hand must not
   * have their scan rejected because a recipe is half-configured; the scan is
   * the record that matters and the stock is derived from it. Problems are
   * logged and returned, not raised.
   */
  async syncScanItem(
    userId: string,
    itemId: string,
    masterProductId: string | null,
    qty: number,
  ): Promise<{ applied: number; skipped: string[] }> {
    const skipped: string[] = [];
    try {
      await this.reverse(userId, itemId);

      if (!masterProductId || !Number.isFinite(qty) || qty <= 0) {
        return { applied: 0, skipped };
      }

      // Only recipe lines linked to the catalogue can move stock. An unlinked
      // bom_items row still carries a name and a price for costing, but it has
      // no shelf to take from, and inventing one would fork the catalogue that
      // the materials table exists to keep single.
      const recipe = await this.db
        .select({
          bomId: bomItems.id,
          materialId: bomItems.materialId,
          perProduct: bomItems.quantity,
          recipeUnit: bomItems.unit,
          name: materials.name,
          catalogUnit: materials.unit,
        })
        .from(bomItems)
        .innerJoin(materials, eq(materials.id, bomItems.materialId))
        .where(
          and(
            eq(bomItems.masterProductId, masterProductId),
            isNotNull(bomItems.materialId),
            eq(materials.userId, userId),
          ),
        );

      let applied = 0;
      for (const line of recipe) {
        const perProduct = Number(line.perProduct);
        if (!Number.isFinite(perProduct) || perProduct <= 0) continue;

        // The recipe states its own unit and the catalogue states its own, and
        // in production they already disagree on one row: glycerine is a
        // recipe in ml against a catalogue in gram. Converting mass to volume
        // needs a density nobody recorded, so that line is left alone and
        // named, rather than silently taking 50 of the wrong thing.
        const rawUsed = qty * perProduct;
        const used = convertUnit(rawUsed, line.recipeUnit, line.catalogUnit);
        if (used === null) {
          const why =
            `${line.name}: resep memakai "${line.recipeUnit ?? "-"}" ` +
            `sedangkan master memakai "${line.catalogUnit ?? "-"}"`;
          skipped.push(why);
          this.logger.warn(`Stok tidak dikurangi — ${why} (scan item ${itemId})`);
          continue;
        }
        if (used <= 0) continue;

        await this.move(userId, line.materialId!, -used, "resi_scan", itemId,
          `${qty} produk x ${perProduct} ${line.recipeUnit ?? ""}`.trim());
        applied++;
      }
      return { applied, skipped };
    } catch (e) {
      // Same reasoning as above, one level up: the scan is already saved and a
      // failure here must not undo it.
      this.logger.error(
        `Gagal menyesuaikan stok untuk baris scan ${itemId}: ${(e as Error).message}`,
      );
      return { applied: 0, skipped };
    }
  }

  /**
   * Undo everything a scan line ever took, by adding it back.
   *
   * Compensating rows rather than deleted ones. The ledger is what explains the
   * number on the page, and a ledger that can lose entries explains nothing;
   * three rows saying "took 500, gave back 500, took 750" is the true story of
   * a packer who fixed a typo, and it should read that way afterwards.
   */
  private async reverse(userId: string, itemId: string) {
    const prior = await this.db
      .select({
        materialId: materialMovements.materialId,
        net: sql<string>`sum(${materialMovements.quantity})`,
      })
      .from(materialMovements)
      .where(
        and(
          eq(materialMovements.userId, userId),
          eq(materialMovements.refTable, MaterialConsumptionService.REF),
          eq(materialMovements.refId, itemId),
        ),
      )
      .groupBy(materialMovements.materialId);

    for (const row of prior) {
      const net = Number(row.net);
      if (!Number.isFinite(net) || net === 0) continue;
      await this.move(userId, row.materialId, -net, "reversal", itemId,
        "Pembatalan karena baris scan berubah");
    }
  }

  /** One ledger row and the running total it changes, always together. */
  private async move(
    userId: string,
    materialId: string,
    quantity: number,
    reason: string,
    refId: string,
    note: string,
  ) {
    await this.db.insert(materialMovements).values({
      userId,
      materialId,
      quantity: quantity.toFixed(3),
      reason,
      refTable: MaterialConsumptionService.REF,
      refId,
      note,
    });

    // Written as a relative update rather than read-then-write: two phones can
    // finish a scan of different parcels in the same second, and a read-modify-
    // write would let the later one overwrite the earlier one's subtraction.
    await this.db
      .update(materials)
      .set({
        currentStock: sql`${materials.currentStock} + ${quantity.toFixed(3)}`,
        updatedAt: new Date(),
      })
      .where(and(eq(materials.id, materialId), eq(materials.userId, userId)));
  }

  /**
   * What a product would take, without taking it.
   *
   * The packing screen can then say "this will use 50 gram glycerine, 1 botol"
   * before anything is committed, and name the recipe lines that cannot be
   * converted while somebody is still in a position to fix them.
   */
  async previewForProduct(userId: string, masterProductId: string, qty: number) {
    const recipe = await this.db
      .select({
        materialId: bomItems.materialId,
        perProduct: bomItems.quantity,
        recipeUnit: bomItems.unit,
        name: materials.name,
        catalogUnit: materials.unit,
        stock: materials.currentStock,
      })
      .from(bomItems)
      .innerJoin(materials, eq(materials.id, bomItems.materialId))
      .where(
        and(
          eq(bomItems.masterProductId, masterProductId),
          isNotNull(bomItems.materialId),
          eq(materials.userId, userId),
        ),
      );

    return recipe.map((line) => {
      const used = convertUnit(qty * Number(line.perProduct), line.recipeUnit, line.catalogUnit);
      return {
        materialId: line.materialId,
        name: line.name,
        unit: line.catalogUnit,
        uses: used,
        stockBefore: Number(line.stock),
        stockAfter: used === null ? null : Number(line.stock) - used,
        /** Set when the recipe and the catalogue disagree about the unit. */
        unitMismatch: used === null ? `${line.recipeUnit ?? "-"} vs ${line.catalogUnit ?? "-"}` : null,
      };
    });
  }
}
