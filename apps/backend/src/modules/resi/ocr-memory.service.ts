import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { ocrCorrections } from "../../database/schema/resi.js";
import { masterProducts, materials } from "../../database/schema/products.js";

/**
 * What the camera read, and what a person said it was.
 *
 * Not a model. A memory: the exact reading and the answer given to it. Similar-
 * looking text can be reasoned about — "Reralus Swak Spey Mih" is recognisably
 * "Mouthspray Siwak" — but "Bagels Gyreani He" is not recognisably anything,
 * and a person has already told us it is Inhaler Regular Peppermint. Nothing
 * except having seen it before will ever resolve that, and the same label
 * photographed the same way tomorrow produces nearly the same garbage.
 *
 * Learning happens on confirmation rather than on the guess: what is recorded
 * is what a person stood behind, which is the only signal here worth keeping.
 */
@Injectable()
export class OcrMemoryService {
  private readonly logger = new Logger(OcrMemoryService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Lower case, alphanumerics, single spaces — the key both sides agree on. */
  static normalise(raw: string | null | undefined): string {
    return (raw ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 255);
  }

  /**
   * Remember that this reading means this thing.
   *
   * Never throws. A lesson that fails to save must not take down the scan that
   * produced it — the parcel is the record that matters and this is a bonus
   * drawn from it.
   */
  async remember(
    userId: string,
    kind: "product" | "material",
    rawText: string | null | undefined,
    targetId: string | null | undefined,
  ): Promise<void> {
    try {
      const key = OcrMemoryService.normalise(rawText);
      // Too short to identify anything. "bs i 8" is in the data and matches
      // half of everything; remembering it would poison every future guess.
      if (key.length < 4 || !targetId) return;

      await this.db
        .insert(ocrCorrections)
        .values({
          userId,
          kind,
          rawNorm: key,
          rawText: rawText?.slice(0, 2000) ?? null,
          targetId,
        })
        .onConflictDoUpdate({
          target: [
            ocrCorrections.userId,
            ocrCorrections.kind,
            ocrCorrections.rawNorm,
            ocrCorrections.targetId,
          ],
          // Repeats strengthen rather than duplicate, so a reading answered
          // twice outranks one answered once — which is how a mistaken
          // correction is undone: by correcting it again.
          set: { hits: sql`${ocrCorrections.hits} + 1`, lastSeen: new Date() },
        });
    } catch (e) {
      this.logger.warn(`Tidak bisa menyimpan pelajaran OCR: ${(e as Error).message}`);
    }
  }

  /**
   * Drop what a correction has just contradicted.
   *
   * "Not that one" is the clearest statement the packer makes, and leaving the
   * old association behind at equal weight turns one answer into a tie. Only
   * the pair being corrected is removed — other readings that legitimately
   * mean the same product are untouched.
   */
  async forget(
    userId: string,
    kind: "product" | "material",
    rawText: string | null | undefined,
    targetId: string | null | undefined,
  ): Promise<void> {
    try {
      const key = OcrMemoryService.normalise(rawText);
      if (key.length < 4 || !targetId) return;
      await this.db
        .delete(ocrCorrections)
        .where(
          and(
            eq(ocrCorrections.userId, userId),
            eq(ocrCorrections.kind, kind),
            eq(ocrCorrections.rawNorm, key),
            eq(ocrCorrections.targetId, targetId),
          ),
        );
    } catch (e) {
      this.logger.warn(`Tidak bisa menghapus pelajaran OCR: ${(e as Error).message}`);
    }
  }

  /**
   * Everything learned, for the phone to carry offline.
   *
   * Sent whole rather than queried per scan: the sheet opens in the moment
   * after a barcode reads, and a round trip there is a delay the packer feels.
   * A tenant's vocabulary is small — it is their own labels, repeatedly.
   *
   * Rows whose target no longer exists are dropped here rather than deleted:
   * a product removed and re-added keeps its lessons, and a lesson pointing at
   * nothing is simply not offered.
   */
  async hints(userId: string, limit = 400) {
    const rows = await this.db
      .select({
        kind: ocrCorrections.kind,
        raw: ocrCorrections.rawNorm,
        targetId: ocrCorrections.targetId,
        hits: ocrCorrections.hits,
        productName: masterProducts.name,
        materialName: materials.name,
      })
      .from(ocrCorrections)
      .leftJoin(masterProducts, eq(masterProducts.id, ocrCorrections.targetId))
      .leftJoin(materials, eq(materials.id, ocrCorrections.targetId))
      .where(eq(ocrCorrections.userId, userId))
      .orderBy(desc(ocrCorrections.hits), desc(ocrCorrections.lastSeen))
      .limit(limit);

    return rows
      .filter((r) => (r.kind === "product" ? r.productName : r.materialName))
      .map((r) => ({
        kind: r.kind,
        raw: r.raw,
        targetId: r.targetId,
        hits: r.hits,
        name: r.kind === "product" ? r.productName : r.materialName,
      }));
  }

  /**
   * Learn from a whole scan's worth of lines at once.
   *
   * Only lines that carry BOTH a reading and an answer teach anything: a line
   * added by hand has no reading, and an unmapped line has no answer.
   */
  async rememberScanItems(
    userId: string,
    lines: { rawName?: string | null; masterProductId?: string | null; source?: string | null }[],
  ): Promise<void> {
    for (const line of lines) {
      if (!line.rawName || !line.masterProductId) continue;
      // device_auto is the phone's own proposal. Recording it would teach the
      // system its own guesses and then weigh them equally against the
      // corrections that overruled them — which is what happened in testing.
      if (line.source === "device_auto") continue;
      await this.remember(userId, "product", line.rawName, line.masterProductId);
    }
  }
}
