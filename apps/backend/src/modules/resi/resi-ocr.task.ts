import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { TenantService } from "../../database/tenant.service.js";
import { orders, resiScanItems, resiScans } from "../../database/schema/index.js";
import { UploadsService } from "../uploads/uploads.service.js";
import { labelColumns, parseShippingLabel } from "./label-parser.js";

const execFileAsync = promisify(execFile);

// The same isolated worker the payout OCR uses. It is a separate process on
// purpose: tesseract.js can abort the whole Node process from inside
// recognize(), and a try/catch does not stop it — a warehouse photo that
// happens to trip that bug must not take the API down with it.
// The backend compiles to CommonJS, so __dirname is available and points at
// dist/modules/resi/ — the worker sits one level across in dist/modules/payout/.
const WORKER_SCRIPT = join(__dirname, "..", "payout", "ocr-worker-script.js");

/** Small batches: OCR is CPU-heavy and this box also serves the live API. */
const BATCH = 2;
const TICK_MS = 20_000;
const OCR_TIMEOUT_MS = 45_000;
const MAX_ATTEMPTS = 3;

/**
 * Reads the photographed label in the background, after the packer has
 * already moved on to the next parcel.
 *
 * This is why the app does not wait: OCR of a full shipping label takes
 * seconds, and holding the scanner still for it would cost more than the
 * information is worth at that moment. The barcode already gave us the one
 * fact needed immediately — which parcel this is — so everything else can
 * arrive late.
 *
 * How well it does: on the twelve scans recorded so far, the large print — the
 * waybill, the marketplace, the COD flag, the sortation code — comes through
 * some of the time, and the small print never does. Tesseract reports 32-50%
 * confidence on these photographs, and at that level it invents digits rather
 * than omitting them. So the order number, the shop, the recipient and the
 * product table are expected to arrive empty and to be filled in by hand on
 * the Produksi & Packing page; the columns exist for both routes.
 *
 * Preprocessing was tried and rejected. Cropping the frame down to the label
 * before reading (found by brightness and detail density, never once slicing
 * the label off) cut junk lines by half but read the waybill on fewer photos,
 * not more, across six scans. Enlarging and sharpening were worse still —
 * tesseract does its own scaling and binarisation, and pre-empting it fights
 * it. Doubling OCR cost on a two-core box that also serves the API needs a
 * measured gain behind it, and there was none.
 */
