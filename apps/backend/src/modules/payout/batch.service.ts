import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { payoutBatches, payoutMutations } from "../../database/schema/index.js";
import type { MarkBatchTransferredDto } from "./dto.js";

const toCents = (v: string | number | null) => Math.round(Number(v ?? 0) * 100);
const fromCents = (c: number) => (c / 100).toFixed(2);

@Injectable()
export class PayoutBatchService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

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
    return { ...batch, mutations };
  }

  /** Admin starts a fresh batch. Batches never auto-open (requirement 6.1). */
  async start(userId: string, createdByUserId: string) {
    const [row] = await this.db
      .insert(payoutBatches)
      .values({ userId, createdByUserId, status: "running" })
      .returning();
    return row;
  }

  /** Close & report to Owner: running -> awaiting_transfer. Recomputes the total
   *  the tenant must forward (sub-seller + sub-sub-seller shares). */
  async closeAndReport(userId: string, id: string) {
    const batch = await this.getOrThrow(userId, id);
    if (batch.status !== "running") {
      throw new BadRequestException(`Cannot close a batch in status "${batch.status}"`);
    }
    const muts = await this.db
      .select()
      .from(payoutMutations)
      .where(eq(payoutMutations.batchId, id));
    const totalCents = muts.reduce(
      (acc, m) => acc + toCents(m.subSellerAmount) + toCents(m.subSubSellerAmount),
      0,
    );
    const [row] = await this.db
      .update(payoutBatches)
      .set({
        status: "awaiting_transfer",
        closedAt: new Date(),
        totalTransferToAdmin: fromCents(totalCents),
        updatedAt: new Date(),
      })
      .where(and(eq(payoutBatches.id, id), eq(payoutBatches.userId, userId)))
      .returning();
    return row;
  }

  /** Owner transferred the combined amount: awaiting_transfer -> transferred. */
  async markTransferred(userId: string, id: string, dto: MarkBatchTransferredDto) {
    const batch = await this.getOrThrow(userId, id);
    if (batch.status !== "awaiting_transfer") {
      throw new BadRequestException(
        `Batch must be "awaiting_transfer" to mark transferred (is "${batch.status}")`,
      );
    }
    if (!dto.transferProofUrl) {
      throw new BadRequestException("transferProofUrl is required");
    }
    const [row] = await this.db
      .update(payoutBatches)
      .set({
        status: "transferred",
        transferProofUrl: dto.transferProofUrl,
        transferredAt: new Date(),
        updatedAt: new Date(),
      })
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
