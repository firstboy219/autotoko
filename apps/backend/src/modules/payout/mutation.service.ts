import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  payoutMutations,
  payoutBatches,
  payoutAdjustments,
  payoutSettings,
  subSellers,
  subSubSellers,
  shops,
} from "../../database/schema/index.js";
import { calculatePayoutSplit, type SedekahBasis } from "@autotoko/shared";
import { UploadsService } from "../uploads/uploads.service.js";
import type {
  CreateMutationDto,
  UpdateMutationDto,
  ListMutationQueryDto,
  CreateAdjustmentDto,
} from "./dto.js";

const toCents = (v: string | number | null) => Math.round(Number(v ?? 0) * 100);
const fromCents = (c: number) => (c / 100).toFixed(2);

/**
 * Tahap 1 (FLOW_PENCAIRAN_V2_FINAL.md): record one pencairan per shop, freely,
 * repeated for as many shops as staff wants in this batch. The split is
 * computed here (for the real-time preview and as the authoritative figure
 * later read by batch.closeInput to generate disbursements) — v2 changes what
 * happens AFTER the split is known, not how it's computed.
 */
@Injectable()
export class PayoutMutationService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly uploads: UploadsService,
  ) {}

  /**
   * Refuse a payout that has already been recorded.
   *
   * Two ways the same withdrawal gets entered twice, and they need different
   * checks because they fail differently:
   *
   *  - THE SAME AMOUNT FOR THE SAME SHOP. Someone opens a new batch and types
   *    yesterday's figure again. Keyed on shop + amount and nothing else: the
   *    date is exactly what differs when it happens, so including it would
   *    make the check miss the case it exists for.
   *
   *  - THE SAME SCREENSHOT. Compared by the bytes, never by the url — the
   *    same file uploaded twice gets two random names, so urls would agree
   *    only when somebody pasted a link, which is not how it happens.
   *
   * A cancelled batch takes its mutations with it, so cancelling really is the
   * escape hatch: once the old row is gone there is nothing left to collide
   * with. Nothing is soft-deleted here, so no "ignore the cancelled ones"
   * clause is needed.
   */
  private async assertNotDuplicate(
    userId: string,
    shopId: string,
    creditAmount: string,
    proofUrl: string | null | undefined,
    exceptId?: string,
  ) {
    const sama = await this.db
      .select({
        id: payoutMutations.id,
        batchId: payoutMutations.batchId,
        payoutDate: payoutMutations.payoutDate,
        amount: payoutMutations.creditAmount,
      })
      .from(payoutMutations)
      .where(
        and(
          eq(payoutMutations.userId, userId),
          eq(payoutMutations.shopId, shopId),
          eq(payoutMutations.creditAmount, creditAmount),
        ),
      );
    const bentrok = sama.filter((r) => r.id !== exceptId);
    if (bentrok.length) {
      const r = bentrok[0]!;
      throw new ConflictException({
        code: "DUPLICATE_PAYOUT",
        message:
          `Toko ini sudah pernah dicairkan sebesar ${creditAmount} pada ` +
          `${r.payoutDate}. Kalau pencairan itu keliru, batalkan dulu batch-nya; ` +
          `kalau memang pencairan yang berbeda, ubah nominalnya agar sesuai bukti.`,
        existingBatchId: r.batchId,
        existingDate: r.payoutDate,
      });
    }

    if (!proofUrl) return null;
    const hash = await this.uploads.hashOfUrl(proofUrl);
    if (!hash) return null;

    const samaBukti = await this.db
      .select({
        id: payoutMutations.id,
        batchId: payoutMutations.batchId,
        payoutDate: payoutMutations.payoutDate,
      })
      .from(payoutMutations)
      .where(
        and(
          eq(payoutMutations.userId, userId),
          eq(payoutMutations.marketplaceProofHash, hash),
        ),
      );
    const bentrokBukti = samaBukti.filter((r) => r.id !== exceptId);
    if (bentrokBukti.length) {
      const r = bentrokBukti[0]!;
      throw new ConflictException({
        code: "DUPLICATE_PROOF",
        message:
          `Screenshot ini sudah dipakai untuk pencairan tanggal ${r.payoutDate}. ` +
          `Satu bukti hanya boleh dipakai sekali — unggah screenshot pencairan ` +
          `yang ini.`,
        existingBatchId: r.batchId,
        existingDate: r.payoutDate,
      });
    }
    return hash;
  }

  async list(userId: string, q: ListMutationQueryDto) {
    const conds = [eq(payoutMutations.userId, userId)];
    if (q.batchId) conds.push(eq(payoutMutations.batchId, q.batchId));
    if (q.shopId) conds.push(eq(payoutMutations.shopId, q.shopId));
    if (q.status) conds.push(eq(payoutMutations.status, q.status));
    if (q.from) conds.push(gte(payoutMutations.payoutDate, q.from));
    if (q.to) conds.push(lte(payoutMutations.payoutDate, q.to));
    return this.db
      .select()
      .from(payoutMutations)
      .where(and(...conds))
      .orderBy(desc(payoutMutations.payoutDate));
  }

  async create(userId: string, createdByUserId: string, dto: CreateMutationDto) {
    const batch = await this.requireOpenBatch(userId, dto.batchId);

    const [shop] = await this.db
      .select()
      .from(shops)
      .where(and(eq(shops.id, dto.shopId), eq(shops.userId, userId)))
      .limit(1);
    if (!shop) throw new NotFoundException("Shop not found");

    const settings = await this.ensureSettings(userId);
    const rates = await this.resolveRates(userId, shop);
    // The split basis IS the marketplace proof amount now (no more separate
    // "Nominal Kredit" input — the user merged the two, per their own request).
    const creditCents = toCents(dto.marketplaceProofAmount);

    // Before anything is written or any split computed: a payout already on
    // record must not be recorded twice.
    const proofHash = await this.assertNotDuplicate(
      userId,
      dto.shopId,
      dto.marketplaceProofAmount.toFixed(2),
      dto.marketplaceProofUrl,
    );

    const materialReserveRate = Number(settings.materialReserveRate ?? 0);
    const split = calculatePayoutSplit({
      creditCents,
      sedekahRate: Number(settings.sedekahRate),
      sedekahBasis: settings.sedekahBasis as SedekahBasis,
      subSellerRate: rates.subSellerRate,
      subSubSellerRate: rates.subSubSellerRate,
      materialReserveRate,
    });

    const [row] = await this.db
      .insert(payoutMutations)
      .values({
        batchId: dto.batchId,
        userId,
        shopId: dto.shopId,
        payoutDate: dto.payoutDate,
        creditAmount: dto.marketplaceProofAmount.toFixed(2),
        marketplaceProofAmount: dto.marketplaceProofAmount.toFixed(2),
        marketplaceProofHash: proofHash,
        // Snapshot of what OCR originally suggested — comparing this against
        // the final marketplaceProofAmount above (set once, here, never on
        // update) is the OCR-correction signal for future tuning.
        ocrSuggestedAmount:
          dto.ocrSuggestedAmount != null ? dto.ocrSuggestedAmount.toFixed(2) : null,
        receivingAccount: dto.receivingAccount ?? null,
        marketplaceProofUrl: dto.marketplaceProofUrl ?? null,
        // Snapshots — later rate edits must not change this record.
        sedekahRateUsed: settings.sedekahRate,
        sedekahBasisUsed: settings.sedekahBasis,
        materialReserveRateUsed: materialReserveRate.toFixed(4),
        subSellerRateUsed: rates.subSellerRate != null ? rates.subSellerRate.toFixed(4) : null,
        subSubSellerRateUsed:
          rates.subSubSellerRate != null ? rates.subSubSellerRate.toFixed(4) : null,
        subSellerId: shop.subSellerId,
        subSubSellerId: shop.subSubSellerId,
        sedekahAmount: fromCents(split.sedekahCents),
        sellerAmount: fromCents(split.sellerCents),
        sellerMaterialAmount: fromCents(split.sellerMaterialCents),
        subSellerAmount: shop.subSellerId ? fromCents(split.subSellerCents) : null,
        subSubSellerAmount: shop.subSubSellerId ? fromCents(split.subSubSellerCents) : null,
        orderRefIds: dto.orderRefIds ?? null,
        note: dto.note ?? null,
        status: "draft",
        createdByUserId,
      })
      .returning();
    void batch;
    return row;
  }

  /**
   * Recomputes every mutation in a batch from TODAY's settings and each shop's
   * current rates.
   *
   * Lives here rather than in the batch service because this is the same
   * resolveRates + calculatePayoutSplit path used when a mutation is first
   * recorded; a second copy over there would be free to drift from it.
   *
   * The split is normally frozen per mutation precisely so a rate change never
   * restates a batch behind the operator's back. This is the deliberate
   * opposite — they changed something and are asking for it to be applied — so
   * it is refused once a batch has left the recording step, where transfers
   * are already being made against the old figures.
   */
  async recalculateBatch(userId: string, batchId: string) {
    const [batch] = await this.db
      .select()
      .from(payoutBatches)
      .where(and(eq(payoutBatches.id, batchId), eq(payoutBatches.userId, userId)))
      .limit(1);
    if (!batch) throw new NotFoundException("Batch tidak ditemukan.");
    if (batch.status !== "berjalan") {
      throw new BadRequestException(
        "Hitung ulang hanya bisa saat batch masih di tahap Rekam Pencairan.",
      );
    }

    const settings = await this.ensureSettings(userId);
    const materialReserveRate = Number(settings.materialReserveRate ?? 0);
    const mutations = await this.db
      .select()
      .from(payoutMutations)
      .where(eq(payoutMutations.batchId, batchId));

    let changed = 0;
    for (const mut of mutations) {
      const [shop] = await this.db
        .select()
        .from(shops)
        .where(and(eq(shops.id, mut.shopId), eq(shops.userId, userId)))
        .limit(1);
      if (!shop) continue;

      const rates = await this.resolveRates(userId, shop);
      const split = calculatePayoutSplit({
        creditCents: toCents(mut.creditAmount),
        sedekahRate: Number(settings.sedekahRate),
        sedekahBasis: settings.sedekahBasis as SedekahBasis,
        subSellerRate: rates.subSellerRate,
        subSubSellerRate: rates.subSubSellerRate,
        materialReserveRate,
      });

      const next = {
        sedekahAmount: fromCents(split.sedekahCents),
        sellerAmount: fromCents(split.sellerCents),
        sellerMaterialAmount: fromCents(split.sellerMaterialCents),
        subSellerAmount: shop.subSellerId ? fromCents(split.subSellerCents) : null,
        subSubSellerAmount: shop.subSubSellerId ? fromCents(split.subSubSellerCents) : null,
      };
      const differs =
        next.sedekahAmount !== mut.sedekahAmount ||
        next.sellerAmount !== mut.sellerAmount ||
        next.sellerMaterialAmount !== mut.sellerMaterialAmount ||
        next.subSellerAmount !== mut.subSellerAmount ||
        next.subSubSellerAmount !== mut.subSubSellerAmount;
      if (!differs) continue;

      await this.db
        .update(payoutMutations)
        .set({
          ...next,
          // The snapshots move with the amounts, or a later edit would
          // recompute from rates that never produced these figures.
          sedekahRateUsed: settings.sedekahRate,
          sedekahBasisUsed: settings.sedekahBasis,
          subSellerRateUsed: rates.subSellerRate != null ? rates.subSellerRate.toFixed(4) : null,
          subSubSellerRateUsed:
            rates.subSubSellerRate != null ? rates.subSubSellerRate.toFixed(4) : null,
          materialReserveRateUsed: materialReserveRate.toFixed(4),
          subSellerId: shop.subSellerId,
          subSubSellerId: shop.subSubSellerId,
          updatedAt: new Date(),
        })
        .where(eq(payoutMutations.id, mut.id));
      changed += 1;
    }

    return { ok: true as const, total: mutations.length, changed };
  }

  async update(userId: string, id: string, dto: UpdateMutationDto) {
    const mut = await this.getOrThrow(userId, id);
    await this.requireOpenBatch(userId, mut.batchId);

    // Recompute the split from the SNAPSHOT rates when the amount changes, so a
    // draft edit stays internally consistent without re-reading current settings.
    // marketplaceProofAmount is now the sole basis; ocrSuggestedAmount is a
    // create()-time-only snapshot and is never touched here.
    const proofAmount = dto.marketplaceProofAmount ?? Number(mut.marketplaceProofAmount);

    // Editing can create the same collision as recording — a figure corrected
    // into one that already exists elsewhere is the same double entry, just
    // arrived at differently. The row being edited is excluded from its own check.
    const proofHash = await this.assertNotDuplicate(
      userId,
      mut.shopId,
      proofAmount.toFixed(2),
      dto.marketplaceProofUrl ?? mut.marketplaceProofUrl,
      mut.id,
    );
    const split = calculatePayoutSplit({
      creditCents: toCents(proofAmount),
      sedekahRate: Number(mut.sedekahRateUsed),
      sedekahBasis: mut.sedekahBasisUsed as SedekahBasis,
      subSellerRate: mut.subSellerRateUsed != null ? Number(mut.subSellerRateUsed) : null,
      subSubSellerRate:
        mut.subSubSellerRateUsed != null ? Number(mut.subSubSellerRateUsed) : null,
      // From the row, not from settings: editing an old mutation must not pull
      // in a rate the seller changed afterwards.
      materialReserveRate: Number(mut.materialReserveRateUsed ?? 0),
    });

    const [row] = await this.db
      .update(payoutMutations)
      .set({
        ...(proofHash != null ? { marketplaceProofHash: proofHash } : {}),
        ...(dto.payoutDate != null ? { payoutDate: dto.payoutDate } : {}),
        creditAmount: proofAmount.toFixed(2),
        marketplaceProofAmount: proofAmount.toFixed(2),
        ...(dto.receivingAccount != null ? { receivingAccount: dto.receivingAccount } : {}),
        ...(dto.marketplaceProofUrl != null
          ? { marketplaceProofUrl: dto.marketplaceProofUrl }
          : {}),
        ...(dto.orderRefIds != null ? { orderRefIds: dto.orderRefIds } : {}),
        ...(dto.note != null ? { note: dto.note } : {}),
        sedekahAmount: fromCents(split.sedekahCents),
        sellerAmount: fromCents(split.sellerCents),
        sellerMaterialAmount: fromCents(split.sellerMaterialCents),
        subSellerAmount: mut.subSellerId ? fromCents(split.subSellerCents) : null,
        subSubSellerAmount: mut.subSubSellerId ? fromCents(split.subSubSellerCents) : null,
        updatedAt: new Date(),
      })
      .where(and(eq(payoutMutations.id, id), eq(payoutMutations.userId, userId)))
      .returning();
    return row;
  }

  async remove(userId: string, id: string) {
    const mut = await this.getOrThrow(userId, id);
    await this.requireOpenBatch(userId, mut.batchId);
    await this.db
      .delete(payoutMutations)
      .where(and(eq(payoutMutations.id, id), eq(payoutMutations.userId, userId)));
    return { deleted: true };
  }

  async createAdjustment(userId: string, createdByUserId: string, dto: CreateAdjustmentDto) {
    const mut = await this.getOrThrow(userId, dto.mutationId);
    if (mut.status !== "completed") {
      throw new BadRequestException("Only locked (input-closed) mutations can be adjusted");
    }
    const [row] = await this.db
      .insert(payoutAdjustments)
      .values({
        mutationId: dto.mutationId,
        userId,
        amount: dto.amount.toFixed(2),
        reason: dto.reason,
        createdByUserId,
      })
      .returning();
    return row;
  }

  async listAdjustments(userId: string, mutationId: string) {
    return this.db
      .select()
      .from(payoutAdjustments)
      .where(
        and(
          eq(payoutAdjustments.userId, userId),
          eq(payoutAdjustments.mutationId, mutationId),
        ),
      )
      .orderBy(desc(payoutAdjustments.createdAt));
  }

  // --- helpers ---

  private async requireOpenBatch(userId: string, batchId: string) {
    const [batch] = await this.db
      .select()
      .from(payoutBatches)
      .where(and(eq(payoutBatches.id, batchId), eq(payoutBatches.userId, userId)))
      .limit(1);
    if (!batch) throw new NotFoundException("Batch not found");
    if (batch.status !== "berjalan") {
      throw new BadRequestException(
        `Batch input is closed (status: ${batch.status}) — cannot add/edit/delete mutations`,
      );
    }
    return batch;
  }

  private async resolveRates(
    userId: string,
    shop: typeof shops.$inferSelect,
  ): Promise<{ subSellerRate: number | null; subSubSellerRate: number | null }> {
    let subSellerRate: number | null = null;
    let subSubSellerRate: number | null = null;

    if (shop.subSellerId) {
      const [ss] = await this.db
        .select()
        .from(subSellers)
        .where(and(eq(subSellers.id, shop.subSellerId), eq(subSellers.userId, userId)))
        .limit(1);
      if (!ss) throw new BadRequestException("Assigned sub-seller no longer exists");
      subSellerRate = shop.rateOverrideSubSeller != null
        ? Number(shop.rateOverrideSubSeller)
        : Number(ss.defaultRate);
    }
    if (shop.subSubSellerId) {
      const [sss] = await this.db
        .select()
        .from(subSubSellers)
        .where(
          and(eq(subSubSellers.id, shop.subSubSellerId), eq(subSubSellers.userId, userId)),
        )
        .limit(1);
      if (!sss) throw new BadRequestException("Assigned sub-sub-seller no longer exists");
      subSubSellerRate = shop.rateOverrideSubSubSeller != null
        ? Number(shop.rateOverrideSubSubSeller)
        : Number(sss.defaultRate);
    }
    return { subSellerRate, subSubSellerRate };
  }

  private async ensureSettings(userId: string) {
    const [row] = await this.db
      .select()
      .from(payoutSettings)
      .where(eq(payoutSettings.userId, userId))
      .limit(1);
    if (row) return row;
    const [created] = await this.db
      .insert(payoutSettings)
      .values({ userId })
      .returning();
    return created!;
  }

  private async getOrThrow(userId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(payoutMutations)
      .where(and(eq(payoutMutations.id, id), eq(payoutMutations.userId, userId)))
      .limit(1);
    if (!row) throw new NotFoundException("Mutation not found");
    return row;
  }
}
