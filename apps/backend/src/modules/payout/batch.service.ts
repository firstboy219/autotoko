import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  payoutBatches,
  payoutCarryovers,
  payoutMutations,
  payoutDisbursements,
  payoutSettings,
  subSellers,
  subSubSellers,
} from "../../database/schema/index.js";
import { DisbursementsService } from "./disbursements.service.js";

const toCents = (v: string | number | null) => Math.round(Number(v ?? 0) * 100);

/** Used when a tenant has no settings row yet. Banks refuse less than this. */
const DEFAULT_MIN_TRANSFER_CENTS = 1_000_000;

/**
 * One payable party. sedekah and bahan_baku have no id — there is one of each
 * per tenant — so the key falls back to the type alone.
 */
function recipientKey(
  type: string,
  subSellerId?: string | null,
  subSubSellerId?: string | null,
): string {
  return `${type}:${subSellerId ?? subSubSellerId ?? ""}`;
}

@Injectable()
export class PayoutBatchService {
  private readonly logger = new Logger(PayoutBatchService.name);

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
   * shop and generates the disbursement rekap — one row per
   * sub-seller/sub-sub-seller recipient PER MUTATION (shops owned that way),
   * plus exactly ONE consolidated sedekah row for the whole batch (summing
   * every mutation's sedekah share) since sedekah is transferred once, not
   * once per shop. Does NOT require every active shop to have been recorded —
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
    let sedekahTotalCents = 0;
    let materialTotalCents = 0;

    /**
     * One entry per party owed money, summed across every shop in the batch.
     *
     * Per person, not per shop, because that is who the bank transfer goes to.
     * A sub-seller holding three shops used to get three separate transfers to
     * the same account — three fees, three proofs — and each one was measured
     * against the bank's minimum on its own.
     */
    const owed = new Map<
      string,
      {
        type: "sub_seller" | "sub_sub_seller";
        subSellerId?: string;
        subSubSellerId?: string;
        cents: number;
        account: string | null;
      }
    >();

    for (const m of mutations) {
      sedekahTotalCents += toCents(m.sedekahAmount);
      materialTotalCents += toCents(m.sellerMaterialAmount);

      if (m.subSellerId && toCents(m.subSellerAmount) > 0) {
        const key = recipientKey("sub_seller", m.subSellerId);
        const at = owed.get(key) ?? {
          type: "sub_seller" as const,
          subSellerId: m.subSellerId,
          cents: 0,
          account: subById.get(m.subSellerId)?.bankAccount ?? null,
        };
        at.cents += toCents(m.subSellerAmount);
        owed.set(key, at);
      }
      if (m.subSubSellerId && toCents(m.subSubSellerAmount) > 0) {
        const key = recipientKey("sub_sub_seller", null, m.subSubSellerId);
        const at = owed.get(key) ?? {
          type: "sub_sub_seller" as const,
          subSubSellerId: m.subSubSellerId,
          cents: 0,
          account: subSubById.get(m.subSubSellerId)?.bankAccount ?? null,
        };
        at.cents += toCents(m.subSubSellerAmount);
        owed.set(key, at);
      }
    }

    // Everything payable, in one shape, so the minimum and the held-over
    // balance are applied by exactly one piece of code.
    const payables: {
      key: string;
      type: "sedekah" | "bahan_baku" | "sub_seller" | "sub_sub_seller";
      subSellerId?: string;
      subSubSellerId?: string;
      cents: number;
      account: string | null;
    }[] = [
      {
        key: recipientKey("sedekah"),
        type: "sedekah",
        cents: sedekahTotalCents,
        account: settings?.sedekahBankAccount ?? null,
      },
      {
        key: recipientKey("bahan_baku"),
        type: "bahan_baku",
        cents: materialTotalCents,
        account: settings?.materialBankAccount ?? null,
      },
      ...[...owed.entries()].map(([key, o]) => ({
        key,
        type: o.type,
        subSellerId: o.subSellerId,
        subSubSellerId: o.subSubSellerId,
        cents: o.cents,
        account: o.account,
      })),
    ];

    const minCents = settings?.minTransferAmount
      ? toCents(settings.minTransferAmount)
      : DEFAULT_MIN_TRANSFER_CENTS;

    // What earlier batches could not send. Read before anything is written so
    // a transaction abort cannot leave half of it marked as paid.
    const held = await this.db
      .select()
      .from(payoutCarryovers)
      .where(and(eq(payoutCarryovers.userId, userId), isNull(payoutCarryovers.appliedAt)));
    const heldByKey = new Map<string, typeof held>();
    for (const h of held) {
      const key = recipientKey(h.recipientType, h.recipientSubSellerId, h.recipientSubSubSellerId);
      heldByKey.set(key, [...(heldByKey.get(key) ?? []), h]);
    }

    const consumedCarryoverIds: string[] = [];
    const newCarryovers: (typeof payoutCarryovers.$inferInsert)[] = [];

    for (const p of payables) {
      const waiting = heldByKey.get(p.key) ?? [];
      const heldCents = waiting.reduce((n, h) => n + toCents(h.amount), 0);
      const total = p.cents + heldCents;
      if (total === 0) continue;

      if (total >= minCents) {
        toInsert.push({
          batchId: id,
          userId,
          recipientType: p.type,
          recipientSubSellerId: p.subSellerId ?? null,
          recipientSubSubSellerId: p.subSubSellerId ?? null,
          expectedAmount: (total / 100).toFixed(2),
          carryoverAmount: (heldCents / 100).toFixed(2),
          recordedAccount: p.account,
        });
        consumedCarryoverIds.push(...waiting.map((h) => h.id));
      } else if (p.cents > 0) {
        // Under the bank's floor. No transfer is generated and the amount
        // waits — held against the person, so it keeps growing until it is
        // worth sending. Anything already waiting stays where it is.
        newCarryovers.push({
          userId,
          recipientType: p.type,
          recipientSubSellerId: p.subSellerId ?? null,
          recipientSubSubSellerId: p.subSubSellerId ?? null,
          amount: (p.cents / 100).toFixed(2),
          sourceBatchId: id,
        });
      }
    }

    if (toInsert.length) {
      await this.db.insert(payoutDisbursements).values(toInsert);
    }
    if (newCarryovers.length) {
      await this.db.insert(payoutCarryovers).values(newCarryovers);
    }
    if (consumedCarryoverIds.length) {
      await this.db
        .update(payoutCarryovers)
        .set({ appliedBatchId: id, appliedAt: new Date() })
        .where(inArray(payoutCarryovers.id, consumedCarryoverIds));
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
  /**
   * Step 2 back to step 1.
   *
   * closeInput does real work — it writes a transfer row per recipient and
   * marks every mutation completed — so going back has to undo it rather than
   * just flipping the status, or the next close would append a second set of
   * transfers beside the first.
   *
   * Refuses by default when any transfer already carries proof or has been
   * validated, and says exactly which: that evidence was uploaded by hand and
   * deleting it silently to satisfy a "back" button would be the worst kind of
   * helpfulness. `force` is the caller stating they accept losing it, which
   * the page asks for in as many words.
   */
  async reopenInput(userId: string, id: string, force = false) {
    const batch = await this.getOrThrow(userId, id);
    if (batch.status === "berjalan") return batch;
    if (batch.status !== "siap_distribusi") {
      throw new BadRequestException(
        `Batch sudah "${batch.status}" — hanya batch di tahap Transfer & Bukti yang bisa dikembalikan.`,
      );
    }

    const rows = await this.disbursements.listForBatch(userId, id);
    const withWork = rows.filter(
      (r) => r.proofUrl != null || r.validationStatus !== "belum_upload",
    );
    if (withWork.length && !force) {
      throw new ConflictException({
        code: "HAS_PROOF",
        message:
          `${withWork.length} transfer sudah punya bukti/validasi. ` +
          "Kembali ke step 1 akan menghapusnya.",
        affected: withWork.length,
      });
    }

    await this.db
      .delete(payoutDisbursements)
      .where(
        and(
          eq(payoutDisbursements.userId, userId),
          or(
            eq(payoutDisbursements.batchId, id),
            inArray(
              payoutDisbursements.payoutMutationId,
              this.db
                .select({ id: payoutMutations.id })
                .from(payoutMutations)
                .where(eq(payoutMutations.batchId, id)),
            ),
          ),
        ),
      );

    // Put the held money back exactly as it was. A batch that generated
    // held-over amounts loses them, and one that consumed somebody else's
    // returns them to waiting — otherwise reopening a batch would either
    // invent a debt or quietly settle one that was never transferred.
    await this.releaseCarryoversOf(userId, id);

    await this.db
      .update(payoutMutations)
      .set({ status: "draft", updatedAt: new Date() })
      .where(eq(payoutMutations.batchId, id));

    const [row] = await this.db
      .update(payoutBatches)
      .set({ status: "berjalan", closedAt: null, updatedAt: new Date() })
      .where(and(eq(payoutBatches.id, id), eq(payoutBatches.userId, userId)))
      .returning();
    this.logger.log(`Batch ${id} reopened for input (${withWork.length} proofs discarded)`);
    return row;
  }

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

  /**
   * Cancel/delete a batch that has not reached "selesai" (Tutup Batch) yet.
   * Hard-deletes the batch row; FK cascades remove its mutations and any
   * disbursements generated by closeInput() along with it. Once a batch is
   * "selesai" it is a closed financial record and must not be deletable.
   */
  async cancel(userId: string, id: string) {
    const batch = await this.getOrThrow(userId, id);
    if (batch.status === "selesai") {
      throw new BadRequestException("Batch sudah ditutup — tidak bisa dibatalkan/dihapus");
    }
    // Amounts this batch created go with it (the payouts behind them are
    // about to stop existing); amounts it merely paid out go back to waiting.
    // The foreign key would null the link but leave applied_at set, which
    // would read as "already sent" for money nobody sent.
    await this.releaseCarryoversOf(userId, id);
    await this.db
      .delete(payoutBatches)
      .where(and(eq(payoutBatches.id, id), eq(payoutBatches.userId, userId)));
    return { id, deleted: true };
  }

  /**
   * Undo one batch's effect on the held-over balances.
   *
   * Deletes what it created and un-applies what it consumed. Deliberately not
   * relying on the foreign keys: ON DELETE SET NULL would clear the link but
   * leave applied_at set, and money marked sent that nobody sent is the worst
   * of the possible wrong answers.
   */
  private async releaseCarryoversOf(userId: string, batchId: string): Promise<void> {
    await this.db
      .delete(payoutCarryovers)
      .where(
        and(eq(payoutCarryovers.userId, userId), eq(payoutCarryovers.sourceBatchId, batchId)),
      );
    await this.db
      .update(payoutCarryovers)
      .set({ appliedBatchId: null, appliedAt: null })
      .where(
        and(eq(payoutCarryovers.userId, userId), eq(payoutCarryovers.appliedBatchId, batchId)),
      );
  }

  /** Everything still waiting to be sent, newest first. */
  async listCarryovers(userId: string) {
    const rows = await this.db
      .select({
        id: payoutCarryovers.id,
        recipientType: payoutCarryovers.recipientType,
        subSellerId: payoutCarryovers.recipientSubSellerId,
        subSubSellerId: payoutCarryovers.recipientSubSubSellerId,
        amount: payoutCarryovers.amount,
        sourceBatchId: payoutCarryovers.sourceBatchId,
        createdAt: payoutCarryovers.createdAt,
        subSellerName: subSellers.name,
        subSubSellerName: subSubSellers.name,
      })
      .from(payoutCarryovers)
      .leftJoin(subSellers, eq(payoutCarryovers.recipientSubSellerId, subSellers.id))
      .leftJoin(subSubSellers, eq(payoutCarryovers.recipientSubSubSellerId, subSubSellers.id))
      .where(and(eq(payoutCarryovers.userId, userId), isNull(payoutCarryovers.appliedAt)))
      .orderBy(desc(payoutCarryovers.createdAt));

    const byKey = new Map<string, { name: string; type: string; amount: number; ids: string[]; since: Date }>();
    for (const r of rows) {
      const key = recipientKey(r.recipientType, r.subSellerId, r.subSubSellerId);
      const name =
        r.subSubSellerName ??
        r.subSellerName ??
        (r.recipientType === "sedekah" ? "Sedekah" : "Bahan Baku");
      const at = byKey.get(key) ?? {
        name,
        type: r.recipientType,
        amount: 0,
        ids: [] as string[],
        since: r.createdAt,
      };
      at.amount += Number(r.amount);
      at.ids.push(r.id);
      if (r.createdAt < at.since) at.since = r.createdAt;
      byKey.set(key, at);
    }
    return [...byKey.values()].sort((a, b) => b.amount - a.amount);
  }

  /**
   * Send a held amount now, regardless of the minimum.
   *
   * The escape hatch for money that will never grow — a sub-seller who stops
   * selling would otherwise be owed a few thousand rupiah forever, with no way
   * to close it from inside the system. Attached to a batch because a transfer
   * needs somewhere to hang its proof.
   */
  async releaseCarryovers(userId: string, batchId: string, ids: string[]) {
    const batch = await this.getOrThrow(userId, batchId);
    if (batch.status !== "siap_distribusi") {
      throw new BadRequestException(
        "Sisa hanya bisa dicairkan dari batch yang sedang di tahap Transfer & Bukti.",
      );
    }
    if (!ids.length) throw new BadRequestException("Tidak ada sisa yang dipilih.");

    const rows = await this.db
      .select()
      .from(payoutCarryovers)
      .where(
        and(
          eq(payoutCarryovers.userId, userId),
          isNull(payoutCarryovers.appliedAt),
          inArray(payoutCarryovers.id, ids),
        ),
      );
    if (!rows.length) throw new NotFoundException("Sisa tidak ditemukan atau sudah dicairkan.");

    const subs = await this.db.select().from(subSellers).where(eq(subSellers.userId, userId));
    const subsubs = await this.db
      .select()
      .from(subSubSellers)
      .where(eq(subSubSellers.userId, userId));
    const subById = new Map(subs.map((s) => [s.id, s]));
    const subSubById = new Map(subsubs.map((s) => [s.id, s]));
    const [settings] = await this.db
      .select()
      .from(payoutSettings)
      .where(eq(payoutSettings.userId, userId))
      .limit(1);

    // One transfer per recipient, even when several held amounts are released
    // together: they all go to the same account.
    const grouped = new Map<string, { rows: typeof rows; cents: number }>();
    for (const r of rows) {
      const key = recipientKey(r.recipientType, r.recipientSubSellerId, r.recipientSubSubSellerId);
      const at = grouped.get(key) ?? { rows: [] as typeof rows, cents: 0 };
      at.rows.push(r);
      at.cents += toCents(r.amount);
      grouped.set(key, at);
    }

    const toInsert: (typeof payoutDisbursements.$inferInsert)[] = [];
    for (const g of grouped.values()) {
      const first = g.rows[0]!;
      const account =
        first.recipientType === "sedekah"
          ? (settings?.sedekahBankAccount ?? null)
          : first.recipientType === "bahan_baku"
            ? (settings?.materialBankAccount ?? null)
            : first.recipientSubSubSellerId
              ? (subSubById.get(first.recipientSubSubSellerId)?.bankAccount ?? null)
              : (subById.get(first.recipientSubSellerId ?? "")?.bankAccount ?? null);
      toInsert.push({
        batchId,
        userId,
        recipientType: first.recipientType,
        recipientSubSellerId: first.recipientSubSellerId,
        recipientSubSubSellerId: first.recipientSubSubSellerId,
        expectedAmount: (g.cents / 100).toFixed(2),
        carryoverAmount: (g.cents / 100).toFixed(2),
        recordedAccount: account,
      });
    }
    await this.db.insert(payoutDisbursements).values(toInsert);
    await this.db
      .update(payoutCarryovers)
      .set({ appliedBatchId: batchId, appliedAt: new Date() })
      .where(inArray(payoutCarryovers.id, rows.map((r) => r.id)));

    this.logger.log(`Released ${rows.length} held amount(s) into batch ${batchId}`);
    return { released: rows.length, transfers: toInsert.length };
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
