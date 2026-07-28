import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql, eq } from "drizzle-orm";
import { JwtService } from "@nestjs/jwt";
import { Reflector } from "@nestjs/core";
import * as schema from "../../database/schema/index.js";
import { AdminUsersService } from "./admin-users.service.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { TenantService } from "../../database/tenant.service.js";

const DB_URL = process.env.E2E_DATABASE_URL;

(DB_URL ? describe : describe.skip)("admin user management (e2e)", () => {
  const client = postgres(DB_URL!, { max: 1 });
  const db = drizzle(client, { schema }) as never;
  const USER = "00000000-0000-4000-8000-0000000000e6";
  const service = new AdminUsersService(db);
  const jwt = new JwtService({ secret: "test-secret" });
  // RLS_ENABLED unset here -> TenantService.runBypass()/runAsUser() are pure
  // no-op passthroughs (see tenant.service.ts), so this exercises the guard's
  // suspension LOGIC directly against `db`, same as every other e2e spec in
  // this suite. The runBypass() call itself — needed because `users` has RLS
  // FORCED in production and this check runs before any request-scoped
  // app.user_id/app.bypass is set — is verified live against production
  // instead, where RLS_ENABLED is actually "true".
  const tenantService = new TenantService(db, { get: () => undefined } as never);
  const guard = new JwtAuthGuard(jwt, new Reflector(), db, tenantService);

  beforeAll(async () => {
    await (db as ReturnType<typeof drizzle>).execute(sql`select set_config('app.user_id', ${USER}, false)`);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.users)
      .values({ id: USER, email: `admin-users-e2e-${Date.now()}@test.local`, fullName: "Seller Test" })
      .onConflictDoNothing();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.wallets)
      .values({ userId: USER, balance: "500000" })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await (db as ReturnType<typeof drizzle>).delete(schema.users).where(eq(schema.users.id, USER));
    await client.end();
  });

  it("lists sellers with hierarchy counts and wallet balance", async () => {
    const sub = await (db as ReturnType<typeof drizzle>)
      .insert(schema.subSellers)
      .values({ userId: USER, name: "Budi", defaultRate: "0.2000" })
      .returning();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.subSubSellers)
      .values({ userId: USER, subSellerId: sub[0]!.id, name: "Citra", defaultRate: "0.5000" });

    const { items } = await service.list({ search: "Seller Test" } as never);
    const row = items.find((u) => u.id === USER)!;
    expect(row).toBeDefined();
    expect(row.walletBalance).toBe("500000.00");
    expect(row.subSellerCount).toBe(1);
    expect(row.subSubSellerCount).toBe(1);
  });

  it("detail() nests sub-sub-sellers under their parent sub-seller", async () => {
    const detail = await service.detail(USER);
    expect(detail.hierarchy.length).toBe(1);
    expect(detail.hierarchy[0]!.name).toBe("Budi");
    expect(detail.hierarchy[0]!.subSubSellers.length).toBe(1);
    expect(detail.hierarchy[0]!.subSubSellers[0]!.name).toBe("Citra");
  });

  it("suspend/unsuspend toggles isSuspended, and update() changes plan/name", async () => {
    const suspended = await service.suspend(USER);
    expect(suspended!.isSuspended).toBe(true);
    const unsuspended = await service.unsuspend(USER);
    expect(unsuspended!.isSuspended).toBe(false);

    const updated = await service.update(USER, { fullName: "Renamed Seller", planType: "pro" });
    expect(updated!.fullName).toBe("Renamed Seller");
    expect(updated!.planType).toBe("pro");
  });

  it("JwtAuthGuard.isBlocked() reflects suspend()/unsuspend() immediately — AdminUsersService busts the shared cache on both", async () => {
    const check = (id: string) =>
      (guard as unknown as { isBlocked(id: string): Promise<boolean> }).isBlocked(id);

    // Prime the cache with "not blocked" first, same as a real request would.
    expect(await check(USER)).toBe(false);

    await service.suspend(USER);
    // Without the service invalidating the cache, this would still read the
    // stale "not blocked" entry for up to SUSPENSION_CACHE_TTL_MS.
    expect(await check(USER)).toBe(true);

    await service.unsuspend(USER);
    // Same concern in reverse — an admin reversing a suspend expects it to
    // take effect right away, not after the cache TTL expires.
    expect(await check(USER)).toBe(false);
  });

  it("JwtAuthGuard blocks a deleted user's token (row vanished)", async () => {
    const ghostId = "00000000-0000-4000-8000-0000000000e7";
    const freshGuard = new JwtAuthGuard(jwt, new Reflector(), db, tenantService);
    const blocked = await (freshGuard as unknown as { isBlocked(id: string): Promise<boolean> }).isBlocked(ghostId);
    expect(blocked).toBe(true);
  });

  it("remove() cascades to the user's wallet", async () => {
    const del = await service.remove(USER);
    expect(del.deleted).toBe(true);
    const [gone] = await (db as ReturnType<typeof drizzle>).select().from(schema.users).where(eq(schema.users.id, USER));
    expect(gone).toBeUndefined();
    const [walletGone] = await (db as ReturnType<typeof drizzle>).select().from(schema.wallets).where(eq(schema.wallets.userId, USER));
    expect(walletGone).toBeUndefined();
  });
});
