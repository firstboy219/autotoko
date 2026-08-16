import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { and, eq, or } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  payoutDisbursements,
  payoutMutations,
  payoutBatches,
  shops,
  subSellers,
  subSubSellers,
} from "../../database/schema/index.js";
import { OcrService } from "./ocr.service.js";
import type { UploadDisbursementProofDto, OverrideDisbursementDto } from "./dto.js";

const toCents = (v: string | number | null) => Math.round(Number(v ?? 0) * 100);
// A screenshot's OCR read rarely matches a stored account string byte-for-byte
// (spaces, dashes) — compare only the digits.
const digitsOnly = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/**
 * Banking/marketplace UIs almost always MASK the account number, so an OCR
 * read is typically just the last few digits (e.g. "8214" from
 * "********8214") — it can never equal the FULL recorded account number
 * digit-for-digit. Match if the recorded account ENDS WITH whatever digits
 * OCR found (covers both a masked partial read and, via the same check, a
 * rarer fully-visible exact read).
 */
function accountDigitsMatch(ocrAccount: string | null, recordedAccount: string | null): boolean {
  if (!recordedAccount) return true; // nothing to compare against — don't block on it
  if (!ocrAccount) return false;
  const ocrDigits = digitsOnly(ocrAccount);
  const recordedDigits = digitsOnly(recordedAccount);
  if (!ocrDigits) return false;
  return recordedDigits.endsWith(ocrDigits);
}

/**
 * The receipt names the bank and shows the tail of the account. That is the
 * answer, even when no digit run long enough to look like an account survived.
 *
 * A real rejected proof read:
 *
 *     JAGO. Pee 7815
 *
 * against a recorded "JAGO 5030 2799 7815". The mask came through as letters,
 * so four digits were all that was left and no extractor looking for eight
 * would ever find them — while a person reading the same line has no doubt.
 *
 * Both halves are required. Four digits alone is one chance in ten thousand of
 * landing by accident, which is too loose to accept on its own; four digits on
 * a receipt that also names the right bank, for an amount that already
 * matched to the rupiah, is not a coincidence.
 */
function bankAndTailMatch(rawText: string | null, recordedAccount: string | null): boolean {
  if (!rawText || !recordedAccount) return false;
  const teks = rawText.toUpperCase();

  // The bank is whatever alphabetic token the account was recorded with —
  // taken from the data rather than from a hard-coded list of Indonesian
  // banks, which would need editing every time a new one appears.
  const bank = (recordedAccount.toUpperCase().match(/[A-Z]{3,}/g) ?? []).filter(
    (w) => !["BANK", "REKENING", "REK", "NO"].includes(w),
  );
  if (!bank.some((w) => teks.includes(w))) return false;

  const ekor = digitsOnly(recordedAccount).slice(-4);
  if (ekor.length < 4) return false;
  // Anywhere in the text: the tail sits on the destination line, and trying to
  // pin down which line that is was exactly what failed before.
  return teks.includes(ekor);
}

