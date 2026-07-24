import {
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
import { calculatePayoutSplit, type SedekahBasis } from "./payout-split.js";
import type {
  CreateMutationDto,
  UpdateMutationDto,
  CompleteMutationDto,
  ListMutationQueryDto,
  CreateAdjustmentDto,
} from "./dto.js";

const toCents = (v: string | number | null) => Math.round(Number(v ?? 0) * 100);
const fromCents = (c: number) => (c / 100).toFixed(2);
const num = (v: string | null) => (v == null ? null : Number(v));

@Injectable()
export class PayoutMutationService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

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
    // Batch must exist, belong to the tenant, and still be open for input.
    const [batch] = await this.db
      .select()
      .from(payoutBatches)
      .where(and(eq(payoutBatches.id, dto.batchId), eq(payoutBatches.userId, userId)))
      .limit(1);
    if (!batch) throw new NotFoundException("Batch not found");
    if (batch.status !== "running") {
      throw new BadRequestException("Can only add mutations to a running batch");
    }

    const [shop] = await this.db
      .select()
      .from(shops)
      .where(and(eq(shops.id, dto.shopId), eq(shops.userId, userId)))
      .limit(1);
    if (!shop) throw new NotFoundException("Shop not found");

    const settings = await this.ensureSettings(userId);
    const rates = await this.resolveRates(userId, shop);
    const creditCents = toCents(dto.creditAmount);

    const split = calculatePayoutSplit({
      creditCents,
      sedekahRate: Number(settings.sedekahRate),
      sedekahBasis: settings.sedekahBasis as SedekahBasis,
      subSellerRate: rates.subSellerRate,
      subSubSellerRate: rates.subSubSellerRate,
    });

    const [row] = await this.db
      .insert(payoutMutations)
      .values({
        batchId: dto.batchId,
        userId,
        shopId: dto.shopId,
        payoutDate: dto.payoutDate,
        creditAmount: dto.creditAmount.toFixed(2),
        marketplaceProofAmount:
          dto.marketplaceProofAmount != null ? dto.marketplaceProofAmount.toFixed(2) : null,
        receivingAccount: dto.receivingAccount ?? null,
        marketplaceProofUrl: dto.marketplaceProofUrl ?? null,
        // Snapshots — later rate edits must not change this record.
        sedekahRateUsed: settings.sedekahRate,
        sedekahBasisUsed: settings.sedekahBasis,
        subSellerRateUsed: rates.subSellerRate != null ? rates.subSellerRate.toFixed(4) : null,
        subSubSellerRateUsed:
          rates.subSubSellerRate != null ? rates.subSubSellerRate.toFixed(4) : null,
        subSellerId: shop.subSellerId,
        subSubSellerId: shop.subSubSellerId,
        // Computed shares.
        sedekahAmount: fromCents(split.sedekahCents),
        sellerAmount: fromCents(split.sellerCents),
        subSellerAmount: shop.subSellerId ? fromCents(split.subSellerCents) : null,
        subSubSellerAmount: shop.subSubSellerId ? fromCents(split.subSubSellerCents) : null,
        orderRefIds: dto.orderRefIds ?? null,
        note: dto.note ?? null,
        status: "draft",
        subSellerForwardStatus: shop.subSellerId ? "pending" : null,
        subSubSellerForwardStatus: shop.subSubSellerId ? "pending" : null,
        createdByUserId,
      })
      .returning();
    return row;
  }

  async update(userId: string, id: string, dto: UpdateMutationDto) {
    const mut = await this.getOrThrow(userId, id);
    if (mut.status !== "draft") {
      throw new BadRequestException("Only draft mutations can be edited");
    }

    // Recompute the split from the SNAPSHOT rates when the credit changes, so a
    // draft edit stays internally consistent without re-reading current settings.
    const creditAmount = dto.creditAmount ?? Number(mut.creditAmount);
    const split = calculatePayoutSplit({
      creditCents: toCents(creditAmount),
      sedekahRate: Number(mut.sedekahRateUsed),
      sedekahBasis: mut.sedekahBasisUsed as SedekahBasis,
      subSellerRate: num(mut.subSellerRateUsed),
      subSubSellerRate: num(mut.subSubSellerRateUsed),
    });

    const [row] = await this.db
      .update(payoutMutations)
      .set({
        ...(dto.payoutDate != null ? { payoutDate: dto.payoutDate } : {}),
        creditAmount: creditAmount.toFixed(2),
        ...(dto.marketplaceProofAmount != null
          ? { marketplaceProofAmount: dto.marketplaceProofAmount.toFixed(2) }
          : {}),
        ...(dto.receivingAccount != null ? { receivingAccount: dto.receivingAccount } : {}),
        ...(dto.marketplaceProofUrl != null
          ? { marketplaceProofUrl: dto.marketplaceProofUrl }
          : {}),
        ...(dto.orderRefIds != null ? { orderRefIds: dto.orderRefIds } : {}),
        ...(dto.note != null ? { note: dto.note } : {}),
        sedekahAmount: fromCents(split.sedekahCents),
        sellerAmount: fromCents(split.sellerCents),
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
    if (mut.status !== "draft") {
      throw new BadRequestException("Only draft mutations can be deleted");
    }
    await this.db
      .delete(payoutMutations)
      .where(and(eq(payoutMutations.id, id), eq(payoutMutations.userId, userId)));
    return { deleted: true };
  }

  /** draft -> completed. Validates required proofs per scenario (requirement 6.2). */
  async complete(userId: string, id: string, dto: CompleteMutationDto) {
    const mut = await this.getOrThrow(userId, id);
    if (mut.status !== "draft") {
      throw new BadRequestException("Mutation is already completed");
    }

    // Merge any proof URLs supplied on completion.
    const marketplaceProofUrl = dto.marketplaceProofUrl ?? mut.marketplaceProofUrl;
    const sedekahTransferProofUrl =
      dto.sedekahTransferProofUrl ?? mut.sedekahTransferProofUrl;
    const sellerTransferProofUrl = dto.sellerTransferProofUrl ?? mut.sellerTransferProofUrl;
    const subSellerTransferProofUrl =
      dto.subSellerTransferProofUrl ?? mut.subSellerTransferProofUrl;
    const subSubSellerTransferProofUrl =
      dto.subSubSellerTransferProofUrl ?? mut.subSubSellerTransferProofUrl;

    // marketplace proof is mandatory for every scenario, including seller-owned.
    if (!marketplaceProofUrl) {
      throw new BadRequestException("bukti_pencairan_marketplace is required");
    }
    // Outgoing-transfer proof for each party that actually receives a payout.
    // The seller's own portion stays with the tenant, so it needs no proof.
    const missing: string[] = [];
    if (toCents(mut.sedekahAmount) > 0 && !sedekahTransferProofUrl) missing.push("sedekah");
    if (toCents(mut.subSellerAmount) > 0 && !subSellerTransferProofUrl) {
      missing.push("sub-seller");
    }
    if (toCents(mut.subSubSellerAmount) > 0 && !subSubSellerTransferProofUrl) {
      missing.push("sub-sub-seller");
    }
    if (missing.length) {
      throw new BadRequestException(`Missing transfer proof for: ${missing.join(", ")}`);
    }

    const [row] = await this.db
      .update(payoutMutations)
      .set({
        status: "completed",
        marketplaceProofUrl,
        sedekahTransferProofUrl,
        sellerTransferProofUrl,
        subSellerTransferProofUrl,
        subSubSellerTransferProofUrl,
        updatedAt: new Date(),
      })
      .where(and(eq(payoutMutations.id, id), eq(payoutMutations.userId, userId)))
      .returning();
    return row;
  }

  /** Mark the sub-seller / sub-sub-seller shares of a mutation as forwarded.
   *  When every mutation in the batch is fully forwarded, the batch completes. */
  async markForwarded(userId: string, id: string) {
    const mut = await this.getOrThrow(userId, id);
    const [batch] = await this.db
      .select()
      .from(payoutBatches)
      .where(and(eq(payoutBatches.id, mut.batchId), eq(payoutBatches.userId, userId)))
      .limit(1);
    if (!batch) throw new NotFoundException("Batch not found");
    if (batch.status !== "transferred") {
      throw new BadRequestException(
        "Owner must transfer to Admin before shares can be forwarded",
      );
    }
    if (!mut.subSellerId) {
      throw new BadRequestException("This mutation has nothing to forward");
    }

    await this.db
      .update(payoutMutations)
      .set({
        subSellerForwardStatus: "forwarded",
        subSubSellerForwardStatus: mut.subSubSellerId ? "forwarded" : null,
        updatedAt: new Date(),
      })
      .where(and(eq(payoutMutations.id, id), eq(payoutMutations.userId, userId)));

    await this.maybeCompleteBatch(userId, mut.batchId);
    return this.getOrThrow(userId, id);
  }

  async createAdjustment(userId: string, createdByUserId: string, dto: CreateAdjustmentDto) {
    // The mutation being corrected must exist, belong to the tenant, and be
    // completed (draft rows are edited directly, not adjusted).
    const mut = await this.getOrThrow(userId, dto.mutationId);
    if (mut.status !== "completed") {
      throw new BadRequestException("Only completed mutations can be adjusted");
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

  private async maybeCompleteBatch(userId: string, batchId: string) {
    const muts = await this.db
      .select()
      .from(payoutMutations)
      .where(eq(payoutMutations.batchId, batchId));
    const pending = muts.some(
      (m) => m.subSellerId && m.subSellerForwardStatus !== "forwarded",
    );
    if (!pending) {
      await this.db
        .update(payoutBatches)
        .set({ status: "completed", updatedAt: new Date() })
        .where(and(eq(payoutBatches.id, batchId), eq(payoutBatches.userId, userId)));
    }
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
      subSellerRate = num(shop.rateOverrideSubSeller) ?? Number(ss.defaultRate);
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
      subSubSellerRate = num(shop.rateOverrideSubSubSeller) ?? Number(sss.defaultRate);
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
