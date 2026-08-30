import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { UploadsService } from "../uploads/uploads.service.js";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  BATCH_CODE_ALPHABET,
  payoutBatches,
  payoutCarryovers,
  payoutMutations,
  payoutDisbursements,
  payoutSettings,
  shops,
  subSellers,
  subSubSellers,
} from "../../database/schema/index.js";
import { DisbursementsService } from "./disbursements.service.js";

import { susunPesan, type JenisPesan } from "./payout-wa.js";
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
    // Ditaruh terakhir supaya pemanggil yang sudah ada tidak bergeser
    // argumennya. Dipakai untuk menyidik jari isi bukti fee: unggahan ulang
    // gambar yang sama selalu mendapat nama berbeda.
    private readonly uploads: UploadsService,
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

  /**
   * Teks pesan WhatsApp sebuah batch, sudah jadi.
   *
   * Disusun di SERVER, bukan di masing-masing layar. Sebelum ini web dan APK
   * menyusunnya sendiri-sendiri dengan alasan yang masuk akal saat itu:
   * datanya memang sudah ada di kedua layar. Begitu isinya bisa disetel
   * pemiliknya, alasan itu berbalik -- template yang tersimpan di satu tempat
   * tapi dirender dua penyusun berbeda akan menghasilkan dua pesan berbeda,
   * dan bedanya baru ketahuan setelah terkirim ke orang lain.
   */
  async waText(userId: string, id: string, jenis: JenisPesan): Promise<{ teks: string }> {
    const batch = (await this.get(userId, id)) as unknown as Parameters<
      typeof susunPesan
    >[0]["batch"];

    // Nama toko diambil di sini supaya pemanggilnya tidak perlu tahu apa pun
    // selain id batch -- layar mana pun, termasuk yang belum memuat daftar
    // toko, tetap bisa meminta pesannya.
    const daftar = await this.db
      .select({ id: shops.id, nama: shops.shopName, tampil: shops.displayName })
      .from(shops)
      .where(eq(shops.userId, userId));
    const namaToko = new Map(daftar.map((s) => [s.id, s.nama ?? s.tampil ?? ""]));

    const [setelan] = await this.db
      .select({
        seller: payoutSettings.waTemplateSeller,
        sub: payoutSettings.waTemplateSubSeller,
      })
      .from(payoutSettings)
      .where(eq(payoutSettings.userId, userId))
      .limit(1);

    return {
      teks: susunPesan({
        jenis,
        batch,
        namaToko,
        baseUrl: process.env.APP_URL ?? "https://viewtoko.cosger.online",
        template: jenis === "seller" ? setelan?.seller : setelan?.sub,
      }),
    };
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
    return { ...batch, mutations, disbursements, carryovers: await this.carryoversOf(userId, id) };
  }

  /**
   * One five-character code, checked against the ones already taken.
   *
   * Random rather than sequential: a running number leaks how many batches a
   * tenant has ever opened, and more practically it would have to be derived
   * from a count that two simultaneous starts would read identically.
   *
   * The unique index is what actually guarantees it — this loop only avoids
   * the collision, and the insert below still retries if one slips through
   * between the read and the write.
   */
  private async nextCode(userId: string): Promise<string> {
    const taken = new Set(
      (
        await this.db
          .select({ code: payoutBatches.code })
          .from(payoutBatches)
          .where(eq(payoutBatches.userId, userId))
      )
        .map((r) => r.code?.toUpperCase())
        .filter((c): c is string => c != null),
    );
    const A = BATCH_CODE_ALPHABET;
    for (let attempt = 0; attempt < 200; attempt++) {
      const bytes = randomBytes(3);
      let code = "";
      // Always upper case: the index compares case-insensitively, so writing
      // mixed case would only make two spellings of one code readable.
      for (let i = 0; i < 3; i++) code += A[bytes[i]! % A.length];
      if (!taken.has(code)) return code;
    }
    // 24 million combinations against a handful of batches: getting here means
    // something is wrong with the generator, not that the space filled up.
    throw new ConflictException("Tidak bisa membuat kode batch yang unik.");
  }

  /**
   * Catat bukti transfer fee admin batch ini.
   *
   * Satu batch satu fee, jadi mengunggah lagi menimpa yang sebelumnya --
   * bukan menambah baris. Yang dijaga adalah buktinya: gambar yang sama tidak
   * boleh dipakai untuk dua batch, dibandingkan lewat isi berkasnya karena
   * unggahan ulang selalu mendapat nama yang berbeda.
   */
  async setAdminFeeProof(userId: string, id: string, proofUrl: string) {
    const batch = await this.getOrThrow(userId, id);
    if (batch.adminFeeAmount == null) {
      throw new BadRequestException(
        "Batch ini tidak punya fee admin — fiturnya belum aktif saat batch dibuat.",
      );
    }

    const hash = await this.uploads.hashOfUrl(proofUrl);
    if (hash) {
      const bentrok = await this.db
        .select({ id: payoutBatches.id, code: payoutBatches.code })
        .from(payoutBatches)
        .where(
          and(
            eq(payoutBatches.userId, userId),
            eq(payoutBatches.adminFeeProofHash, hash),
          ),
        );
      const lain = bentrok.filter((r) => r.id !== id);
      if (lain.length) {
        throw new ConflictException({
          code: "DUPLICATE_FEE_PROOF",
          message:
            `Bukti ini sudah dipakai untuk fee batch #${lain[0]!.code ?? ""}. ` +
            "Satu bukti hanya untuk satu batch — unggah bukti transfer batch ini.",
        });
      }
    }

    const [row] = await this.db
      .update(payoutBatches)
      .set({
        adminFeeProofUrl: proofUrl,
        adminFeeProofHash: hash,
        adminFeePaidAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(payoutBatches.id, id), eq(payoutBatches.userId, userId)))
      .returning();
    return row;
  }

  /** Batalkan bukti fee — untuk gambar yang salah unggah. */
  async clearAdminFeeProof(userId: string, id: string) {
    await this.getOrThrow(userId, id);
    const [row] = await this.db
      .update(payoutBatches)
      .set({
        adminFeeProofUrl: null,
        adminFeeProofHash: null,
        adminFeePaidAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(payoutBatches.id, id), eq(payoutBatches.userId, userId)))
      .returning();
    return row;
  }

  /**
   * Money this batch held back, and money it brought forward.
   *
   * Without this the page cannot explain itself. The header adds up what was
   * CALCULATED for every shop; step 2 lists what will actually be TRANSFERRED
   * now, and the two differ by exactly the amounts that fell under the
   * minimum transfer and are waiting for the next batch. Seeing two totals
   * disagree with nothing to account for the gap reads as a broken sum — it
   * was reported as one — when it is the rule working.
   *
   * Both directions are returned because both move the total: amounts held
   * back make step 2 smaller than the header, and amounts carried in from an
   * earlier batch make it larger.
   */
  private async carryoversOf(userId: string, batchId: string) {
    const rows = await this.db
      .select({
        id: payoutCarryovers.id,
        recipientType: payoutCarryovers.recipientType,
        amount: payoutCarryovers.amount,
        sourceBatchId: payoutCarryovers.sourceBatchId,
        appliedBatchId: payoutCarryovers.appliedBatchId,
        subSellerId: payoutCarryovers.recipientSubSellerId,
        subSubSellerId: payoutCarryovers.recipientSubSubSellerId,
        createdAt: payoutCarryovers.createdAt,
      })
      .from(payoutCarryovers)
      .where(
        and(
          eq(payoutCarryovers.userId, userId),
          or(
            eq(payoutCarryovers.sourceBatchId, batchId),
            eq(payoutCarryovers.appliedBatchId, batchId),
          ),
        ),
      );

    // Names, so the page can say WHOSE money is waiting rather than only how
    // much — "sedekah" and "sub-seller" are not answers when there are three.
    const subIds = [...new Set(rows.map((r) => r.subSellerId).filter(Boolean))] as string[];
    const subSubIds = [...new Set(rows.map((r) => r.subSubSellerId).filter(Boolean))] as string[];
    const [subs, subSubs] = await Promise.all([
      subIds.length
        ? this.db.select().from(subSellers).where(inArray(subSellers.id, subIds))
        : Promise.resolve([]),
      subSubIds.length
        ? this.db.select().from(subSubSellers).where(inArray(subSubSellers.id, subSubIds))
        : Promise.resolve([]),
    ]);
    const namaSub = new Map(subs.map((s) => [s.id, s.name]));
    const namaSubSub = new Map(subSubs.map((s) => [s.id, s.name]));

    const label = (r: (typeof rows)[number]) =>
      r.subSellerId
        ? (namaSub.get(r.subSellerId) ?? "Sub-seller")
        : r.subSubSellerId
          ? (namaSubSub.get(r.subSubSellerId) ?? "Sub-sub-seller")
          : r.recipientType === "sedekah"
            ? "Sedekah"
            : r.recipientType === "bahan_baku"
              ? "Bahan baku"
              : String(r.recipientType);

    // A row whose source AND destination are this same batch was held and
    // released inside it: it moves nothing, and counting it as brought-in
    // while ignoring it as held made the arithmetic overshoot by its amount.
    const lewat = (r: (typeof rows)[number]) =>
      r.sourceBatchId === batchId && r.appliedBatchId === batchId;

    return {
      /**
       * Held back by this batch — why step 2 is smaller than the header.
       *
       * Deliberately NOT limited to rows still waiting. Once the money is
       * finally paid out in a later batch the row gains an appliedBatchId, but
       * from THIS batch's point of view it was still money that did not go out
       * here, and a closed batch has to stay explainable afterwards.
       */
      held: rows
        .filter((r) => r.sourceBatchId === batchId && !lewat(r))
        .map((r) => ({
          ...r,
          name: label(r),
          amount: Number(r.amount),
          /** Already paid out in a later batch, rather than still waiting. */
          sudahDibayar: r.appliedBatchId != null,
        })),
      /** Brought forward INTO this batch — why step 2 can be larger. */
      applied: rows
        .filter((r) => r.appliedBatchId === batchId && !lewat(r))
        .map((r) => ({ ...r, name: label(r), amount: Number(r.amount) })),
    };
  }

  /** Admin/Staff starts a fresh batch. Batches never auto-open (Bagian 1). */
  async start(userId: string, createdByUserId: string) {
    // Fee yang berlaku SEKARANG, direkam ke batch. Kalau fitur ini mati,
    // kolomnya dibiarkan kosong -- itu yang membedakan "batch tanpa fee" dari
    // "batch dengan fee nol", dan keduanya bukan hal yang sama.
    const [setelan] = await this.db
      .select({
        aktif: payoutSettings.adminFeeEnabled,
        nominal: payoutSettings.adminFeeAmount,
      })
      .from(payoutSettings)
      .where(eq(payoutSettings.userId, userId))
      .limit(1);
    const feeBatch = setelan?.aktif ? setelan.nominal : null;
    // Retried because the uniqueness lives in the index, not in the check
    // above: two batches started in the same instant can read the same "taken"
    // set and pick the same code, and only one insert will survive.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const [row] = await this.db
          .insert(payoutBatches)
          .values({
            userId,
            createdByUserId,
            status: "berjalan",
            code: await this.nextCode(userId),
            adminFeeAmount: feeBatch,
          })
          .returning();
        return row;
      } catch (e) {
        const msg = (e as Error).message ?? "";
        if (!msg.includes("payout_batches_code_idx")) throw e;
      }
    }
    throw new ConflictException("Gagal membuat batch — kode selalu bentrok.");
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
