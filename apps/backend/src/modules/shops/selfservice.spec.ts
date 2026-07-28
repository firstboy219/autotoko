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

// Minimal stand-ins — ShopsService only calls .getAuthAdapter()/.encrypt()/.decrypt(),
// never anything else on these, so a loose fake is enough for this test.
const fakeCrypto = { encrypt: (s: string) => `enc:${s}`, decrypt: (s: string) => s.replace(/^enc:/, "") };
let shopCounter = 0;
const fakeAdapter = {
  getAuthUrl: async (state: string) => `https://marketplace.example/authorize?state=${state}`,
  exchangeToken: async (): Promise<ConnectResult> => {
    shopCounter++;
    return {
      shopId: `shop-${shopCounter}`,
      shopName: `Toko ${shopCounter}`,
      accessToken: "at",
      accessTokenExpireAt: Math.floor(Date.now() / 1000) + 3600,
      refreshToken: "rt",
      refreshTokenExpireAt: Math.floor(Date.now() / 1000) + 86400,
    };
  },
};
const fakeMarketplace = { getAuthAdapter: () => fakeAdapter };

(DB_URL ? describe : describe.skip)("self-service shop connect (e2e)", () => {
  const client = postgres(DB_URL!, { max: 1 });
  const db = drizzle(client, { schema }) as never;
  const USER = "00000000-0000-4000-8000-0000000000b2";
  const jwt = new JwtService({ secret: "test-secret" });
  const shopsService = new ShopsService(db, fakeMarketplace as never, fakeCrypto as never, jwt);

  beforeAll(async () => {
    await (db as ReturnType<typeof drizzle>).execute(sql`select set_config('app.user_id', ${USER}, false)`);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.users)
      .values({ id: USER, email: `selfservice-e2e-${Date.now()}@test.local`, fullName: "Self-service Tenant" })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await (db as ReturnType<typeof drizzle>).delete(schema.users).where(eq(schema.users.id, USER));
    await client.end();
  });

  it("auto-assigns ownership to the connecting sub-seller and enforces the quota", async () => {
    const [sub] = await (db as ReturnType<typeof drizzle>)
      .insert(schema.subSellers)
      .values({ userId: USER, name: "Budi", defaultRate: "0.2000", kuotaTokoMaksimal: 2 })
      .returning();

    // Shop 1: connect succeeds and is auto-assigned to this sub-seller.
    const { authUrl: url1 } = await shopsService.getConnectUrl(USER, "tiktok", {
      principal: { type: "sub_seller", id: sub!.id },
    });
    const state1 = new URL(url1).searchParams.get("state")!;
    const r1 = await shopsService.handleCallback("tiktok", { state: state1, code: "c1" });

    const [row1] = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(schema.shops)
      .where(and(eq(schema.shops.userId, USER), eq(schema.shops.shopId, r1.shopId)));
    expect(row1!.subSellerId).toBe(sub!.id);
    expect(row1!.addedByType).toBe("sub_seller");
    expect(row1!.addedById).toBe(sub!.id);

    // Shop 2: also succeeds (kuota = 2).
    const { authUrl: url2 } = await shopsService.getConnectUrl(USER, "tiktok", {
      principal: { type: "sub_seller", id: sub!.id },
    });
    const state2 = new URL(url2).searchParams.get("state")!;
    await shopsService.handleCallback("tiktok", { state: state2, code: "c2" });

    // Shop 3: kuota is now full — must be rejected, and NOT persisted at all.
    const { authUrl: url3 } = await shopsService.getConnectUrl(USER, "tiktok", {
      principal: { type: "sub_seller", id: sub!.id },
    });
    const state3 = new URL(url3).searchParams.get("state")!;
    const beforeCount = shopCounter;
    await expect(
      shopsService.handleCallback("tiktok", { state: state3, code: "c3" }),
    ).rejects.toThrow(/kuota/i);

    const owned = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(schema.shops)
      .where(and(eq(schema.shops.userId, USER), eq(schema.shops.subSellerId, sub!.id)));
    expect(owned.length).toBe(2); // the 3rd never got persisted
    expect(shopCounter).toBe(beforeCount + 1); // exchangeToken DID run (OAuth completed) even though we didn't save it
  });

  it("a regular (non-portal) connect is completely unaffected", async () => {
    const { authUrl } = await shopsService.getConnectUrl(USER, "shopee");
    const state = new URL(authUrl).searchParams.get("state")!;
    const r = await shopsService.handleCallback("shopee", { state, code: "c-regular" });

    const [row] = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(schema.shops)
      .where(and(eq(schema.shops.userId, USER), eq(schema.shops.shopId, r.shopId)));
    expect(row!.subSellerId).toBeNull();
    expect(row!.addedByType).toBe("seller"); // DB default, untouched
    expect(row!.addedById).toBeNull();
  });
});
