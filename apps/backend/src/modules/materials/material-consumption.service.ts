import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { convertUnit } from "@autotoko/shared";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  bomItems,
  materialMovements,
  materials,
  packingMaterials,
} from "../../database/schema/products.js";
import { resiScanItems } from "../../database/schema/resi.js";

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
   * Packing is filed against the PARCEL, not the line.
   *
   * A box is used once per resi however many products are inside it, so a
   * per-line ledger reference would take one box per line and a three-item
   * parcel would eat three.
   */
  private static readonly PACKING_REF = "resi_scans";

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
   * Take the packing materials one parcel uses off the shelf.
   *
   * Recipes describe a product; dus, label and shrink describe a parcel. They
   * live in packing_materials rather than in any bom_items row, which is why
   * nothing subtracted them until now — the per-line consumption above could
   * not see them, and their stock only ever went up.
   *
   * Called for every path that changes the parcel: created, contents edited,
   * deleted. Reverses first and re-applies, so running it twice leaves the
   * same result as running it once. `remove` is the delete path — reverse and
   * stop.
   *
   * The overlap guard is not tidiness. Three of this tenant's recipes also
   * list a packing material (Kardus on Cool Mint, Label on Cool Mint, Shrink
   * on Inhaler Duo and Siwak), left over from before the shared packing list
   * existed. Without the guard those parcels would take the same physical box
   * twice — once as a recipe line and once as packing — and a shelf that
   * drops by two for one box is a wrong number nobody can see. Names of the
   * clashing materials come back so the page can ask for the duplicate recipe
   * line to be removed, rather than leaving a silent rule in place forever.
   */
  async syncScanPacking(
    userId: string,
    scanId: string,
    opts: { remove?: boolean } = {},
  ): Promise<{ applied: number; clashes: string[] }> {
    const clashes: string[] = [];
    try {
      await this.reversePacking(userId, scanId);
      if (opts.remove) return { applied: 0, clashes };

      const packing = await this.db
        .select({
          materialId: packingMaterials.materialId,
          perParcel: packingMaterials.defaultQuantity,
          name: materials.name,
        })
        .from(packingMaterials)
        .innerJoin(materials, eq(materials.id, packingMaterials.materialId))
        .where(and(eq(packingMaterials.userId, userId), eq(materials.userId, userId)));
      if (!packing.length) return { applied: 0, clashes };

      // Which materials this parcel's own recipes already took. Only mapped
      // lines count: an unmapped line consumed nothing, so it cannot have
      // taken the box either.
      const viaRecipe = await this.db
        .selectDistinct({ materialId: bomItems.materialId })
        .from(resiScanItems)
        .innerJoin(bomItems, eq(bomItems.masterProductId, resiScanItems.masterProductId))
        .where(
          and(
            eq(resiScanItems.resiScanId, scanId),
            isNotNull(resiScanItems.masterProductId),
            isNotNull(bomItems.materialId),
          ),
        );
      const already = new Set(viaRecipe.map((r) => r.materialId).filter(Boolean) as string[]);

      let applied = 0;
      for (const p of packing) {
        if (!p.materialId) continue;
        const qty = Number(p.perParcel);
        if (!Number.isFinite(qty) || qty <= 0) continue;
        if (already.has(p.materialId)) {
          clashes.push(p.name);
          continue;
        }
        await this.move(
          userId,
          p.materialId,
          -qty,
          "packing",
          scanId,
          `1 paket x ${qty}`,
          MaterialConsumptionService.PACKING_REF,
        );
        applied++;
      }
      return { applied, clashes };
    } catch (e) {
      // Same rule as the per-line path: the scan is already saved and a stock
      // problem must not undo it.
      this.logger.error(
        `Gagal menyesuaikan stok packing untuk scan ${scanId}: ${(e as Error).message}`,
      );
      return { applied: 0, clashes };
    }
  }

  /** Give back whatever this parcel's packing ever took. */
  private async reversePacking(userId: string, scanId: string) {
    const prior = await this.db
      .select({
        materialId: materialMovements.materialId,
        net: sql<string>`sum(${materialMovements.quantity})`,
      })
      .from(materialMovements)
      .where(
        and(
          eq(materialMovements.userId, userId),
          eq(materialMovements.refTable, MaterialConsumptionService.PACKING_REF),
          eq(materialMovements.refId, scanId),
        ),
      )
      .groupBy(materialMovements.materialId);

    for (const row of prior) {
      const net = Number(row.net);
      if (!Number.isFinite(net) || net === 0) continue;
      await this.move(
        userId,
        row.materialId,
        -net,
        "reversal",
        scanId,
        "Pembatalan packing karena paket berubah",
        MaterialConsumptionService.PACKING_REF,
      );
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
    /** Which ledger this belongs to: the line's, or the parcel's packing. */
    refTable: string = MaterialConsumptionService.REF,
  ) {
    await this.db.insert(materialMovements).values({
      userId,
      materialId,
      quantity: quantity.toFixed(3),
      reason,
      refTable,
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
