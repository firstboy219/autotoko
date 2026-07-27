import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";
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

@Injectable()
export class DisbursementsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly ocr: OcrService,
  ) {}

  /**
   * The Tahap 2 / Tahap 3 rekap: one row per outgoing transfer, joined with
   * shop + ownership-chain names so staff never has to look up an account
   * number on another page (Bagian 2).
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
      .innerJoin(payoutMutations, eq(payoutDisbursements.payoutMutationId, payoutMutations.id))
      .innerJoin(shops, eq(payoutMutations.shopId, shops.id))
      .leftJoin(subSellers, eq(payoutDisbursements.recipientSubSellerId, subSellers.id))
      .leftJoin(subSubSellers, eq(payoutDisbursements.recipientSubSubSellerId, subSubSellers.id))
      .where(and(eq(payoutMutations.batchId, batchId), eq(payoutDisbursements.userId, userId)));

    return rows.map((r) => ({
      id: r.disbursement.id,
      payoutMutationId: r.disbursement.payoutMutationId,
      shopName: r.shop.shopName ?? r.shop.shopId,
      marketplace: r.shop.marketplace,
      recipientType: r.disbursement.recipientType,
      recipientName:
        r.disbursement.recipientType === "sedekah"
          ? "Sedekah"
          : (r.subSubSeller?.name ?? r.subSeller?.name ?? "-"),
      // Full chain for a sub-sub-seller recipient, per MAPPING_DAN_SELFSERVICE_TOKO.md.
      recipientChain: r.subSubSeller ? `${r.subSubSeller.name} › ${r.subSeller?.name ?? "-"}` : null,
      expectedAmount: r.disbursement.expectedAmount,
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

    const amountMatches =
      ocr.amount != null && toCents(ocr.amount) === toCents(row.expectedAmount);
    const accountMatches =
      !row.recordedAccount || // nothing to compare against — don't block on it
      (ocr.account != null && digitsOnly(ocr.account) === digitsOnly(row.recordedAccount));
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
