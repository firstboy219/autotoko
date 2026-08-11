import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, ilike, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  masterProducts,
  orders,
  packingSettings,
  resiScanCodes,
  resiScanItems,
  resiScanPhotos,
  resiScans,
  shops,
} from "../../database/schema/index.js";
import { UploadsService } from "../uploads/uploads.service.js";
import { CourierTrackingService } from "./courier-tracking.service.js";
import {
  COURIER_NAMES,
  MARKETPLACES,
  guessFromText,
  matchShop,
  normaliseMarketplace,
} from "./scan-mapping.js";
import { MaterialConsumptionService } from "../materials/material-consumption.service.js";
import { OcrMemoryService } from "./ocr-memory.service.js";
import { ConfigService } from "@nestjs/config";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Strip a scanned waybill down to a comparison key.
 *
 * OCR renders the same label as "JX 1234-5678 90", "JX1234567890" or
 * "jx1234567890" depending on lighting and crop, so a duplicate guard that
 * compares raw strings would happily accept the same parcel three times.
 * Upper-casing and dropping every non-alphanumeric fixes that.
 *
 * Deliberately NOT folded: the classic OCR confusions O/0, I/1, S/5. Folding
 * them would make the key shorter-sighted than the couriers themselves —
 * "IDX0S1" and "1DXO51" can be two real, different parcels, and merging them
 * would reject a legitimate package with no way for the packer to override.
 * Ambiguity is better handled where a human can see it: the app shows the
 * candidates it read and asks which one is right.
 */
export function normalizeResi(raw: string): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Well-known Indonesian courier prefixes, purely for labelling a scan. */
const COURIER_PREFIXES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^JX|^JP|^JT/, "J&T"],
  [/^JNE|^CGK|^TLS/, "JNE"],
  [/^SPXID|^SPX/, "SPX"],
  [/^NLID|^NINJA/, "Ninja"],
  [/^IDX|^IDE/, "ID Express"],
  [/^LP/, "Lion Parcel"],
  [/^SC|^00/, "SiCepat"],
  [/^AN|^10000/, "Anteraja"],
];

export function detectCourier(normalized: string): string | null {
  for (const [re, name] of COURIER_PREFIXES) {
    if (re.test(normalized)) return name;
  }
  return null;
}

/** Accepted provenance values; anything else is recorded as a barcode scan. */
const SOURCES = ["barcode", "ocr", "manual"];

/** Beyond this a "waybill" is somebody photographing the whole desk. */
const MAX_EXTRA_PAGES = 5;

const MIN_RESI_LEN = 6;
const MAX_RESI_LEN = 64;

/** Where a scanned parcel lands in the order pipeline. */
const SHIPPED: "dikirim" = "dikirim";

