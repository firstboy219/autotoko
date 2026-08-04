import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, ilike, gte, isNull, ne, or, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { orders, resiScans, shops } from "../../database/schema/index.js";

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

const MIN_RESI_LEN = 6;
const MAX_RESI_LEN = 64;

/** Where a scanned parcel lands in the order pipeline. */
const SHIPPED: "dikirim" = "dikirim";

export interface ScanResult {
  id: string;
  resi: string;
  courier: string | null;
  orderId: string | null;
  /** Set when the scan advanced an order, so the app can say so out loud. */
  linkedOrder: { id: string; marketplaceOrderId: string; from: string; to: string } | null;
  scannedAt: Date;
}

@Injectable()
export class ResiService {
  private readonly logger = new Logger(ResiService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async scan(
    userId: string,
    input: { resi: string; resiRaw?: string; source?: string; deviceLabel?: string },
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
        source: input.source === "manual" ? "manual" : "ocr",
        deviceLabel: input.deviceLabel?.slice(0, 64) ?? null,
      })
      .returning();
    if (!inserted) throw new Error("Insert resi_scans returned no row");

    return {
      id: inserted.id,
      resi: inserted.resi,
      courier: inserted.courier,
      orderId: inserted.orderId,
      linkedOrder,
      scannedAt: inserted.scannedAt,
    };
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

    const [row] = await this.db
      .delete(resiScans)
      .where(and(eq(resiScans.userId, userId), eq(resiScans.id, id)))
      .returning();
    if (!row) throw new NotFoundException("Data scan tidak ditemukan.");
    this.logger.log(`Resi scan ${row.resi} deleted by user ${userId}`);
    return { ok: true };
  }
}