@Injectable()
export class DisbursementsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly ocr: OcrService,
  ) {}

  /**
   * The Tahap 2 / Tahap 3 rekap: one row per outgoing transfer, joined with
   * shop + ownership-chain names so staff never has to look up an account
   * number on another page (Bagian 2). The consolidated sedekah row has no
   * mutation/shop (it covers the whole batch) — LEFT JOINed and matched via
   * disbursement.batchId instead, so shopName/marketplace come back null for
   * that row specifically; every sub_seller/sub_sub_seller row still has one.
   */
  async listForBatch(userId: string, batchId: string) {
    const [batch] = await this.db
      .select()
      .from(payoutBatches)
      .where(and(eq(payoutBatches.id, batchId), eq(payoutBatches.userId, userId)))
      .limit(1);
    if (!batch) throw new NotFoundException("Batch not found");

    const rows = await this.db
      .select({
        disbursement: payoutDisbursements,
        mutation: payoutMutations,
        shop: shops,
        subSeller: subSellers,
        subSubSeller: subSubSellers,
      })
      .from(payoutDisbursements)
      .leftJoin(payoutMutations, eq(payoutDisbursements.payoutMutationId, payoutMutations.id))
      .leftJoin(shops, eq(payoutMutations.shopId, shops.id))
      .leftJoin(subSellers, eq(payoutDisbursements.recipientSubSellerId, subSellers.id))
      .leftJoin(subSubSellers, eq(payoutDisbursements.recipientSubSubSellerId, subSubSellers.id))
      .where(
        and(
          eq(payoutDisbursements.userId, userId),
          or(eq(payoutMutations.batchId, batchId), eq(payoutDisbursements.batchId, batchId)),
        ),
      );

    return rows.map((r) => ({
      id: r.disbursement.id,
      payoutMutationId: r.disbursement.payoutMutationId,
      shopName: r.shop ? (r.shop.displayName ?? r.shop.shopName ?? r.shop.shopId) : null,
      marketplace: r.shop?.marketplace ?? null,
      recipientType: r.disbursement.recipientType,
      // Dikirim supaya halaman bisa menautkan transfer ini ke toko-toko yang
      // menghasilkannya: barisnya digabung per penerima, jadi tidak ada
      // payoutMutationId yang bisa dipakai untuk itu.
      recipientSubSellerId: r.disbursement.recipientSubSellerId,
      recipientSubSubSellerId: r.disbursement.recipientSubSubSellerId,
      recipientName:
        r.disbursement.recipientType === "sedekah"
          ? "Sedekah"
          : r.disbursement.recipientType === "bahan_baku"
            ? "Bahan Baku"
            : (r.subSubSeller?.name ?? r.subSeller?.name ?? "-"),
      // Full chain for a sub-sub-seller recipient, per MAPPING_DAN_SELFSERVICE_TOKO.md.
      recipientChain: r.subSubSeller ? `${r.subSubSeller.name} › ${r.subSeller?.name ?? "-"}` : null,
      expectedAmount: r.disbursement.expectedAmount,
      /** Bagian dari expectedAmount yang berasal dari batch sebelumnya. */
      carryoverAmount: r.disbursement.carryoverAmount,
      recordedAccount: r.disbursement.recordedAccount,
      proofUrl: r.disbursement.proofUrl,
      ocrAmount: r.disbursement.ocrAmount,
      ocrAccount: r.disbursement.ocrAccount,
      validationStatus: r.disbursement.validationStatus,
      overrideReason: r.disbursement.overrideReason,
    }));
  }

  /**
   * Upload a transfer proof (Tahap 3): runs OCR and cross-validates against the
   * expected amount/account. Match -> cocok_otomatis. Mismatch or OCR unable to
   * read -> tidak_cocok, staff must then re-upload or override with a reason.
   */
  async uploadProof(userId: string, id: string, dto: UploadDisbursementProofDto) {
    const row = await this.getOrThrow(userId, id);
    const ocr = await this.ocr.extractProofFields(dto.proofUrl);

    // Dibandingkan dalam rupiah bulat, bukan sampai sen. Bagi hasil
    // menghasilkan pecahan (263.447,65) sementara struk bank mencetak
    // 263.448 -- tidak ada bank yang mengirim pecahan sen. Membandingkan
    // sampai sen menolak bukti yang benar, dan menolaknya dengan pesan yang
    // menampilkan dua angka yang sudah dibulatkan jadi sama persis.
    const amountMatches =
      ocr.amount != null &&
      Math.round(ocr.amount) === Math.round(Number(row.expectedAmount));
    const accountMatches =
      accountDigitsMatch(ocr.account, row.recordedAccount) ||
      // Fallback for receipts whose masking did not survive the read.
      bankAndTailMatch(
        typeof (ocr.raw as { text?: unknown } | null)?.text === "string"
          ? (ocr.raw as { text: string }).text
          : null,
        row.recordedAccount,
      );
    const matched = ocr.amount != null && amountMatches && accountMatches;

    const [updated] = await this.db
      .update(payoutDisbursements)
      .set({
        proofUrl: dto.proofUrl,
        ocrAmount: ocr.amount != null ? ocr.amount.toFixed(2) : null,
        ocrAccount: ocr.account,
        ocrRawResult: ocr.raw,
        validationStatus: matched ? "cocok_otomatis" : "tidak_cocok",
        overrideReason: matched ? null : row.overrideReason,
        updatedAt: new Date(),
      })
      .where(and(eq(payoutDisbursements.id, id), eq(payoutDisbursements.userId, userId)))
      .returning();
    return updated;
  }

  /** Staff asserts the transfer is correct despite an OCR mismatch (Bagian 1, Tahap 3). */
  async override(userId: string, id: string, dto: OverrideDisbursementDto) {
    const row = await this.getOrThrow(userId, id);
    if (!row.proofUrl) {
      throw new BadRequestException("Upload the transfer proof before overriding");
    }
    if (!dto.reason?.trim()) {
      throw new BadRequestException("A reason is required to override");
    }
    const [updated] = await this.db
      .update(payoutDisbursements)
      .set({
        validationStatus: "override_manual",
        overrideReason: dto.reason,
        updatedAt: new Date(),
      })
      .where(and(eq(payoutDisbursements.id, id), eq(payoutDisbursements.userId, userId)))
      .returning();
    return updated;
  }

  private async getOrThrow(userId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(payoutDisbursements)
      .where(and(eq(payoutDisbursements.id, id), eq(payoutDisbursements.userId, userId)))
      .limit(1);
    if (!row) throw new NotFoundException("Disbursement not found");
    return row;
  }
}