/** Same shape as a resi: upper case, alphanumerics only. */
function normaliseCode(v: string | null | undefined): string {
  return (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export interface ScanResult {
  id: string;
  resi: string;
  courier: string | null;
  orderId: string | null;
  /** Set when the scan advanced an order, so the app can say so out loud. */
  linkedOrder: { id: string; marketplaceOrderId: string; from: string; to: string } | null;
  photoUrl: string | null;
  scannedAt: Date;
  /**
   * Recipe lines whose stock could not be adjusted, in words for the packer.
   *
   * Empty on almost every scan. When it is not, something is misconfigured in
   * a way only a person can settle — a recipe measured in ml against a
   * catalogue measured in gram — and the bench is where somebody is actually
   * in a position to notice.
   */
  stockWarnings: string[];
}

@Injectable()
export class ResiService {
  private readonly logger = new Logger(ResiService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly uploads: UploadsService,
    private readonly config: ConfigService,
    private readonly tracking: CourierTrackingService,
    private readonly consumption: MaterialConsumptionService,
    private readonly memory: OcrMemoryService,
  ) {}

  /**
   * The installable APK, reported from what is actually on disk rather than a
   * link written into the page.
   *
   * A hard-coded URL here would fail exactly the way it already failed once:
   * the file used to live under the directory deploy-frontends.sh rsyncs with
   * --delete, so a routine frontend deploy removed it and the page would have
   * gone on cheerfully offering a download that 404s. Reading the directory
   * means the card simply disappears when there is nothing to hand out, which
   * is the honest failure.
   */
  async appDownload(): Promise<{
    url: string;
    fileName: string;
    sizeBytes: number;
    updatedAt: Date;
  } | null> {
    const dir = this.config.get<string>("APK_DIR") ?? "/opt/autotoko/downloads";
    try {
      const names = (await readdir(dir)).filter((n) => n.toLowerCase().endsWith(".apk"));
      if (!names.length) return null;

      const stats = await Promise.all(
        names.map(async (name) => ({ name, st: await stat(join(dir, name)) })),
      );
      // Newest wins, so publishing a new build is a file copy and nothing else.
      stats.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
      const best = stats[0]!;
      return {
        url: `/unduh/${best.name}`,
        fileName: best.name,
        sizeBytes: best.st.size,
        updatedAt: best.st.mtime,
      };
    } catch (e) {
      this.logger.warn(`APK directory unreadable (${dir}): ${(e as Error).message}`);
      return null;
    }
  }

  async scan(
    userId: string,
    input: {
      resi: string;
      resiRaw?: string;
      source?: string;
      deviceLabel?: string;
      photoBase64?: string;
      barcodeFormat?: string;
      labelOrderNo?: string;
      deviceText?: string;
      deviceClarity?: number;
      items?: {
        masterProductId?: string;
        rawName?: string;
        qty: number;
        source?: string;
        matchScore?: number;
      }[];
      /**
       * Where the parcel came from, decided by the packer on the same sheet
       * that confirmed the contents. All three optional: a manual entry or an
       * older build sends none, and the scan is then simply unmapped.
       */
      shopId?: string;
      marketplace?: string;
      courierConfirmed?: string;
      /**
       * Every barcode the phone decoded while looking at this label.
       *
       * A courier label carries several and only one becomes the resi; the
       * rest are what make a second scan of the same parcel recognisable.
       */
      codes?: { value: string; format?: string }[];
    },
  ): Promise<ScanResult> {
    const resi = normalizeResi(input.resi);
    if (resi.length < MIN_RESI_LEN) {
      throw new BadRequestException({
        code: "INVALID",
        message: `Nomor resi terlalu pendek (minimal ${MIN_RESI_LEN} karakter setelah dibersihkan).`,
      });
    }
    if (resi.length > MAX_RESI_LEN) {
      throw new BadRequestException({
        code: "INVALID",
        message: "Nomor resi terlalu panjang — kemungkinan OCR ikut membaca teks lain.",
      });
    }

    // Look the resi up BEFORE trying to insert. Not as the duplicate guard —
    // the unique index is that, and it is the only thing that survives two
    // devices scanning at once — but because TenantInterceptor runs the whole
    // request inside one transaction. A constraint violation aborts that
    // transaction, and every statement after it fails with "current
    // transaction is aborted", so the earlier scan's details are simply
    // unreadable once the insert has failed. Reading first is the only way to
    // tell the packer WHEN and on WHICH device this parcel was already done,
    // which is the difference between a useful warning and a dead end.
    const [existing] = await this.db
      .select()
      .from(resiScans)
      .where(and(eq(resiScans.userId, userId), eq(resiScans.resi, resi)))
      .limit(1);
    if (existing) {
      throw new ConflictException({
        code: "DUPLICATE",
        message: "Resi ini sudah pernah discan.",
        // The app needs this to offer "another sheet of the same waybill":
        // without an id it can only tell the packer to give up.
        scanId: existing.id,
        resi,
        firstScannedAt: existing.scannedAt,
        deviceLabel: existing.deviceLabel,
        source: existing.source,
      });
    }

    // If an order already carries this waybill, the scan speaks for itself and
    // the parcel is on its way. Orders only gain a tracking number once one has
    // been attached by hand at least once (or a marketplace sync fills it in),
    // so early on this will rarely match — the unmatched scans wait on the
    // Produksi & Packing page instead of being lost.
    const [match] = await this.db
      .select({
        id: orders.id,
        marketplaceOrderId: orders.marketplaceOrderId,
        fulfillmentStatus: orders.fulfillmentStatus,
      })
      .from(orders)
      .where(and(eq(orders.userId, userId), eq(orders.trackingNumber, resi)))
      .limit(1);

    /**
     * Where the phone says this parcel came from.
     *
     * Nothing is trusted blind: a shop id is checked against this tenant's own
     * shops, and the marketplace is taken from the shop rather than from the
     * request, so the two can never end up disagreeing about a scan.
     */
    /**
     * Codes long enough to identify a parcel.
     *
     * Short ones are hub and destination codes shared by every parcel going the
     * same way that day; matching on those would refuse the second real parcel
     * of the morning. Ten characters is comfortably below the shortest waybill
     * here (12) and above the sort codes.
     */
    const seenCodes = Array.from(
      new Set(
        [resi, ...(input.codes ?? []).map((c) => normaliseCode(c.value))]
          .filter((c): c is string => Boolean(c) && c.length >= 10),
      ),
    );

    // Checked BEFORE the insert, and before anything else writes: the
    // TenantInterceptor runs the whole request in one transaction, so a
    // constraint failure later would abort the reads this needs.
    if (seenCodes.length) {
      const [clash] = await this.db
        .select({
          scanId: resiScanCodes.scanId,
          code: resiScanCodes.code,
          resi: resiScans.resi,
          scannedAt: resiScans.scannedAt,
          deviceLabel: resiScans.deviceLabel,
        })
        .from(resiScanCodes)
        .innerJoin(resiScans, eq(resiScans.id, resiScanCodes.scanId))
        .where(
          and(
            eq(resiScanCodes.userId, userId),
            inArray(resiScanCodes.code, seenCodes),
          ),
        )
        .limit(1);

      if (clash) {
        throw new ConflictException({
          code: "DUPLICATE",
          message:
            clash.resi === resi
              ? "Resi ini sudah pernah discan."
              : `Paket ini sudah discan sebagai ${clash.resi}. Label yang sama memuat beberapa barcode.`,
          resi: clash.resi,
          scanId: clash.scanId,
          matchedCode: clash.code,
          firstScannedAt: clash.scannedAt,
          deviceLabel: clash.deviceLabel,
        });
      }
    }

    const mapping: {
      shopId: string | null;
      marketplace: string | null;
      courier: string | null;
      confirmed: boolean;
    } = { shopId: null, marketplace: null, courier: null, confirmed: false };

    if (input.shopId) {
      const [shop] = await this.db
        .select({ id: shops.id, marketplace: shops.marketplace })
        .from(shops)
        .where(and(eq(shops.id, input.shopId), eq(shops.userId, userId)))
        .limit(1);
      if (shop) {
        mapping.shopId = shop.id;
        mapping.marketplace = shop.marketplace;
      }
    }
    if (!mapping.marketplace && input.marketplace) {
      mapping.marketplace = normaliseMarketplace(input.marketplace);
    }
    if (input.courierConfirmed) {
      mapping.courier = input.courierConfirmed.trim().slice(0, 32) || null;
    }
    // Confirmed only when a person actually answered: a courier alone is what
    // the barcode already told us and is nobody's decision.
    mapping.confirmed = Boolean((mapping.shopId || mapping.marketplace) && mapping.courier);

    let linkedOrder: ScanResult["linkedOrder"] = null;
    if (match && match.fulfillmentStatus !== SHIPPED) {
      await this.db
        .update(orders)
        .set({ fulfillmentStatus: SHIPPED, updatedAt: new Date() })
        .where(and(eq(orders.id, match.id), eq(orders.userId, userId)));
      linkedOrder = {
        id: match.id,
        marketplaceOrderId: match.marketplaceOrderId,
        from: match.fulfillmentStatus,
        to: SHIPPED,
      };
    }

    // Ask the courier before recording anything. Refusing here rather than
    // flagging afterwards is the point: once a parcel is on the courier's van
    // it cannot be unshipped, so the only moment this is worth knowing is
    // while the packer is still holding it.
    //
    // A null decision means the check could not run — no API key, unknown
    // courier, timeout — and the scan proceeds. Every failure mode is the
    // permissive one on purpose: this is a safety net over the bench, not a
    // gate on it, and a warehouse halted by somebody else's outage would cost
    // more than it saves.
    let trackingStatus: string | null = null;
    let trackingCategory: string | null = null;
    let trackingCheckedAt: Date | null = null;
    const decision = await this.tracking.check(resi, detectCourier(resi));
    if (decision) {
      trackingStatus = decision.status;
      trackingCategory = decision.category;
      trackingCheckedAt = new Date();
      if (decision.verdict === "block") {
        this.logger.warn(`Scan of ${resi} refused: courier says ${decision.status}`);
        throw new ConflictException({
          code: "COURIER_BLOCKED",
          message: decision.reason,
          resi,
          courierStatus: decision.status,
          category: decision.category,
        });
      }
    }

    // Which of the phone's product lines point at a product this tenant
    // actually owns.
    //
    // Read BEFORE the insert, and filtered rather than rejected. A stale
    // product id — deleted since the phone last synced — must not cost the
    // whole scan: the packer is standing at the bench and the waybill is the
    // part they are waiting for. The line survives with its label wording and
    // no mapping, which is a state the Produksi & Packing page already handles.
    const sentItems = (input.items ?? []).slice(0, 40);
    let ownedProducts = new Set<string>();
    if (sentItems.some((i) => i.masterProductId)) {
      const ids = sentItems.map((i) => i.masterProductId).filter((i): i is string => !!i);
      const rows = await this.db
        .select({ id: masterProducts.id })
        .from(masterProducts)
        .where(and(eq(masterProducts.userId, userId), inArray(masterProducts.id, ids)));
      ownedProducts = new Set(rows.map((r) => r.id));
    }

    // Store the photo before inserting, so a row never claims to have one it
    // does not. A failed upload must not sink the scan either: the barcode
    // already identified the parcel, and that is the part the packer is
    // standing there waiting for.
    let photoUrl: string | null = null;
    if (input.photoBase64) {
      try {
        photoUrl = (await this.uploads.saveImage(input.photoBase64, "jpg")).url;
      } catch (e) {
        this.logger.warn(`Photo for ${resi} could not be stored: ${(e as Error).message}`);
      }
    }

    const [inserted] = await this.db
      .insert(resiScans)
      .values({
        userId,
        resi,
        resiRaw: (input.resiRaw ?? input.resi).slice(0, 128),
        courier: detectCourier(resi),
        orderId: match?.id ?? null,
        // Remembered so unlinking can put the order back where it was, rather
        // than leaving it marked shipped after the link is undone.
        previousStatus: linkedOrder?.from ?? null,
        source: SOURCES.includes(input.source ?? "") ? input.source! : "barcode",
        deviceLabel: input.deviceLabel?.slice(0, 64) ?? null,
        photoUrl,
        barcodeFormat: input.barcodeFormat?.slice(0, 32) ?? null,
        labelOrderNo: input.labelOrderNo?.trim().slice(0, 128) || null,
        deviceText: input.deviceText?.slice(0, 20_000) ?? null,
        deviceClarity: input.deviceClarity != null ? input.deviceClarity.toFixed(2) : null,
        // "pending" only when there is something to read. The background task
        // polls on this, so a photoless scan must not sit in its queue.
        ocrStatus: photoUrl ? "pending" : "none",
        // From the same sheet that confirmed the contents. Absent for a manual
        // entry or an older build, which leaves the scan unmapped and so
        // visible in the pending-task list — the honest state, not a guess.
        shopId: mapping.shopId,
        marketplace: mapping.marketplace,
        courierConfirmed: mapping.courier,
        mappingConfirmedAt: mapping.confirmed ? new Date() : null,
        mappingConfirmedBy: mapping.confirmed ? (input.deviceLabel?.slice(0, 64) ?? null) : null,
        trackingStatus,
        trackingCategory,
        trackingCheckedAt,
      })
      .returning();
    if (!inserted) throw new Error("Insert resi_scans returned no row");

    const stockWarnings: string[] = [];

    // Written after the scan exists, so a code can never point at nothing.
    if (seenCodes.length) {
      const byValue = new Map((input.codes ?? []).map((c) => [normaliseCode(c.value), c.format]));
      await this.db.insert(resiScanCodes).values(
        seenCodes.map((code) => ({
          userId,
          scanId: inserted.id,
          code,
          format: byValue.get(code)?.slice(0, 32) ?? input.barcodeFormat?.slice(0, 32) ?? null,
        })),
      );
    }

    // The parcel's contents, as the phone resolved them. Seeded here rather
    // than left to the background reader because the phone saw the label in
    // person: dozens of frames at full sensor resolution, against the tenant's
    // own product list. The server's later pass finds these lines already
    // present and leaves them alone.
    if (sentItems.length) {
      const written = await this.db
        .insert(resiScanItems)
        .values(
          sentItems.map((i) => ({
            resiScanId: inserted.id,
            masterProductId:
              i.masterProductId && ownedProducts.has(i.masterProductId) ? i.masterProductId : null,
            rawName: i.rawName?.slice(0, 255) ?? null,
            rawQty: String(i.qty),
            qty: String(i.qty),
            source: i.source?.slice(0, 16) ?? "device_auto",
            matchScore: i.matchScore != null ? i.matchScore.toFixed(3) : null,
          })),
        )
        .returning();

      // What the camera read beside what the packer stood behind. Recorded
      // here rather than at guess time: the guess is a proposal, the
      // confirmation is the answer, and only the answer is worth learning.
      await this.memory.rememberScanItems(
        userId,
        written.map((w) => ({
          rawName: w.rawName,
          masterProductId: w.masterProductId,
          source: w.source,
        })),
      );

      // The parcel has left the building, so the raw materials in it have left
      // the shelf. Until now nothing said so: deliveries added to stock and
      // nothing ever subtracted, and the BOM page showed what had been bought
      // rather than what was left.
      for (const row of written) {
        const r = await this.consumption.syncScanItem(
          userId,
          row.id,
          row.masterProductId,
          Number(row.qty),
        );
        for (const s of r.skipped) stockWarnings.push(s);
      }
    }

    return {
      id: inserted.id,
      resi: inserted.resi,
      courier: inserted.courier,
      orderId: inserted.orderId,
      /**
       * Recipe lines whose stock could not be touched, named on the phone.
       *
       * A recipe in ml against a catalogue in gram cannot be converted without
       * a density nobody recorded. Saying so at the bench is the only moment
       * anybody is in a position to fix it; a server log is not.
       */
      stockWarnings,
      linkedOrder,
      photoUrl: inserted.photoUrl,
      scannedAt: inserted.scannedAt,
    };
  }

  /**
   * Add another sheet of the same waybill.
   *
   * Reached from the duplicate warning rather than from a menu, because that
   * is the moment the packer discovers the parcel has two labels: they scan
   * the second sheet, the guard refuses it, and the honest answer is not "you
   * already did this one" but "is this another page of it?".
   *
   * The scan itself is untouched. Nothing about which parcel this is changes;
   * only how much of it has been photographed.
   */
  async addPage(userId: string, scanId: string, photoBase64: string, deviceText?: string) {
    const scan = await this.getScanOrThrow(userId, scanId);

    const [counted] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(resiScanPhotos)
      .where(eq(resiScanPhotos.resiScanId, scanId));
    const count = counted?.count ?? 0;
    if (count >= MAX_EXTRA_PAGES) {
      throw new BadRequestException(
        `Sudah ada ${MAX_EXTRA_PAGES} halaman tambahan untuk resi ini.`,
      );
    }

    const saved = await this.uploads.saveImage(photoBase64, "jpg");

    const [row] = await this.db
      .insert(resiScanPhotos)
      .values({
        resiScanId: scanId,
        userId,
        photoUrl: saved.url,
        pageNo: count + 2,
        deviceText: deviceText?.slice(0, 20_000) ?? null,
      })
      .returning();

    // Read the whole parcel again now there is more of it to read. Attempts go
    // back to zero so a scan that had already given up gets a fresh look at
    // what it could not see before.
    await this.db
      .update(resiScans)
      .set({ ocrStatus: "pending", ocrAttempts: 0 })
      .where(eq(resiScans.id, scanId));

    this.logger.log(`Page ${row!.pageNo} added to ${scan.id}`);
    return { ok: true as const, pageNo: row!.pageNo, photoUrl: row!.photoUrl };
  }

  /** Every sheet of one waybill, page 1 first. */
  async listPages(userId: string, scanId: string) {
    await this.getScanOrThrow(userId, scanId);
    const rows = await this.db
      .select()
      .from(resiScanPhotos)
      .where(eq(resiScanPhotos.resiScanId, scanId))
      .orderBy(asc(resiScanPhotos.pageNo));
    return rows.map((r) => ({
      id: r.id,
      pageNo: r.pageNo,
      photoUrl: r.photoUrl,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Attach a scan to an order by hand — the normal path until orders start
   * arriving with a tracking number of their own.
   *
   * Writing the resi onto the order is the important half: from then on the
   * same label scanned again matches automatically, so every manual link makes
   * the next one less likely to be needed.
   */
  async link(userId: string, scanId: string, orderId: string) {
    const [scan] = await this.db
      .select()
      .from(resiScans)
      .where(and(eq(resiScans.userId, userId), eq(resiScans.id, scanId)))
      .limit(1);
    if (!scan) throw new NotFoundException("Data scan tidak ditemukan.");
    if (scan.orderId) {
      throw new ConflictException("Scan ini sudah terhubung ke sebuah order.");
    }

    const [order] = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.userId, userId), eq(orders.id, orderId)))
      .limit(1);
    if (!order) throw new NotFoundException("Order tidak ditemukan.");

    // One parcel, one order. Without this an operator could quietly point two
    // different waybills at the same order and the count of shipped parcels
    // would stop matching reality.
    const [taken] = await this.db
      .select({ id: resiScans.id, resi: resiScans.resi })
      .from(resiScans)
      .where(and(eq(resiScans.userId, userId), eq(resiScans.orderId, orderId)))
      .limit(1);
    if (taken) {
      throw new ConflictException(`Order ini sudah punya resi (${taken.resi}).`);
    }

    await this.db
      .update(orders)
      .set({ trackingNumber: scan.resi, fulfillmentStatus: SHIPPED, updatedAt: new Date() })
      .where(and(eq(orders.id, orderId), eq(orders.userId, userId)));

    await this.db
      .update(resiScans)
      .set({ orderId, previousStatus: order.fulfillmentStatus })
      .where(and(eq(resiScans.id, scanId), eq(resiScans.userId, userId)));

    this.logger.log(
      `Resi ${scan.resi} linked to order ${order.marketplaceOrderId} (${order.fulfillmentStatus} -> ${SHIPPED})`,
    );

    return {
      ok: true as const,
      resi: scan.resi,
      order: {
        id: order.id,
        marketplaceOrderId: order.marketplaceOrderId,
        from: order.fulfillmentStatus,
        to: SHIPPED,
      },
    };
  }

  /** Undo a link, putting the order back where it was before. */
  async unlink(userId: string, scanId: string) {
    const [scan] = await this.db
      .select()
      .from(resiScans)
      .where(and(eq(resiScans.userId, userId), eq(resiScans.id, scanId)))
      .limit(1);
    if (!scan) throw new NotFoundException("Data scan tidak ditemukan.");
    if (!scan.orderId) throw new BadRequestException("Scan ini belum terhubung ke order.");

    const [order] = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.userId, userId), eq(orders.id, scan.orderId)))
      .limit(1);

    if (order) {
      // Only roll the status back if this scan is what moved it. If someone
      // has since advanced the order to selesai, undoing a link must not drag
      // it backwards.
      const shouldRestore = scan.previousStatus && order.fulfillmentStatus === SHIPPED;
      await this.db
        .update(orders)
        .set({
          trackingNumber: order.trackingNumber === scan.resi ? null : order.trackingNumber,
          ...(shouldRestore
            ? { fulfillmentStatus: scan.previousStatus as typeof order.fulfillmentStatus }
            : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(orders.id, order.id), eq(orders.userId, userId)));
    }

    await this.db
      .update(resiScans)
      .set({ orderId: null, previousStatus: null })
      .where(and(eq(resiScans.id, scanId), eq(resiScans.userId, userId)));

    return { ok: true as const };
  }

  async list(
    userId: string,
    opts: { limit?: number; offset?: number; q?: string; linked?: "yes" | "no" } = {},
  ) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const conds = [eq(resiScans.userId, userId)];
    if (opts.q?.trim()) conds.push(ilike(resiScans.resi, `%${normalizeResi(opts.q)}%`));
    if (opts.linked === "yes") conds.push(sql`${resiScans.orderId} is not null`);
    if (opts.linked === "no") conds.push(isNull(resiScans.orderId));
    const where = and(...conds);

    const rows = await this.db
      .select({
        id: resiScans.id,
        resi: resiScans.resi,
        resiRaw: resiScans.resiRaw,
        courier: resiScans.courier,
        source: resiScans.source,
        deviceLabel: resiScans.deviceLabel,
        scannedAt: resiScans.scannedAt,
        photoUrl: resiScans.photoUrl,
        ocrStatus: resiScans.ocrStatus,
        ocrConfidence: resiScans.ocrConfidence,
        labelOrderNo: resiScans.labelOrderNo,
        labelRecipient: resiScans.labelRecipient,
        labelSenderName: resiScans.labelSenderName,
        labelMarketplace: resiScans.labelMarketplace,
        labelService: resiScans.labelService,
        labelSortCode: resiScans.labelSortCode,
        labelCod: resiScans.labelCod,
        labelEditedAt: resiScans.labelEditedAt,
        labelItems: resiScans.labelItems,
        itemCount: sql<number>`(
          select count(*)::int from resi_scan_items i where i.resi_scan_id = ${resiScans.id}
        )`,
        unmappedCount: sql<number>`(
          select count(*)::int from resi_scan_items i
          where i.resi_scan_id = ${resiScans.id} and i.master_product_id is null
        )`,
        itemsConfirmedAt: resiScans.itemsConfirmedAt,
        itemsConfirmedBy: resiScans.itemsConfirmedBy,
        shopId: resiScans.shopId,
        mappedShopName: sql<string | null>`(
          select coalesce(s.display_name, s.shop_name)
          from shops s where s.id = ${resiScans.shopId}
        )`,
        marketplace: resiScans.marketplace,
        courierConfirmed: resiScans.courierConfirmed,
        mappingConfirmedAt: resiScans.mappingConfirmedAt,
        trackingStatus: resiScans.trackingStatus,
        trackingCategory: resiScans.trackingCategory,
        packerPaidAt: resiScans.packerPaidAt,
        packerPaidAmount: resiScans.packerPaidAmount,
        orderId: resiScans.orderId,
        marketplaceOrderId: orders.marketplaceOrderId,
        buyerName: orders.buyerName,
        orderStatus: orders.fulfillmentStatus,
        totalAmount: orders.totalAmount,
        shopName: sql<string | null>`coalesce(${shops.displayName}, ${shops.shopName})`,
      })
      .from(resiScans)
      .leftJoin(orders, eq(resiScans.orderId, orders.id))
      .leftJoin(shops, eq(orders.shopId, shops.id))
      .where(where)
      .orderBy(desc(resiScans.scannedAt))
      .limit(limit)
      .offset(offset);

    const [counted] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(resiScans)
      .where(where);

    return { rows, total: counted?.count ?? 0 };
  }

  async summary(userId: string) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [[all], [today]] = await Promise.all([
      this.db
        .select({
          count: sql<number>`count(*)::int`,
          linked: sql<number>`count(${resiScans.orderId})::int`,
          ocrPending: sql<number>`count(*) filter (where ${resiScans.ocrStatus} = 'pending')::int`,
          ocrFailed: sql<number>`count(*) filter (where ${resiScans.ocrStatus} = 'failed')::int`,
          last: sql<Date | null>`max(${resiScans.scannedAt})`,
        })
        .from(resiScans)
        .where(eq(resiScans.userId, userId)),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(resiScans)
        .where(and(eq(resiScans.userId, userId), gte(resiScans.scannedAt, startOfToday))),
    ]);

    const total = all?.count ?? 0;
    const linked = all?.linked ?? 0;
    return {
      today: today?.count ?? 0,
      total,
      linked,
      unlinked: total - linked,
      ocrPending: all?.ocrPending ?? 0,
      ocrFailed: all?.ocrFailed ?? 0,
      lastScanAt: all?.last ?? null,
    };
  }

  /**
   * Orders a scan can still be attached to. Cancelled ones are excluded, and
   * so are orders that already carry a waybill — offering those would invite
   * overwriting a tracking number that is already correct.
   */
  async linkableOrders(userId: string, q?: string) {
    const conds = [
      eq(orders.userId, userId),
      ne(orders.fulfillmentStatus, "dibatalkan"),
      isNull(orders.trackingNumber),
    ];
    if (q?.trim()) {
      const like = `%${q.trim()}%`;
      const search = or(ilike(orders.marketplaceOrderId, like), ilike(orders.buyerName, like));
      if (search) conds.push(search);
    }

    return this.db
      .select({
        id: orders.id,
        marketplaceOrderId: orders.marketplaceOrderId,
        buyerName: orders.buyerName,
        fulfillmentStatus: orders.fulfillmentStatus,
        totalAmount: orders.totalAmount,
        marketplace: orders.marketplace,
        shopName: sql<string | null>`coalesce(${shops.displayName}, ${shops.shopName})`,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .leftJoin(shops, eq(orders.shopId, shops.id))
      .where(and(...conds))
      .orderBy(desc(orders.createdAt))
      .limit(50);
  }

  // ------------------------------------------------------------------
  // What was in the parcel

  /** The mapped contents of one scan, newest lines last. */
  async listItems(userId: string, scanId: string) {
    await this.getScanOrThrow(userId, scanId);
    const rows = await this.db
      .select({
        id: resiScanItems.id,
        masterProductId: resiScanItems.masterProductId,
        productName: masterProducts.name,
        productSku: masterProducts.sku,
        rawName: resiScanItems.rawName,
        rawQty: resiScanItems.rawQty,
        qty: resiScanItems.qty,
      })
      .from(resiScanItems)
      .leftJoin(masterProducts, eq(resiScanItems.masterProductId, masterProducts.id))
      .where(eq(resiScanItems.resiScanId, scanId))
      .orderBy(asc(resiScanItems.createdAt));

    return rows.map((r) => ({
      ...r,
      rawQty: r.rawQty != null ? Number(r.rawQty) : null,
      qty: Number(r.qty),
      /** False while the operator has not said which product this is. */
      isMapped: r.masterProductId != null,
    }));
  }

  async addItem(
    userId: string,
    scanId: string,
    input: { masterProductId?: string | null; rawName?: string; qty: number },
  ) {
    await this.getScanOrThrow(userId, scanId);
    if (!Number.isFinite(input.qty) || input.qty <= 0) {
      throw new BadRequestException("Jumlah harus lebih dari 0.");
    }
    if (input.masterProductId) await this.assertProduct(userId, input.masterProductId);
    if (!input.masterProductId && !input.rawName?.trim()) {
      throw new BadRequestException("Pilih produk atau isi namanya.");
    }

    const [row] = await this.db
      .insert(resiScanItems)
      .values({
        resiScanId: scanId,
        masterProductId: input.masterProductId ?? null,
        rawName: input.rawName?.trim().slice(0, 255) ?? null,
        qty: input.qty.toFixed(2),
      })
      .returning();
    await this.consumption.syncScanItem(
      userId,
      row!.id,
      row!.masterProductId,
      Number(row!.qty),
    );
    return row;
  }

  async updateItem(
    userId: string,
    scanId: string,
    itemId: string,
    input: { masterProductId?: string | null; qty?: number },
  ) {
    await this.getScanOrThrow(userId, scanId);
    const set: Record<string, unknown> = {};
    if (input.masterProductId !== undefined) {
      if (input.masterProductId) await this.assertProduct(userId, input.masterProductId);
      set.masterProductId = input.masterProductId || null;
    }
    if (input.qty !== undefined) {
      if (!Number.isFinite(input.qty) || input.qty <= 0) {
        throw new BadRequestException("Jumlah harus lebih dari 0.");
      }
      set.qty = input.qty.toFixed(2);
    }

    // Read before the update so the association being replaced is still known.
    const [before] = await this.db
      .select({ rawName: resiScanItems.rawName, masterProductId: resiScanItems.masterProductId })
      .from(resiScanItems)
      .where(and(eq(resiScanItems.id, itemId), eq(resiScanItems.resiScanId, scanId)))
      .limit(1);
    if (!Object.keys(set).length) throw new BadRequestException("Tidak ada perubahan.");

    const [row] = await this.db
      .update(resiScanItems)
      .set(set)
      .where(and(eq(resiScanItems.id, itemId), eq(resiScanItems.resiScanId, scanId)))
      .returning();
    if (!row) throw new NotFoundException("Baris isi paket tidak ditemukan.");
    // The correction itself is the lesson: the packer has just told us this
    // reading means something other than what was proposed.
    if (
      before?.masterProductId &&
      before.masterProductId !== row.masterProductId
    ) {
      // The packer has just said it is not that one.
      await this.memory.forget(userId, "product", before.rawName, { id: before.masterProductId });
    }
    await this.memory.remember(userId, "product", row.rawName, { id: row.masterProductId });
    // Re-mapping is the common case, not the exception: the phone's best guess
    // is wrong often enough that this runs several times a shift. syncScanItem
    // puts back what the previous mapping took before taking anything new, so
    // a corrected line leaves the shelf as if only the correction had happened.
    await this.consumption.syncScanItem(
      userId,
      row.id,
      row.masterProductId,
      Number(row.qty),
    );
    return row;
  }

  async removeItem(userId: string, scanId: string, itemId: string) {
    await this.getScanOrThrow(userId, scanId);
    // Before the row goes, because the ledger is keyed on it and a cascade
    // would take the movements with it — leaving the running total holding a
    // subtraction with nothing left to explain it.
    await this.consumption.syncScanItem(userId, itemId, null, 0);
    const [row] = await this.db
      .delete(resiScanItems)
      .where(and(eq(resiScanItems.id, itemId), eq(resiScanItems.resiScanId, scanId)))
      .returning();
    if (!row) throw new NotFoundException("Baris isi paket tidak ditemukan.");
    return { ok: true as const };
  }

  /**
   * Mark a parcel's contents as checked by a person.
   *
   * Refused while any line is unmapped, and refused when there are none at
   * all. A parcel with nothing in it is the state a scan starts in, so
   * accepting that as confirmation would make the flag mean nothing — and the
   * empty case is exactly the one worth stopping on, because it is what a
   * failed OCR read looks like.
   */
  async confirmItems(userId: string, scanId: string, by?: string) {
    await this.getScanOrThrow(userId, scanId);

    const lines = await this.db
      .select({ id: resiScanItems.id, masterProductId: resiScanItems.masterProductId })
      .from(resiScanItems)
      .where(eq(resiScanItems.resiScanId, scanId));

    if (!lines.length) {
      throw new BadRequestException(
        "Isi paket masih kosong. Tambahkan produknya dulu sebelum dikonfirmasi.",
      );
    }
    const unmapped = lines.filter((l) => !l.masterProductId).length;
    if (unmapped) {
      throw new BadRequestException(
        `Masih ada ${unmapped} baris yang belum dipilih produknya.`,
      );
    }

    const [row] = await this.db
      .update(resiScans)
      .set({
        itemsConfirmedAt: new Date(),
        itemsConfirmedBy: by?.slice(0, 64) ?? null,
      })
      .where(and(eq(resiScans.id, scanId), eq(resiScans.userId, userId)))
      .returning();

    return {
      id: row!.id,
      itemsConfirmedAt: row!.itemsConfirmedAt,
      itemCount: lines.length,
    };
  }

  /**
   * The seller's shops and the courier list, with a guess for one scan.
   *
   * The phone asks for this when a mapping sheet opens. The guess is ranked
   * server-side because the label text it is matched against was read by the
   * server too, and duplicating the matching on the handset would give two
   * answers to the same question with no way to tell which was shown.
   */
  async mappingOptions(userId: string, scanId?: string) {
    const shopRows = await this.db
      .select({
        id: shops.id,
        name: shops.displayName,
        shopName: shops.shopName,
        marketplace: shops.marketplace,
        categoryId: shops.categoryId,
      })
      .from(shops)
      .where(eq(shops.userId, userId))
      .orderBy(asc(shops.shopName));

    const shopList = shopRows.map((s) => ({
      id: s.id,
      name: s.name || s.shopName || "(tanpa nama)",
      marketplace: s.marketplace,
      categoryId: s.categoryId,
    }));

    let suggestion: {
      shopId: string | null;
      marketplace: string | null;
      courier: string | null;
      fromLabel: { sender: string | null; marketplace: string | null; courier: string | null };
    } | null = null;

    if (scanId) {
      const [scan] = await this.db
        .select({
          labelSenderName: resiScans.labelSenderName,
          labelMarketplace: resiScans.labelMarketplace,
          courier: resiScans.courier,
          shopId: resiScans.shopId,
          marketplace: resiScans.marketplace,
          courierConfirmed: resiScans.courierConfirmed,
          // The parsed fields are filled on a small minority of scans; the raw
          // text is there on nearly all of them and plainly carries the answer.
          deviceText: resiScans.deviceText,
          ocrText: resiScans.ocrText,
        })
        .from(resiScans)
        .where(and(eq(resiScans.id, scanId), eq(resiScans.userId, userId)))
        .limit(1);

      if (scan) {
        // An existing decision always wins over a fresh guess: re-opening the
        // sheet to change one field must not silently re-guess the others.
        // Order matters: a decision already made, then the parsed field, then
        // the raw text. Re-opening the sheet to change one field must not
        // silently re-guess the others.
        const fromText = guessFromText(scan.deviceText ?? scan.ocrText, shopList);

        const guessedMarketplace =
          scan.marketplace ??
          normaliseMarketplace(scan.labelMarketplace) ??
          fromText.marketplace;
        const guessedShop =
          scan.shopId ??
          matchShop(scan.labelSenderName, guessedMarketplace, shopList) ??
          fromText.shopId;

        suggestion = {
          shopId: guessedShop,
          marketplace:
            guessedMarketplace ??
            (guessedShop ? shopList.find((s) => s.id === guessedShop)?.marketplace ?? null : null),
          courier: scan.courierConfirmed ?? scan.courier ?? fromText.courier,
          fromLabel: {
            sender: scan.labelSenderName,
            marketplace: scan.labelMarketplace,
            courier: scan.courier,
          },
        };
      }
    }

    return { shops: shopList, couriers: COURIER_NAMES, marketplaces: MARKETPLACES, suggestion };
  }

  /**
   * Record where a parcel came from.
   *
   * Every field is the operator's decision. OCR put a suggestion in front of
   * them and that is all it did — the dangerous failure on this screen is a
   * confident wrong match, and a shop is the key the whole dashboard groups by.
   */
  async confirmMapping(
    userId: string,
    scanId: string,
    input: { shopId?: string | null; marketplace?: string | null; courier?: string | null; by?: string },
  ) {
    await this.getScanOrThrow(userId, scanId);

    let marketplace = input.marketplace?.trim() || null;

    if (input.shopId) {
      const [shop] = await this.db
        .select({ id: shops.id, marketplace: shops.marketplace })
        .from(shops)
        .where(and(eq(shops.id, input.shopId), eq(shops.userId, userId)))
        .limit(1);
      // Without this a request could file a scan against another tenant's
      // shop; no RLS policy on resi_scans would catch it, because the scan
      // being written is legitimately theirs.
      if (!shop) throw new NotFoundException("Toko tidak ditemukan.");
      // A shop IS its marketplace. Taking the client's word for it would let
      // the two disagree, and every grouping downstream would then depend on
      // which one it happened to read.
      marketplace = shop.marketplace;
    }

    if (!input.shopId && !marketplace) {
      throw new BadRequestException(
        "Pilih tokonya, atau minimal marketplace-nya kalau toko itu belum terdaftar.",
      );
    }

    const courier = input.courier?.trim() || null;
    if (!courier) throw new BadRequestException("Pilih kurirnya.");

    const [row] = await this.db
      .update(resiScans)
      .set({
        shopId: input.shopId ?? null,
        marketplace,
        courierConfirmed: courier,
        mappingConfirmedAt: new Date(),
        mappingConfirmedBy: input.by?.slice(0, 64) ?? null,
      })
      .where(and(eq(resiScans.id, scanId), eq(resiScans.userId, userId)))
      .returning();

    // Keyed on the sender line and the carrier token rather than the whole
    // reading: every parcel carries a different recipient, so a key built from
    // the whole label would never match twice. A sender line repeats for every
    // parcel that shop sends, and "JSTPRESS" is J&T for ever.
    if (row!.shopId) {
      await this.memory.remember(userId, "shop", row!.labelSenderName, { id: row!.shopId });
    }
    if (row!.courierConfirmed && row!.courier) {
      await this.memory.remember(userId, "courier", row!.courier, { text: row!.courierConfirmed });
    }

    return {
      id: row!.id,
      shopId: row!.shopId,
      marketplace: row!.marketplace,
      courier: row!.courierConfirmed,
      mappingConfirmedAt: row!.mappingConfirmedAt,
    };
  }

  /**
   * Map several scans at once.
   *
   * Deliberately explicit about which ids: no "apply to everything unmapped"
   * shortcut. That would be one tap away from filing a month of mixed parcels
   * under a single shop, and the mistake is invisible afterwards because the
   * result looks exactly like careful work.
   */
  async confirmMappingBulk(
    userId: string,
    input: { scanIds: string[]; shopId?: string | null; marketplace?: string | null; courier?: string | null; by?: string },
  ) {
    const ids = (input.scanIds ?? []).filter(Boolean).slice(0, 500);
    if (!ids.length) throw new BadRequestException("Belum ada resi yang dipilih.");

    let marketplace = input.marketplace?.trim() || null;
    if (input.shopId) {
      const [shop] = await this.db
        .select({ id: shops.id, marketplace: shops.marketplace })
        .from(shops)
        .where(and(eq(shops.id, input.shopId), eq(shops.userId, userId)))
        .limit(1);
      if (!shop) throw new NotFoundException("Toko tidak ditemukan.");
      marketplace = shop.marketplace;
    }
    if (!input.shopId && !marketplace) {
      throw new BadRequestException("Pilih tokonya, atau minimal marketplace-nya.");
    }
    const courier = input.courier?.trim() || null;
    if (!courier) throw new BadRequestException("Pilih kurirnya.");

    // Scoped by userId as well as by id: a list of ids from a client is not
    // proof of ownership, and this writes to many rows at once.
    const rows = await this.db
      .update(resiScans)
      .set({
        shopId: input.shopId ?? null,
        marketplace,
        courierConfirmed: courier,
        mappingConfirmedAt: new Date(),
        mappingConfirmedBy: input.by?.slice(0, 64) ?? "web",
      })
      .where(and(eq(resiScans.userId, userId), inArray(resiScans.id, ids)))
      .returning({ id: resiScans.id });

    return { updated: rows.length, requested: ids.length };
  }

  /** Ownership check: a scan id alone proves nothing about who owns it. */
  private async getScanOrThrow(userId: string, scanId: string) {
    const [row] = await this.db
      .select({ id: resiScans.id })
      .from(resiScans)
      .where(and(eq(resiScans.userId, userId), eq(resiScans.id, scanId)))
      .limit(1);
    if (!row) throw new NotFoundException("Data scan tidak ditemukan.");
    return row;
  }

  private async assertProduct(userId: string, productId: string) {
    const [row] = await this.db
      .select({ id: masterProducts.id })
      .from(masterProducts)
      .where(and(eq(masterProducts.userId, userId), eq(masterProducts.id, productId)))
      .limit(1);
    // Without this a request could point a scan line at another tenant's
    // product; no RLS policy on resi_scan_items would catch it, since the
    // scan being written to is legitimately theirs.
    if (!row) throw new NotFoundException("Produk tidak ditemukan.");
  }

  // ------------------------------------------------------------------
  // The label itself
  // ------------------------------------------------------------------

  /**
   * Everything recorded from one label, plus how the reading went.
   *
   * The raw OCR text comes back too. It is unglamorous but it is the only way
   * an operator can tell "the photo is unreadable" from "the parser missed
   * it", and that difference decides whether they retake the photo or type the
   * value in.
   */
  async labelDetail(userId: string, scanId: string) {
    const [row] = await this.db
      .select()
      .from(resiScans)
      .where(and(eq(resiScans.userId, userId), eq(resiScans.id, scanId)))
      .limit(1);
    if (!row) throw new NotFoundException("Data scan tidak ditemukan.");

    return {
      id: row.id,
      resi: row.resi,
      courier: row.courier,
      photoUrl: row.photoUrl,
      scannedAt: row.scannedAt,
      ocr: {
        status: row.ocrStatus,
        attempts: row.ocrAttempts,
        at: row.ocrAt,
        confidence: row.ocrConfidence != null ? Number(row.ocrConfidence) : null,
        /** Trimmed: the column holds up to 20k characters of mostly noise. */
        text: row.ocrText ? row.ocrText.slice(0, 6000) : null,
        textLength: row.ocrText?.length ?? 0,
        canRecheck: row.photoUrl != null,
      },
      editedAt: row.labelEditedAt,
      label: {
        orderNo: row.labelOrderNo,
        recipient: row.labelRecipient,
        recipientArea: row.labelRecipientArea,
        recipientAddress: row.labelRecipientAddress,
        senderName: row.labelSenderName,
        senderArea: row.labelSenderArea,
        marketplace: row.labelMarketplace,
        service: row.labelService,
        weightKg: row.labelWeightKg != null ? Number(row.labelWeightKg) : null,
        cod: row.labelCod,
        sortCode: row.labelSortCode,
        packageId: row.labelPackageId,
        buyerNickname: row.labelBuyerNickname,
        qtyTotal: row.labelQtyTotal != null ? Number(row.labelQtyTotal) : null,
        shipDate: row.labelShipDate,
      },
    };
  }

  /** Fields the operator may correct, and the column each one writes. */
  private static readonly LABEL_FIELDS = {
    orderNo: "labelOrderNo",
    recipient: "labelRecipient",
    recipientArea: "labelRecipientArea",
    recipientAddress: "labelRecipientAddress",
    senderName: "labelSenderName",
    senderArea: "labelSenderArea",
    marketplace: "labelMarketplace",
    service: "labelService",
    sortCode: "labelSortCode",
    packageId: "labelPackageId",
    buyerNickname: "labelBuyerNickname",
    shipDate: "labelShipDate",
  } as const;

  /**
   * Correct what the label says.
   *
   * This is not a convenience. OCR reads the small print on these photographs
   * essentially never, so without a keyboard route the columns would stay
   * empty forever and the data would exist only as a photograph.
   *
   * Writing here stamps labelEditedAt, which stops the background reader from
   * overwriting the correction on its next pass.
   */
  async updateLabel(
    userId: string,
    scanId: string,
    dto: Record<string, string | number | boolean | null | undefined>,
  ) {
    await this.getScanOrThrow(userId, scanId);

    // undefined means "not sent, leave it alone"; null and "" mean "clear it".
    //
    // The distinction is not academic. `dto` is a validated class instance, so
    // every declared property exists on it whether or not the client sent one,
    // and the fields nobody sent arrive as undefined. Treating undefined the
    // same as null made a request correcting a single field empty every other
    // field on the label — caught end-to-end against production, where a PATCH
    // of just the nickname wiped the shop, the recipient and the order number.
    const set: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(ResiService.LABEL_FIELDS)) {
      const raw = dto[key];
      if (raw === undefined) continue;
      // An emptied box means "there is nothing there", which is a real answer
      // and has to be storable — otherwise a wrong OCR guess can be corrected
      // to a different wrong value but never cleared.
      const value = typeof raw === "string" ? raw.trim() : raw;
      set[column] = value === "" || value === null ? null : value;
    }
    if (dto.cod !== undefined) set.labelCod = dto.cod === null ? null : Boolean(dto.cod);
    for (const [key, column] of [
      ["weightKg", "labelWeightKg"],
      ["qtyTotal", "labelQtyTotal"],
    ] as const) {
      const n = dto[key];
      if (n === undefined) continue;
      set[column] = n === null || n === "" ? null : Number(n).toFixed(key === "weightKg" ? 3 : 2);
    }

    if (!Object.keys(set).length) {
      throw new BadRequestException("Tidak ada data label yang dikirim.");
    }
    set.labelEditedAt = new Date();

    await this.db.update(resiScans).set(set).where(eq(resiScans.id, scanId));
    return this.labelDetail(userId, scanId);
  }

  /**
   * Read the saved photo again.
   *
   * Worth being honest about what this buys: the reader is unchanged, so a
   * re-read of a clear photo mostly reproduces the same answer. It earns its
   * place in three cases — a reading that failed on a transient error, a photo
   * whose product lines were deleted and should be seeded again, and any
   * future improvement to the reader, which this makes retroactive across
   * every photo already on disk. Corrections typed by hand survive it.
   */
  async recheckOcr(userId: string, scanId: string) {
    const [row] = await this.db
      .select({ id: resiScans.id, photoUrl: resiScans.photoUrl, status: resiScans.ocrStatus })
      .from(resiScans)
      .where(and(eq(resiScans.userId, userId), eq(resiScans.id, scanId)))
      .limit(1);
    if (!row) throw new NotFoundException("Data scan tidak ditemukan.");
    if (!row.photoUrl) {
      throw new BadRequestException("Scan ini tidak punya foto, tidak ada yang bisa dibaca ulang.");
    }

    // Attempts go back to zero so a scan that previously exhausted its three
    // tries gets a fresh set rather than failing again immediately.
    await this.db
      .update(resiScans)
      .set({ ocrStatus: "pending", ocrAttempts: 0 })
      .where(eq(resiScans.id, scanId));

    return { ok: true as const, ocrStatus: "pending" as const, queued: 1 };
  }

  /**
   * Queue a batch for re-reading.
   *
   * Capped rather than unbounded: each photo costs seconds of CPU on a box
   * that also serves the API, and a whole archive queued at once would run the
   * background reader flat out for hours.
   */
  async recheckOcrBulk(
    userId: string,
    opts: { ids?: string[]; scope?: "failed" | "blank" | "all"; limit?: number },
  ) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
    const conds = [
      eq(resiScans.userId, userId),
      sql`${resiScans.photoUrl} is not null`,
      // Already queued: leave it alone rather than resetting its attempt count
      // out from under a read that may be running right now.
      ne(resiScans.ocrStatus, "pending"),
    ];

    if (opts.ids?.length) {
      conds.push(inArray(resiScans.id, opts.ids));
    } else if (opts.scope === "failed") {
      conds.push(eq(resiScans.ocrStatus, "failed"));
    } else if (opts.scope === "blank") {
      // Nothing useful came out last time. Rows a human has corrected are
      // excluded: they are not blank, they are done.
      conds.push(isNull(resiScans.labelEditedAt));
      conds.push(isNull(resiScans.labelOrderNo));
      conds.push(isNull(resiScans.labelRecipient));
    }

    const targets = await this.db
      .select({ id: resiScans.id })
      .from(resiScans)
      .where(and(...conds))
      .orderBy(desc(resiScans.scannedAt))
      .limit(limit);

    if (!targets.length) return { queued: 0 };

    await this.db
      .update(resiScans)
      .set({ ocrStatus: "pending", ocrAttempts: 0 })
      .where(inArray(resiScans.id, targets.map((t) => t.id)));

    this.logger.log(`Queued ${targets.length} scan(s) for re-reading (user ${userId})`);
    return { queued: targets.length };
  }

  // ------------------------------------------------------------------
  // Packing wage
  // ------------------------------------------------------------------

  /**
   * Grouping is by Jakarta calendar day, not UTC.
   *
   * A parcel handed to the courier at 20:00 WIB is 13:00 UTC — same day either
   * way — but one scanned at 08:00 WIB is 01:00 UTC the SAME day, while
   * anything after 07:00 WIB... the edge that actually bites is the evening:
   * 23:30 WIB is 16:30 UTC same day, and 06:30 WIB is 23:30 UTC the PREVIOUS
   * day. Grouping on UTC would move early-morning packing onto the day before
   * and hand the packer a wage for a day they did not work.
   */
  private static readonly DAY_EXPR = sql`(${resiScans.scannedAt} at time zone 'Asia/Jakarta')::date`;

  async getSettings(userId: string): Promise<{ feePerResi: number }> {
    const [row] = await this.db
      .select()
      .from(packingSettings)
      .where(eq(packingSettings.userId, userId))
      .limit(1);
    return { feePerResi: Number(row?.feePerResi ?? 0) };
  }

  async saveSettings(userId: string, feePerResi: number): Promise<{ feePerResi: number }> {
    if (!Number.isFinite(feePerResi) || feePerResi < 0) {
      throw new BadRequestException("Upah per resi tidak boleh negatif.");
    }
    const value = feePerResi.toFixed(2);
    await this.db
      .insert(packingSettings)
      .values({ userId, feePerResi: value })
      .onConflictDoUpdate({
        target: packingSettings.userId,
        set: { feePerResi: value, updatedAt: new Date() },
      });
    return { feePerResi: Number(value) };
  }

  /**
   * One row per day the packer worked: parcels handed over, how many are
   * already settled, and what is still owed.
   *
   * `paidAmount` is summed from what was actually recorded against each
   * parcel, while `dueAmount` uses today's rate — so raising the rate changes
   * what you still owe without rewriting what you already paid.
   */
  /**
   * One day's packing, as a packer would report it at the end of a shift.
   *
   * Counted on the confirmed courier where there is one and the read courier
   * otherwise, because a recap that says "unknown" for everything scanned
   * before the mapping existed is a recap nobody reads twice.
   */
  async dailyRecap(userId: string, date?: string) {
    const day = date ?? new Date().toISOString().slice(0, 10);
    const from = new Date(`${day}T00:00:00`);
    const to = new Date(`${day}T23:59:59.999`);

    const rows = await this.db
      .select({
        id: resiScans.id,
        courier: sql<string | null>`coalesce(${resiScans.courierConfirmed}, ${resiScans.courier})`,
        mapped: sql<boolean>`${resiScans.mappingConfirmedAt} is not null`,
        itemsConfirmed: sql<boolean>`${resiScans.itemsConfirmedAt} is not null`,
        deviceLabel: resiScans.deviceLabel,
      })
      .from(resiScans)
      .where(
        and(
          eq(resiScans.userId, userId),
          gte(resiScans.scannedAt, from),
          lte(resiScans.scannedAt, to),
        ),
      );

    const byCourier = new Map<string, number>();
    const byDevice = new Map<string, number>();
    let unmapped = 0;
    let unconfirmed = 0;
    for (const r of rows) {
      const c = (r.courier ?? "").trim() || "Belum diketahui";
      byCourier.set(c, (byCourier.get(c) ?? 0) + 1);
      const d = (r.deviceLabel ?? "").trim() || "Tanpa nama";
      byDevice.set(d, (byDevice.get(d) ?? 0) + 1);
      if (!r.mapped) unmapped++;
      if (!r.itemsConfirmed) unconfirmed++;
    }

    return {
      date: day,
      total: rows.length,
      unmapped,
      unconfirmedItems: unconfirmed,
      couriers: [...byCourier.entries()]
        .map(([courier, count]) => ({ courier, count }))
        .sort((a, b) => b.count - a.count),
      devices: [...byDevice.entries()]
        .map(([device, count]) => ({ device, count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  async daily(
    userId: string,
    opts: { from?: string; to?: string; limit?: number } = {},
  ) {
    const { feePerResi } = await this.getSettings(userId);
    const conds = [eq(resiScans.userId, userId)];
    if (opts.from) conds.push(gte(ResiService.DAY_EXPR, sql`${opts.from}::date`));
    if (opts.to) conds.push(lte(ResiService.DAY_EXPR, sql`${opts.to}::date`));

    const rows = await this.db
      .select({
        day: sql<string>`${ResiService.DAY_EXPR}::text`,
        total: sql<number>`count(*)::int`,
        paid: sql<number>`count(${resiScans.packerPaidAt})::int`,
        paidAmount: sql<string>`coalesce(sum(${resiScans.packerPaidAmount}), 0)`,
      })
      .from(resiScans)
      .where(and(...conds))
      .groupBy(ResiService.DAY_EXPR)
      .orderBy(sql`${ResiService.DAY_EXPR} desc`)
      .limit(Math.min(Math.max(opts.limit ?? 60, 1), 365));

    const days = rows.map((r) => {
      const unpaid = r.total - r.paid;
      return {
        day: r.day,
        total: r.total,
        paid: r.paid,
        unpaid,
        paidAmount: Number(r.paidAmount),
        dueAmount: unpaid * feePerResi,
      };
    });

    return {
      feePerResi,
      days,
      totals: {
        resi: days.reduce((a, d) => a + d.total, 0),
        paid: days.reduce((a, d) => a + d.paid, 0),
        unpaid: days.reduce((a, d) => a + d.unpaid, 0),
        paidAmount: days.reduce((a, d) => a + d.paidAmount, 0),
        dueAmount: days.reduce((a, d) => a + d.dueAmount, 0),
      },
    };
  }

  /**
   * Settle a day (or a hand-picked set of parcels).
   *
   * Only parcels not already settled are touched, so pressing the button twice
   * cannot pay the same parcel twice — the guard is in the WHERE clause rather
   * than in a prior read, which is the only version that survives two people
   * settling the same day at once.
   */
  async payPacker(
    userId: string,
    input: { day?: string; ids?: string[]; note?: string },
  ): Promise<{ paidCount: number; amount: number; feePerResi: number }> {
    const { feePerResi } = await this.getSettings(userId);
    if (feePerResi <= 0) {
      throw new BadRequestException(
        "Upah per resi belum diatur. Isi dulu di Akun > Upah Packing.",
      );
    }

    const conds = [eq(resiScans.userId, userId), isNull(resiScans.packerPaidAt)];
    if (input.day) conds.push(eq(ResiService.DAY_EXPR, sql`${input.day}::date`));
    else if (input.ids?.length) conds.push(inArray(resiScans.id, input.ids));
    else throw new BadRequestException("Tentukan tanggal atau daftar resi.");

    const updated = await this.db
      .update(resiScans)
      .set({
        packerPaidAt: new Date(),
        packerPaidAmount: feePerResi.toFixed(2),
        packerNote: input.note?.slice(0, 120) ?? null,
      })
      .where(and(...conds))
      .returning({ id: resiScans.id });

    const paidCount = updated.length;
    this.logger.log(
      `Packer wage settled for user ${userId}: ${paidCount} resi at ${feePerResi}`,
    );
    return { paidCount, amount: paidCount * feePerResi, feePerResi };
  }

  /** Undo a settlement — a wrong day marked paid must be reversible. */
  async unpayPacker(
    userId: string,
    input: { day?: string; ids?: string[] },
  ): Promise<{ revertedCount: number }> {
    const conds = [eq(resiScans.userId, userId), sql`${resiScans.packerPaidAt} is not null`];
    if (input.day) conds.push(eq(ResiService.DAY_EXPR, sql`${input.day}::date`));
    else if (input.ids?.length) conds.push(inArray(resiScans.id, input.ids));
    else throw new BadRequestException("Tentukan tanggal atau daftar resi.");

    const reverted = await this.db
      .update(resiScans)
      .set({ packerPaidAt: null, packerPaidAmount: null, packerNote: null })
      .where(and(...conds))
      .returning({ id: resiScans.id });

    return { revertedCount: reverted.length };
  }

  /**
   * Undo a scan. Needed because a misread that gets recorded would otherwise
   * occupy that key forever, and — worse — a packer who scanned the wrong
   * parcel has no way to take it back. Unlinks first, so deleting a scan never
   * strands an order marked shipped by it.
   */
  async remove(userId: string, id: string): Promise<{ ok: true }> {
    const [scan] = await this.db
      .select({ orderId: resiScans.orderId })
      .from(resiScans)
      .where(and(eq(resiScans.userId, userId), eq(resiScans.id, id)))
      .limit(1);
    if (!scan) throw new NotFoundException("Data scan tidak ditemukan.");
    if (scan.orderId) await this.unlink(userId, id);

    // Give back every raw material this parcel took, before the rows that
    // recorded it are gone. The delete below cascades to resi_scan_items, and
    // a cascade happens in the database where no application code runs — so
    // waiting until after would leave the shelf permanently short with nothing
    // left to explain why.
    const lines = await this.db
      .select({ id: resiScanItems.id })
      .from(resiScanItems)
      .where(eq(resiScanItems.resiScanId, id));
    for (const line of lines) {
      await this.consumption.syncScanItem(userId, line.id, null, 0);
    }

    const [row] = await this.db
      .delete(resiScans)
      .where(and(eq(resiScans.userId, userId), eq(resiScans.id, id)))
      .returning();
    if (!row) throw new NotFoundException("Data scan tidak ditemukan.");
    this.logger.log(`Resi scan ${row.resi} deleted by user ${userId}`);
    return { ok: true };
  }
}