@Injectable()
export class ResiOcrTask {
  private readonly logger = new Logger(ResiOcrTask.name);
  private running = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly tenant: TenantService,
    private readonly uploads: UploadsService,
  ) {}

  @Interval(TICK_MS)
  async tick(): Promise<void> {
    // A tick that overlaps its predecessor would run two tesseract processes
    // per slot and starve the API of CPU.
    if (this.running) return;
    this.running = true;
    try {
      // Cron runs outside any request, so there is no app.user_id and RLS
      // would return zero rows without saying why. Same bypass every
      // scheduled job in this codebase needs.
      const pending = await this.tenant.runBypass(() =>
        this.db
          .select()
          .from(resiScans)
          .where(and(eq(resiScans.ocrStatus, "pending"), sql`${resiScans.photoUrl} is not null`))
          .orderBy(asc(resiScans.scannedAt))
          .limit(BATCH),
      );
      for (const scan of pending) {
        await this.processOne(scan);
      }
    } catch (e) {
      this.logger.error(`OCR tick failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async processOne(scan: typeof resiScans.$inferSelect): Promise<void> {
    const attempts = (scan.ocrAttempts ?? 0) + 1;
    let reading: { text: string; confidence: number | null } | null = null;

    try {
      reading = await this.readText(scan.photoUrl!);
    } catch (e) {
      this.logger.warn(`OCR threw for scan ${scan.id}: ${(e as Error).message}`);
    }

    if (reading === null) {
      // Give up after a few goes rather than re-reading an unreadable photo
      // every twenty seconds forever. The scan itself is unaffected: the resi
      // came from the barcode and is already recorded.
      const done = attempts >= MAX_ATTEMPTS;
      await this.tenant.runBypass(() =>
        this.db
          .update(resiScans)
          .set({ ocrAttempts: attempts, ocrStatus: done ? "failed" : "pending" })
          .where(eq(resiScans.id, scan.id)),
      );
      if (done) this.logger.warn(`OCR gave up on scan ${scan.id} after ${attempts} attempts`);
      return;
    }

    const parsed = parseShippingLabel(reading.text);

    // Whatever a human typed stands. A re-read exists to improve on a machine
    // guess, never to overwrite a correction: the operator held the actual
    // parcel, and tesseract saw a blurred photograph of it at 40% confidence.
    const keepManual = scan.labelEditedAt != null;

    await this.tenant.runBypass(() =>
      this.db
        .update(resiScans)
        .set({
          ocrStatus: "done",
          ocrAttempts: attempts,
          ocrAt: new Date(),
          ocrText: reading!.text.slice(0, 20_000),
          ocrConfidence: reading!.confidence != null ? reading!.confidence.toFixed(2) : null,
          ...(keepManual ? {} : labelColumns(parsed)),
        })
        .where(eq(resiScans.id, scan.id)),
    );

    // Seed the mappable lines, but only when there are none yet: re-reading a
    // photo must not duplicate rows an operator has already corrected by hand.
    if (parsed.items.length) {
      await this.tenant.runBypass(async () => {
        const [existing] = await this.db
          .select({ id: resiScanItems.id })
          .from(resiScanItems)
          .where(eq(resiScanItems.resiScanId, scan.id))
          .limit(1);
        if (existing) return;
        await this.db.insert(resiScanItems).values(
          parsed.items.map((it) => ({
            resiScanId: scan.id,
            rawName: it.name.slice(0, 255),
            rawQty: String(it.qty),
            qty: String(it.qty),
          })),
        );
      });
    }

    this.logger.log(
      `OCR done for ${scan.resi} (conf=${reading.confidence ?? "?"}): order=${
        parsed.orderNo ?? "-"
      } recipient=${parsed.recipient ?? "-"} shop=${parsed.senderName ?? "-"} items=${
        parsed.items.length
      }${keepManual ? " [label fields kept: edited by hand]" : ""}`,
    );

    if (!scan.orderId && !keepManual && parsed.orderNo) await this.autoLink(scan, parsed.orderNo);
  }

  /**
   * The payoff for reading the label: the order number on it identifies the
   * order exactly, so the parcel can be matched without anyone clicking
   * anything. This is what the manual "Hubungkan" button on the web page
   * exists to cover for, and every label that parses cleanly is one the
   * operator never has to touch.
   */
  private async autoLink(scan: typeof resiScans.$inferSelect, orderNo: string): Promise<void> {
    await this.tenant.runBypass(async () => {
      const [order] = await this.db
        .select()
        .from(orders)
        .where(
          and(eq(orders.userId, scan.userId), eq(orders.marketplaceOrderId, orderNo)),
        )
        .limit(1);
      if (!order) return;

      // Never overwrite a waybill that is already on the order, and never
      // give one order two parcels.
      if (order.trackingNumber && order.trackingNumber !== scan.resi) {
        this.logger.warn(
          `Scan ${scan.resi} matched order ${orderNo}, which already carries ${order.trackingNumber}. Left for a human.`,
        );
        return;
      }
      const [taken] = await this.db
        .select({ id: resiScans.id })
        .from(resiScans)
        .where(and(eq(resiScans.orderId, order.id), sql`${resiScans.id} <> ${scan.id}`))
        .limit(1);
      if (taken) return;

      await this.db
        .update(orders)
        .set({ trackingNumber: scan.resi, fulfillmentStatus: "dikirim", updatedAt: new Date() })
        .where(eq(orders.id, order.id));

      await this.db
        .update(resiScans)
        .set({ orderId: order.id, previousStatus: order.fulfillmentStatus })
        .where(and(eq(resiScans.id, scan.id), isNull(resiScans.orderId)));

      this.logger.log(
        `Auto-linked ${scan.resi} to order ${orderNo} (${order.fulfillmentStatus} -> dikirim) from the label`,
      );
    });
  }

  /**
   * Not reusing payout's OcrService: that one is built to pull an amount and
   * an account number off a transfer receipt and returns those, not text. The
   * shared artefact is the worker script itself, which both call.
   */
  private async readText(photoUrl: string): Promise<{ text: string; confidence: number | null } | null> {
    const buffer = await this.uploads.readByUrl(photoUrl);
    if (!buffer) {
      this.logger.warn(`Photo missing on disk for ${photoUrl}`);
      return null;
    }
    const tempPath = join(tmpdir(), `resi-${randomUUID()}.jpg`);
    await writeFile(tempPath, buffer);
    try {
      const { stdout } = await execFileAsync("node", [WORKER_SCRIPT, tempPath], {
        timeout: OCR_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
      });
      const out = JSON.parse(stdout) as { text?: string; confidence?: number };
      return {
        text: out.text ?? "",
        // Kept so the page can mark a reading as unreliable rather than
        // presenting a 40%-confidence guess as though it were typed in.
        confidence: typeof out.confidence === "number" ? out.confidence : null,
      };
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr;
      this.logger.warn(
        `OCR worker failed for ${photoUrl}: ${(err as Error).message}${stderr ? ` | ${stderr.trim()}` : ""}`,
      );
      return null;
    } finally {
      await unlink(tempPath).catch(() => {});
    }
  }
}
