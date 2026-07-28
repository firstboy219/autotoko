import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql, eq, and } from "drizzle-orm";
import * as schema from "../../database/schema/index.js";
import { PayoutSellersService } from "./sellers.service.js";
import { PayoutBatchService } from "./batch.service.js";
import { PayoutMutationService } from "./mutation.service.js";
import { DisbursementsService } from "./disbursements.service.js";
import type { OcrExtractResult } from "./ocr.service.js";

const DB_URL = process.env.E2E_DATABASE_URL;

// Deterministic stand-in for OcrService — real Tesseract accuracy is covered
// by its own dedicated smoke tests (Task 3); this spec validates the BUSINESS
// LOGIC around an OCR result (match -> cocok_otomatis, mismatch -> tidak_cocok
// -> override), which needs a controllable result, not a real image read.
class FakeOcr {
  next: OcrExtractResult = { amount: null, account: null, raw: null };
  async extractProofFields(): Promise<OcrExtractResult> {
    return this.next;
  }
}

(DB_URL ? describe : describe.skip)("payout v2 full batch lifecycle (e2e)", () => {
  const client = postgres(DB_URL!, { max: 1 });
  const db = drizzle(client, { schema }) as never;
  const USER = "00000000-0000-4000-8000-0000000000c3";

  const ocr = new FakeOcr();
  const sellers = new PayoutSellersService(db);
  const disbursements = new DisbursementsService(db, ocr as never);
  const batches = new PayoutBatchService(db, disbursements);
  const mutations = new PayoutMutationService(db);

  async function makeShop(name: string) {
    const [s] = await (db as ReturnType<typeof drizzle>)
      .insert(schema.shops)
      .values({ userId: USER, marketplace: "tiktok", shopId: `v2-${name}-${Date.now()}`, shopName: name })
      .returning();
    return s!.id as string;
  }

  beforeAll(async () => {
    await (db as ReturnType<typeof drizzle>).execute(sql`select set_config('app.user_id', ${USER}, false)`);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.users)
      .values({ id: USER, email: `v2lifecycle-${Date.now()}@test.local`, fullName: "V2 Tenant" })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await (db as ReturnType<typeof drizzle>).delete(schema.users).where(eq(schema.users.id, USER));
    await client.end();
  });

  it("runs berjalan -> siap_distribusi -> selesai across scenarios A/B/C with OCR match/mismatch/override", async () => {
    await sellers.updateSettings(USER, { sedekahRate: 0.05, sedekahBasis: "total_credit" });
    const sub = await sellers.createSubSeller(USER, { name: "Budi", defaultRate: 0.2, bankAccount: "BCA-111" });
    const subsub = await sellers.createSubSubSeller(USER, {
      subSellerId: sub!.id, name: "Citra", defaultRate: 0.5, bankAccount: "BCA-222",
    });

    const shopA = await makeShop("A");
    const shopB = await makeShop("B");
    const shopC = await makeShop("C");
    await sellers.assignShop(USER, shopB, { subSellerId: sub!.id });
    await sellers.assignShop(USER, shopC, { subSellerId: sub!.id, subSubSellerId: subsub!.id });

    // --- berjalan: record all three shops ---
    const batch = await batches.start(USER, USER);
    expect(batch!.status).toBe("berjalan");

    const mA = await mutations.create(USER, USER, { batchId: batch!.id, shopId: shopA, payoutDate: "2026-07-01", marketplaceProofAmount: 1_000_000 });
    const mB = await mutations.create(USER, USER, { batchId: batch!.id, shopId: shopB, payoutDate: "2026-07-01", marketplaceProofAmount: 1_000_000 });
    const mC = await mutations.create(USER, USER, { batchId: batch!.id, shopId: shopC, payoutDate: "2026-07-01", marketplaceProofAmount: 1_000_000 });
    expect(Number(mC!.sedekahAmount)).toBe(50_000);
    expect(Number(mC!.sellerAmount)).toBe(760_000);
    expect(Number(mC!.subSellerAmount)).toBe(95_000);
    expect(Number(mC!.subSubSellerAmount)).toBe(95_000);
    void mA; void mB;

    // Not all shops need recording — batch may still close-input with a subset
    // (already exercised elsewhere); here all three are recorded deliberately
    // to cover every recipientType in one batch.

    // --- Tahap 2: close-input generates the disbursement rekap ---
    const closed = await batches.closeInput(USER, batch!.id);
    expect(closed!.status).toBe("siap_distribusi");

    const rows = await disbursements.listForBatch(USER, batch!.id);
    // A: sedekah only. B: sedekah + sub_seller. C: sedekah + sub_seller + sub_sub_seller.
    expect(rows.length).toBe(1 + 2 + 3);
    const forC = rows.filter((r) => r.payoutMutationId === mC!.id);
    const subSellerRowC = forC.find((r) => r.recipientType === "sub_seller")!;
    const subSubRowC = forC.find((r) => r.recipientType === "sub_sub_seller")!;
    // Snapshot accounts taken from entity master data at generation time.
    expect(subSellerRowC.recordedAccount).toBe("BCA-111");
    expect(subSubRowC.recordedAccount).toBe("BCA-222");
    expect(Number(subSellerRowC.expectedAmount)).toBe(95_000);
    expect(Number(subSubRowC.expectedAmount)).toBe(95_000);

    // Mutations are now locked.
    await expect(mutations.update(USER, mA!.id, { marketplaceProofAmount: 1 })).rejects.toThrow();

    // --- Tutup Batch must fail — nothing validated yet ---
    await expect(batches.closeBatch(USER, batch!.id)).rejects.toThrow(/belum tervalidasi/);

    // --- Tahap 3: upload proofs. Rig OCR to MATCH for the sedekah rows ---
    for (const r of rows.filter((x) => x.recipientType === "sedekah")) {
      ocr.next = { amount: Number(r.expectedAmount), account: r.recordedAccount, raw: null };
      const updated = await disbursements.uploadProof(USER, r.id, { proofUrl: "https://x/sedekah.jpg" });
      expect(updated!.validationStatus).toBe("cocok_otomatis");
    }

    // sub_seller row on B: rig a MISMATCH, then override.
    const subSellerRowB = rows.find((r) => r.payoutMutationId === mB!.id && r.recipientType === "sub_seller")!;
    ocr.next = { amount: 1, account: "wrong-account", raw: null }; // deliberately wrong
    const mismatched = await disbursements.uploadProof(USER, subSellerRowB.id, { proofUrl: "https://x/b-sub.jpg" });
    expect(mismatched!.validationStatus).toBe("tidak_cocok");
    await expect(disbursements.override(USER, subSellerRowB.id, { reason: "" })).rejects.toThrow(); // reason required
    const overridden = await disbursements.override(USER, subSellerRowB.id, { reason: "Sudah dicek manual, benar" });
    expect(overridden!.validationStatus).toBe("override_manual");

    // Remaining C-shop rows (sub_seller, sub_sub_seller): match exactly.
    ocr.next = { amount: Number(subSellerRowC.expectedAmount), account: subSellerRowC.recordedAccount, raw: null };
    await disbursements.uploadProof(USER, subSellerRowC.id, { proofUrl: "https://x/c-sub.jpg" });
    ocr.next = { amount: Number(subSubRowC.expectedAmount), account: subSubRowC.recordedAccount, raw: null };
    await disbursements.uploadProof(USER, subSubRowC.id, { proofUrl: "https://x/c-subsub.jpg" });

    // --- Tutup Batch now succeeds ---
    const done = await batches.closeBatch(USER, batch!.id);
    expect(done!.status).toBe("selesai");

    // Adjustment against a locked mutation still works post-completion.
    const adj = await mutations.createAdjustment(USER, USER, {
      mutationId: mC!.id, amount: -1000, reason: "koreksi kecil",
    });
    expect(Number(adj!.amount)).toBe(-1000);
  });

  it("rejects closing input on an empty batch", async () => {
    const batch = await batches.start(USER, USER);
    await expect(batches.closeInput(USER, batch!.id)).rejects.toThrow();
  });
});
