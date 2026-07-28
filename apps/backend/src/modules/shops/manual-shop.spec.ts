import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql, eq, and } from "drizzle-orm";
import { JwtService } from "@nestjs/jwt";
import * as schema from "../../database/schema/index.js";
import { ShopsService } from "./shops.service.js";
import type { ConnectResult } from "@autotoko/shared";

const DB_URL = process.env.E2E_DATABASE_URL;

const fakeCrypto = { encrypt: (s: string) => `enc:${s}`, decrypt: (s: string) => s.replace(/^enc:/, "") };
let shopCounter = 0;
const fakeAdapter = {
  getAuthUrl: async (state: string) => `https://marketplace.example/authorize?state=${state}`,
  exchangeToken: async (): Promise<ConnectResult> => {
    shopCounter++;
    return {
      shopId: `real-${shopCounter}`,
      shopName: `Toko Nyata ${shopCounter}`,
      accessToken: "at",
      accessTokenExpireAt: Math.floor(Date.now() / 1000) + 3600,
      refreshToken: "rt",
      refreshTokenExpireAt: Math.floor(Date.now() / 1000) + 86400,
    };
  },
};
const fakeMarketplace = { getAuthAdapter: () => fakeAdapter };

(DB_URL ? describe : describe.skip)("manual-first placeholder shops (e2e)", () => {
  const client = postgres(DB_URL!, { max: 1 });
  const db = drizzle(client, { schema }) as never;
  const USER = "00000000-0000-4000-8000-0000000000d4";
  const jwt = new JwtService({ secret: "test-secret" });
  const shopsService = new ShopsService(db, fakeMarketplace as never, fakeCrypto as never, jwt);

  beforeAll(async () => {
    await (db as ReturnType<typeof drizzle>).execute(sql`select set_config('app.user_id', ${USER}, false)`);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.users)
      .values({ id: USER, email: `manualshop-e2e-${Date.now()}@test.local`, fullName: "Manual Shop Tenant" })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await (db as ReturnType<typeof drizzle>).delete(schema.users).where(eq(schema.users.id, USER));
    await client.end();
  });

  it("creates a placeholder, connects it in place (no duplicate), then rejects reconnecting", async () => {
    const placeholder = await shopsService.addManualShop(USER, "tiktok", "Toko Rencana Bulan Depan");
    expect(placeholder!.shopId.startsWith("manual-")).toBe(true);
    expect(placeholder!.connectedAt).toBeNull();

    const before = await (db as ReturnType<typeof drizzle>)
      .select({ id: schema.shops.id })
      .from(schema.shops)
      .where(eq(schema.shops.userId, USER));
    const countBefore = before.length;

    const { authUrl } = await shopsService.getConnectUrl(USER, "tiktok", {
      placeholderShopId: placeholder!.id,
    });
    const state = new URL(authUrl).searchParams.get("state")!;
    const result = await shopsService.handleCallback("tiktok", { state, code: "c-manual" });

    // Same row, now filled in with the real connection — not a new row.
    const [row] = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(schema.shops)
      .where(eq(schema.shops.id, placeholder!.id));
    expect(row!.shopId).toBe(result.shopId);
    expect(row!.shopId.startsWith("manual-")).toBe(false);
    expect(row!.connectedAt).not.toBeNull();
    expect(row!.shopStatus).toBe("active");

    const after = await (db as ReturnType<typeof drizzle>)
      .select({ id: schema.shops.id })
      .from(schema.shops)
      .where(eq(schema.shops.userId, USER));
    expect(after.length).toBe(countBefore); // no duplicate row created

    // Trying to connect the SAME placeholder again (now already connected) must fail.
    await expect(
      shopsService.getConnectUrl(USER, "tiktok", { placeholderShopId: placeholder!.id }),
    ).rejects.toThrow(/sudah terhubung/);
  });

  it("hard-deletes an unused placeholder via disconnect(), but soft-disconnects a real connection", async () => {
    const placeholder = await shopsService.addManualShop(USER, "shopee", "Belum Dihubungkan");
    const del = await shopsService.disconnect(USER, placeholder!.id);
    expect(del.shopStatus).toBe("deleted");
    const [gone] = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(schema.shops)
      .where(eq(schema.shops.id, placeholder!.id));
    expect(gone).toBeUndefined(); // actually removed, not just marked

    // A REAL connection must still be soft-disconnected (row kept), unchanged behavior.
    const placeholder2 = await shopsService.addManualShop(USER, "shopee", "Akan Dihubungkan");
    const { authUrl } = await shopsService.getConnectUrl(USER, "shopee", {
      placeholderShopId: placeholder2!.id,
    });
    const state = new URL(authUrl).searchParams.get("state")!;
    await shopsService.handleCallback("shopee", { state, code: "c-real" });

    const soft = await shopsService.disconnect(USER, placeholder2!.id);
    expect(soft.shopStatus).toBe("disconnected");
    const [stillThere] = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(schema.shops)
      .where(eq(schema.shops.id, placeholder2!.id));
    expect(stillThere).toBeDefined(); // row kept, just marked disconnected
  });

  it("refuses to delete a placeholder that a payout mutation already references", async () => {
    const placeholder = await shopsService.addManualShop(USER, "tiktok", "Dipakai di Mutasi");
    const [settings] = await (db as ReturnType<typeof drizzle>)
      .insert(schema.payoutSettings)
      .values({ userId: USER })
      .onConflictDoNothing()
      .returning();
    void settings;
    const [batch] = await (db as ReturnType<typeof drizzle>)
      .insert(schema.payoutBatches)
      .values({ userId: USER, createdByUserId: USER, status: "berjalan" })
      .returning();
    await (db as ReturnType<typeof drizzle>).insert(schema.payoutMutations).values({
      batchId: batch!.id,
      userId: USER,
      shopId: placeholder!.id,
      payoutDate: "2026-07-01",
      creditAmount: "100000",
      marketplaceProofAmount: "100000",
      sedekahRateUsed: "0.0500",
      sedekahBasisUsed: "total_credit",
      sedekahAmount: "5000",
      sellerAmount: "95000",
      status: "draft",
    });

    await expect(shopsService.disconnect(USER, placeholder!.id)).rejects.toThrow(/riwayat pencairan/);
  });
});
