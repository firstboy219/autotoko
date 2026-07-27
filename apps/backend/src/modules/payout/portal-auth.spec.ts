import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql, eq } from "drizzle-orm";
import { JwtService } from "@nestjs/jwt";
import * as schema from "../../database/schema/index.js";
import { PayoutPortalAuthService } from "./portal-auth.service.js";
import type { JwtPayload } from "../auth/jwt-auth.guard.js";

const URL = process.env.E2E_DATABASE_URL;

(URL ? describe : describe.skip)("payout portal auth (e2e)", () => {
  const client = postgres(URL!, { max: 1 });
  const db = drizzle(client, { schema }) as never;
  const USER = "00000000-0000-4000-8000-0000000000a1";
  const jwt = new JwtService({ secret: "test-secret" });

  let capturedCode = "";
  const mailStub = {
    send: vi.fn(async (_to: string, _subject: string, html: string) => {
      const m = html.match(/(\d{6})/);
      capturedCode = m?.[1] ?? "";
    }),
    get enabled() { return true; }, // pretend email sending "works" so we go through the real send() path and capture from it
  };

  const auth = new PayoutPortalAuthService(db, jwt, mailStub as never);

  beforeAll(async () => {
    await (db as ReturnType<typeof drizzle>).execute(sql`select set_config('app.user_id', ${USER}, false)`);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.users)
      .values({ id: USER, email: `portal-e2e-${Date.now()}@test.local`, fullName: "Portal Tenant" })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await (db as ReturnType<typeof drizzle>).delete(schema.users).where(eq(schema.users.id, USER));
    await client.end();
  });

  it("logs in a sub-seller by email OTP and mints a scoped JWT", async () => {
    const email = `subseller-${Date.now()}@test.local`;
    const [sub] = await (db as ReturnType<typeof drizzle>)
      .insert(schema.subSellers)
      .values({ userId: USER, name: "Budi", loginEmail: email, defaultRate: "0.2000" })
      .returning();

    await auth.start(email);
    expect(capturedCode).toMatch(/^\d{6}$/);

    const { accessToken } = await auth.verify(email, capturedCode);
    const payload = jwt.verify<JwtPayload>(accessToken);

    // sub is still the TENANT id (for RLS) — not the sub-seller's own id.
    expect(payload.sub).toBe(USER);
    expect(payload.principalType).toBe("sub_seller");
    expect(payload.principalId).toBe(sub!.id);
  });

  it("logs in a sub-sub-seller by email OTP", async () => {
    const parentEmail = `parent-${Date.now()}@test.local`;
    const [sub] = await (db as ReturnType<typeof drizzle>)
      .insert(schema.subSellers)
      .values({ userId: USER, name: "Parent", loginEmail: parentEmail, defaultRate: "0.2000" })
      .returning();
    const childEmail = `child-${Date.now()}@test.local`;
    const [subsub] = await (db as ReturnType<typeof drizzle>)
      .insert(schema.subSubSellers)
      .values({ userId: USER, subSellerId: sub!.id, name: "Child", loginEmail: childEmail, defaultRate: "0.5000" })
      .returning();

    await auth.start(childEmail);
    const { accessToken } = await auth.verify(childEmail, capturedCode);
    const payload = jwt.verify<JwtPayload>(accessToken);

    expect(payload.principalType).toBe("sub_sub_seller");
    expect(payload.principalId).toBe(subsub!.id);
  });

  it("rejects an email that belongs to neither a sub-seller nor a sub-sub-seller", async () => {
    await expect(auth.start(`nobody-${Date.now()}@test.local`)).rejects.toThrow();
  });

  it("rejects a wrong OTP code", async () => {
    const email = `wrongcode-${Date.now()}@test.local`;
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.subSellers)
      .values({ userId: USER, name: "X", loginEmail: email, defaultRate: "0.2000" });
    await auth.start(email);
    await expect(auth.verify(email, "000000")).rejects.toThrow();
  });
});
