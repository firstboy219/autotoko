import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, gte, ilike, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { orders, resiScans } from "../../database/schema/index.js";

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

export interface ScanResult {
  id: string;
  resi: string;
  courier: string | null;
  orderId: string | null;
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

    // Best effort only: link the scan to an order if one already carries this
    // tracking number. Never a precondition — see the schema comment.
    const [match] = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.userId, userId), eq(orders.trackingNumber, resi)))
      .limit(1);

    try {
      const [inserted] = await this.db
        .insert(resiScans)
        .values({
          userId,
          resi,
          resiRaw: (input.resiRaw ?? input.resi).slice(0, 128),
          courier: detectCourier(resi),
          orderId: match?.id ?? null,
          source: input.source === "manual" ? "manual" : "ocr",
          deviceLabel: input.deviceLabel?.slice(0, 64) ?? null,
        })
        .returning();
      // .returning() is typed as an array; an insert that neither threw nor
      // returned a row would mean the driver lied to us, so fail loudly
      // instead of handing back a half-built ScanResult.
      if (!inserted) throw new Error("Insert resi_scans returned no row");
      return {
        id: inserted.id,
        resi: inserted.resi,
        courier: inserted.courier,
        orderId: inserted.orderId,
        scannedAt: inserted.scannedAt,
      };
    } catch (e) {
      // Reaching here IS the feature working: the parcel was already
      // recorded. Recognise the unique violation from more than one signal —
      // relying on `code` alone let a real duplicate surface as a 500,
      // because the driver does not always expose it where the type says it
      // is (it can arrive on the wrapped cause instead).
      const err = e as { code?: string; cause?: { code?: string }; message?: string };
      const code = err.code ?? err.cause?.code;
      const text = err.message ?? "";
      const isDuplicate =
        code === "23505" ||
        text.includes("resi_scans_user_resi_unique") ||
        text.includes("duplicate key value");
      if (!isDuplicate) {
        this.logger.error(`Unexpected resi insert failure (code=${code}): ${text}`);
        throw e;
      }

      // Getting here means the row appeared between the check above and this
      // insert — two devices scanning the same parcel at the same instant.
      // The details cannot be fetched now (the failed statement aborted the
      // request's transaction), so this answer is deliberately thinner than
      // the pre-check's. It is also the rarer path by far, and the important
      // half — refusing the second write — is intact.
      this.logger.warn(`Resi ${resi} lost an insert race for user ${userId}`);
      throw new ConflictException({
        code: "DUPLICATE",
        message: "Resi ini baru saja discan dari perangkat lain.",
        resi,
        firstScannedAt: null,
        deviceLabel: null,
        source: null,
      });
    }
  }

  async list(
    userId: string,
    opts: { limit?: number; offset?: number; q?: string } = {},
  ): Promise<{ rows: unknown[]; total: number }> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const conds = [eq(resiScans.userId, userId)];
    if (opts.q?.trim()) {
      conds.push(ilike(resiScans.resi, `%${normalizeResi(opts.q)}%`));
    }
    const where = and(...conds);

    const rows = await this.db
      .select()
      .from(resiScans)
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

  async summary(userId: string): Promise<{ today: number; total: number; lastScanAt: Date | null }> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [[all], [today]] = await Promise.all([
      this.db
        .select({ count: sql<number>`count(*)::int`, last: sql<Date | null>`max(scanned_at)` })
        .from(resiScans)
        .where(eq(resiScans.userId, userId)),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(resiScans)
        .where(and(eq(resiScans.userId, userId), gte(resiScans.scannedAt, startOfToday))),
    ]);

    return { today: today?.count ?? 0, total: all?.count ?? 0, lastScanAt: all?.last ?? null };
  }

  /**
   * Undo a scan. Needed because a misread that gets recorded would otherwise
   * occupy that key forever, and — worse — a packer who scanned the wrong
   * parcel has no way to take it back.
   */
  async remove(userId: string, id: string): Promise<{ ok: true }> {
    const [row] = await this.db
      .delete(resiScans)
      .where(and(eq(resiScans.userId, userId), eq(resiScans.id, id)))
      .returning();
    if (!row) throw new NotFoundException("Data scan tidak ditemukan.");
    this.logger.log(`Resi scan ${row.resi} deleted by user ${userId}`);
    return { ok: true };
  }
}
