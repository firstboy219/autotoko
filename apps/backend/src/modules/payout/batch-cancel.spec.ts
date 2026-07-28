import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql, eq } from "drizzle-orm";
import * as schema from "../../database/schema/index.js";
import { PayoutSellersService } from "./sellers.service.js";
import { PayoutBatchService } from "./batch.service.js";
import { PayoutMutationService } from "./mutation.service.js";
import { DisbursementsService } from "./disbursements.service.js";
import type { OcrExtractResult } from "./ocr.service.js";

const DB_URL = process.env.E2E_DATABASE_URL;

class FakeOcr {
  next: OcrExtractResult = { amount: null, account: null, raw: null };
  async extractProofFields(): Promise<OcrExtractResult> {
    return this.next;
  }
}

(DB_URL ? describe : describe.skip)("batch cancel/delete (e2e)", () => {
  const client = postgres(DB_URL!, { max: 1 });
  const db = drizzle(client, { schema }) as never;
  const USER = "00000000-0000-4000-8000-0000000000c5";

  const ocr = new FakeOcr();
  const sellers = new PayoutSellersService(db);
  const disbursements = new DisbursementsService(db, ocr as never);
  const batches = new PayoutBatchService(db, disbursements);
  const mutations = new PayoutMutationService(db);

  async function makeShop(name: string) {
    const [s] = await (db as ReturnType<typeof drizzle>)
      .insert(schema.shops)
      .values({ userId: USER, marketplace: "tiktok", shopId: `cancel-${name}-${Date.now()}`, shopName: name })
      .returning();
    return s!.id as string;
  }

  beforeAll(async () => {
    await (db as ReturnType<typeof drizzle>).execute(sql`select set_config('app.user_id', ${USER}, false)`);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.users)
      .values({ id: USER, email: `batchcancel-e2e-${Date.now()}@test.local`, fullName: "Batch Cancel Tenant" })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await (db as ReturnType<typeof drizzle>).delete(schema.users).where(eq(schema.users.id, USER));
    await client.end();
  });

  it("cancels a 'berjalan' batch, cascading away its mutations", async () => {
    const shop = await makeShop("Berjalan");
    const batch = await batches.start(USER, USER);
    const m = await mutations.create(USER, USER, {
      batchId: batch!.id, shopId: shop, payoutDate: "2026-07-01", marketplaceProofAmount: 500_000,
    });

    await batches.cancel(USER, batch!.id);

    const [gone] = await (db as ReturnType<typeof drizzle>)
      .select().from(schema.payoutBatches).where(eq(schema.payoutBatches.id, batch!.id));
    expect(gone).toBeUndefined();
    const [mgone] = await (db as ReturnType<typeof drizzle>)
      .select().from(schema.payoutMutations).where(eq(schema.payoutMutations.id, m!.id));
    expect(mgone).toBeUndefined();
  });

  it("cancels a 'siap_distribusi' batch, cascading away its mutations AND generated disbursements", async () => {
    const shop = await makeShop("SiapDistribusi");
    const batch = await batches.start(USER, USER);
    const m = await mutations.create(USER, USER, {
      batchId: batch!.id, shopId: shop, payoutDate: "2026-07-01", marketplaceProofAmount: 500_000,
    });
    const closed = await batches.closeInput(USER, batch!.id);
    expect(closed!.status).toBe("siap_distribusi");
    const rows = await disbursements.listForBatch(USER, batch!.id);
    expect(rows.length).toBeGreaterThan(0);

    await batches.cancel(USER, batch!.id);

    const [gone] = await (db as ReturnType<typeof drizzle>)
      .select().from(schema.payoutBatches).where(eq(schema.payoutBatches.id, batch!.id));
    expect(gone).toBeUndefined();
    const [mgone] = await (db as ReturnType<typeof drizzle>)
      .select().from(schema.payoutMutations).where(eq(schema.payoutMutations.id, m!.id));
    expect(mgone).toBeUndefined();
    const remainingDisbursements = await (db as ReturnType<typeof drizzle>)
      .select().from(schema.payoutDisbursements).where(eq(schema.payoutDisbursements.payoutMutationId, m!.id));
    expect(remainingDisbursements.length).toBe(0);
  });

  it("refuses to cancel a 'selesai' (closed) batch", async () => {
    const shop = await makeShop("Selesai");
    const batch = await batches.start(USER, USER);
    const r = await mutations.create(USER, USER, {
      batchId: batch!.id, shopId: shop, payoutDate: "2026-07-01", marketplaceProofAmount: 100_000,
    });
    void r;
    await batches.closeInput(USER, batch!.id);
    const rows = await disbursements.listForBatch(USER, batch!.id);
    for (const row of rows) {
      ocr.next = { amount: Number(row.expectedAmount), account: row.recordedAccount, raw: null };
      await disbursements.uploadProof(USER, row.id, { proofUrl: "https://x/proof.jpg" });
    }
    const done = await batches.closeBatch(USER, batch!.id);
    expect(done!.status).toBe("selesai");

    await expect(batches.cancel(USER, batch!.id)).rejects.toThrow(/sudah ditutup/);

    const [stillThere] = await (db as ReturnType<typeof drizzle>)
      .select().from(schema.payoutBatches).where(eq(schema.payoutBatches.id, batch!.id));
    expect(stillThere).toBeDefined();
  });
});
