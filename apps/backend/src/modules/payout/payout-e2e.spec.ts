/**
 * TAHAP 5 — end-to-end integration test for the payout module.
 *
 * Runs the real services against a real Postgres (the isolated autotoko_e2e DB),
 * WITH RLS on: it sets app.user_id on the connection so every query goes through
 * the tenant_isolation policy exactly as a live request would. No HTTP, no cron.
 *
 * Skipped unless E2E_DATABASE_URL is set (so the normal `pnpm test` stays unit-only).
 */
import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql, eq } from "drizzle-orm";
import * as schema from "../../database/schema/index.js";
import { PayoutSellersService } from "./sellers.service.js";
import { PayoutBatchService } from "./batch.service.js";
import { PayoutMutationService } from "./mutation.service.js";

const URL = process.env.E2E_DATABASE_URL;
const rupiah = (n: number) => n; // amounts asserted in rupiah

(URL ? describe : describe.skip)("payout e2e", () => {
  const client = postgres(URL!, { max: 1 });
  const db = drizzle(client, { schema }) as never;
  const USER = "00000000-0000-4000-8000-0000000000e2";

  const sellers = new PayoutSellersService(db);
  const batches = new PayoutBatchService(db);
  const mutations = new PayoutMutationService(db);

  async function makeShop(name: string) {
    const [s] = await (db as ReturnType<typeof drizzle>)
      .insert(schema.shops)
      .values({ userId: USER, marketplace: "tiktok", shopId: `e2e-${name}-${Date.now()}`, shopName: name })
      .returning();
    return s!.id as string;
  }

  beforeAll(async () => {
    // Enter this tenant's RLS context, then seed the user row (id = app.user_id
    // satisfies the users policy).
    await (db as ReturnType<typeof drizzle>).execute(sql`select set_config('app.user_id', ${USER}, false)`);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.users)
      .values({ id: USER, email: `e2e-${Date.now()}@test.local`, fullName: "E2E Tenant" })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    // Cascade wipes shops + all payout rows for this tenant.
    await (db as ReturnType<typeof drizzle>).delete(schema.users).where(eq(schema.users.id, USER));
    await client.end();
  });

  it("runs the full payout lifecycle across scenarios A, B and C", async () => {
    // Settings: 5% sedekah, basis total_credit
    await sellers.updateSettings(USER, { sedekahRate: 0.05, sedekahBasis: "total_credit" });

    // Hierarchy: sub-seller 20%, sub-sub-seller 50%
    const sub = await sellers.createSubSeller(USER, { name: "Budi", defaultRate: 0.2 });
    const subsub = await sellers.createSubSubSeller(USER, {
      subSellerId: sub!.id,
      name: "Citra",
      defaultRate: 0.5,
    });

    // Three shops → one per scenario
    const shopA = await makeShop("A");
    const shopB = await makeShop("B");
    const shopC = await makeShop("C");
    await sellers.assignShop(USER, shopB, { subSellerId: sub!.id });
    await sellers.assignShop(USER, shopC, { subSellerId: sub!.id, subSubSellerId: subsub!.id });

    // Batch + three mutations, credit 1,000,000 each
    const batch = await batches.start(USER, USER);
    const mA = await mutations.create(USER, USER, { batchId: batch!.id, shopId: shopA, payoutDate: "2026-07-01", creditAmount: 1_000_000 });
    const mB = await mutations.create(USER, USER, { batchId: batch!.id, shopId: shopB, payoutDate: "2026-07-01", creditAmount: 1_000_000 });
    const mC = await mutations.create(USER, USER, { batchId: batch!.id, shopId: shopC, payoutDate: "2026-07-01", creditAmount: 1_000_000 });

    // Scenario A: sedekah 50k, seller 950k
    expect(Number(mA!.sedekahAmount)).toBe(rupiah(50_000));
    expect(Number(mA!.sellerAmount)).toBe(rupiah(950_000));
    expect(mA!.subSellerAmount).toBeNull();

    // Scenario B: sedekah 50k, sub 190k, seller 760k
    expect(Number(mB!.sedekahAmount)).toBe(rupiah(50_000));
    expect(Number(mB!.subSellerAmount)).toBe(rupiah(190_000));
    expect(Number(mB!.sellerAmount)).toBe(rupiah(760_000));

    // Scenario C (the Bagian 4.3 example): 50k / 760k / 95k / 95k
    expect(Number(mC!.sedekahAmount)).toBe(rupiah(50_000));
    expect(Number(mC!.sellerAmount)).toBe(rupiah(760_000));
    expect(Number(mC!.subSellerAmount)).toBe(rupiah(95_000));
    expect(Number(mC!.subSubSellerAmount)).toBe(rupiah(95_000));

    // Completing without required proof is rejected...
    await expect(mutations.complete(USER, mC!.id, {})).rejects.toThrow();
    // ...and accepted once every paying party has a proof URL.
    const completed = await mutations.complete(USER, mC!.id, {
      marketplaceProofUrl: "https://r2/mp.jpg",
      sedekahTransferProofUrl: "https://r2/sedekah.jpg",
      subSellerTransferProofUrl: "https://r2/sub.jpg",
      subSubSellerTransferProofUrl: "https://r2/subsub.jpg",
    });
    expect(completed!.status).toBe("completed");

    // A completed mutation is locked to direct edits.
    await expect(mutations.update(USER, mC!.id, { creditAmount: 5 })).rejects.toThrow();

    // Adjustment references the original without mutating it.
    const adj = await mutations.createAdjustment(USER, USER, { mutationId: mC!.id, amount: -1000, reason: "koreksi ongkir" });
    expect(Number(adj!.amount)).toBe(-1000);

    // Complete A and B too (A has no outgoing party besides sedekah).
    await mutations.complete(USER, mA!.id, { marketplaceProofUrl: "https://r2/a.jpg", sedekahTransferProofUrl: "https://r2/a-sed.jpg" });
    await mutations.complete(USER, mB!.id, {
      marketplaceProofUrl: "https://r2/b.jpg",
      sedekahTransferProofUrl: "https://r2/b-sed.jpg",
      subSellerTransferProofUrl: "https://r2/b-sub.jpg",
    });

    // Close & report: total to forward = B(190k) + C(95k+95k) = 380k
    const closed = await batches.closeAndReport(USER, batch!.id);
    expect(closed!.status).toBe("awaiting_transfer");
    expect(Number(closed!.totalTransferToAdmin)).toBe(rupiah(380_000));

    // Owner transfers to Admin.
    const transferred = await batches.markTransferred(USER, batch!.id, { transferProofUrl: "https://r2/batch.jpg" });
    expect(transferred!.status).toBe("transferred");

    // Forward B and C; A has nothing to forward. Batch auto-completes.
    await mutations.markForwarded(USER, mB!.id);
    await mutations.markForwarded(USER, mC!.id);

    const finalBatch = await batches.get(USER, batch!.id);
    expect(finalBatch.status).toBe("completed");
  });

  it("enforces the hierarchy: assigning a sub-sub without a sub is rejected", async () => {
    const sub = await sellers.createSubSeller(USER, { name: "X", defaultRate: 0.2 });
    const subsub = await sellers.createSubSubSeller(USER, { subSellerId: sub!.id, name: "Y", defaultRate: 0.5 });
    const shop = await makeShop("bad");
    await expect(
      sellers.assignShop(USER, shop, { subSubSellerId: subsub!.id }),
    ).rejects.toThrow();
  });
});
