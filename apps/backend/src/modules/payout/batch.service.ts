import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  payoutBatches,
  payoutMutations,
  payoutDisbursements,
  payoutSettings,
  subSellers,
  subSubSellers,
} from "../../database/schema/index.js";
import { DisbursementsService } from "./disbursements.service.js";

const toCents = (v: string | number | null) => Math.round(Number(v ?? 0) * 100);

@Injectable()
export class PayoutBatchService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly disbursements: DisbursementsService,
  ) {}

  async list(userId: string, status?: string) {
    const where = status
      ? and(eq(payoutBatches.userId, userId), eq(payoutBatches.status, status as never))
      : eq(payoutBatches.userId, userId);
    return this.db
      .select()
      .from(payoutBatches)
      .where(where)
      .orderBy(desc(payoutBatches.createdAt));
  }

  async get(userId: string, id: string) {
    const batch = await this.getOrThrow(userId, id);
    const mutations = await this.db
      .select()
      .from(payoutMutations)
      .where(eq(payoutMutations.batchId, id))
      .orderBy(desc(payoutMutations.createdAt));
    // The transfer rekap only exists once input has closed (Tahap 2+).
    const disbursements =
      batch.status === "berjalan" ? [] : await this.disbursements.listForBatch(userId, id);
    return { ...batch, mutations, disbursements };
  }

  /** Admin/Staff starts a fresh batch. Batches never auto-open (Bagian 1). */
  async start(userId: string, createdByUserId: string) {
    const [row] = await this.db
      .insert(payoutBatches)
      .values({ userId, createdByUserId, status: "berjalan" })
      .returning();
    return row;
  }

  /**
   * "Selesai Pencairan Semua Toko" (Tahap 2): locks input for every recorded
   * shop and generates one payout_disbursements row per recipient with a
   * share > 0 (sedekah always; sub-seller/sub-sub-seller only for shops owned
   * that way). Does NOT require every active shop to have been recorded —
   * staff may process a subset per batch (Bagian 1, explicit).
   */
  async closeInput(userId: string, id: string) {
    const batch = await this.getOrThrow(userId, id);
    if (batch.status !== "berjalan") {
      throw new BadRequestException(`Batch is not open for input (status: ${batch.status})`);
    }

    const mutations = await this.db
      .select()
      .from(payoutMutations)
      .where(eq(payoutMutations.batchId, id));
    if (!mutations.length) {
      throw new BadRequestException("Record at least one shop's pencairan before closing input");
    }

    const [settings] = await this.db
      .select()
      .from(payoutSettings)
      .where(eq(payoutSettings.userId, userId))
      .limit(1);

    const subSellerIds = [...new Set(mutations.map((m) => m.subSellerId).filter(Boolean))] as string[];
    const subSubSellerIds = [
      ...new Set(mutations.map((m) => m.subSubSellerId).filter(Boolean)),
    ] as string[];
    const subs = subSellerIds.length
      ? await this.db.select().from(subSellers).where(inArray(subSellers.id, subSellerIds))
      : [];
    const subsubs = subSubSellerIds.length
      ? await this.db.select().from(subSubSellers).where(inArray(subSubSellers.id, subSubSellerIds))
      : [];
    const subById = new Map(subs.map((s) => [s.id, s]));
    const subSubById = new Map(subsubs.map((s) => [s.id, s]));

    const toInsert: (typeof payoutDisbursements.$inferInsert)[] = [];
    for (const m of mutations) {
      if (toCents(m.sedekahAmount) > 0) {
        toInsert.push({
          payoutMutationId: m.id,
          userId,
          recipientType: "sedekah",
          expectedAmount: m.sedekahAmount,
          recordedAccount: settings?.sedekahBankAccount ?? null,
        });
      }
      if (m.subSellerId && toCents(m.subSellerAmount) > 0) {
        toInsert.push({
          payoutMutationId: m.id,
          userId,
          recipientType: "sub_seller",
          recipientSubSellerId: m.subSellerId,
          expectedAmount: m.subSellerAmount!,
          recordedAccount: subById.get(m.subSellerId)?.bankAccount ?? null,
        });
      }
      if (m.subSubSellerId && toCents(m.subSubSellerAmount) > 0) {
        toInsert.push({
          payoutMutationId: m.id,
          userId,
          recipientType: "sub_sub_seller",
          recipientSubSubSellerId: m.subSubSellerId,
          expectedAmount: m.subSubSellerAmount!,
          recordedAccount: subSubById.get(m.subSubSellerId)?.bankAccount ?? null,
        });
      }
    }

    if (toInsert.length) {
      await this.db.insert(payoutDisbursements).values(toInsert);
    }
    await this.db
      .update(payoutMutations)
      .set({ status: "completed", updatedAt: new Date() })
      .where(eq(payoutMutations.batchId, id));

    const [row] = await this.db
      .update(payoutBatches)
      .set({ status: "siap_distribusi", closedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(payoutBatches.id, id), eq(payoutBatches.userId, userId)))
      .returning();
    return row;
  }

  /** "Tutup Batch" (Tahap 4): only once every disbursement is validated or overridden. */
  async closeBatch(userId: string, id: string) {
    const batch = await this.getOrThrow(userId, id);
    if (batch.status !== "siap_distribusi") {
      throw new BadRequestException(
        `Batch must be "siap_distribusi" to close (is "${batch.status}")`,
      );
    }
    const rows = await this.disbursements.listForBatch(userId, id);
    const notReady = rows.filter(
      (r) => r.validationStatus !== "cocok_otomatis" && r.validationStatus !== "override_manual",
    );
    if (notReady.length) {
      throw new BadRequestException(
        `${notReady.length} transfer belum tervalidasi/di-override — upload atau override dulu sebelum menutup batch`,
      );
    }

    const [row] = await this.db
      .update(payoutBatches)
      .set({ status: "selesai", completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(payoutBatches.id, id), eq(payoutBatches.userId, userId)))
      .returning();
    return row;
  }

  private async getOrThrow(userId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(payoutBatches)
      .where(and(eq(payoutBatches.id, id), eq(payoutBatches.userId, userId)))
      .limit(1);
    if (!row) throw new NotFoundException("Batch not found");
    return row;
  }
}
