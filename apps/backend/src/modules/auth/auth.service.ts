import {
  Injectable,
  Inject,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { users, wallets, waLoginSessions } from "../../database/schema/index.js";
import type { JwtPayload } from "./jwt-auth.guard.js";

// Shared WA workflow uses uppercase prefixes (xtracker = "XTRACKER-"); AutoToko
// uses "AUTOTOKO-" so the same n8n switch can route by prefix without collision.
const WA_PREFIX = "AUTOTOKO-";
const CODE_TTL_SEC = 300; // 5 minutes (PRD Bagian 3.2)
const DUMMY_USER_ID = "00000000-0000-0000-0000-000000000001";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private sign(payload: JwtPayload): string {
    return this.jwt.sign(payload);
  }

  /** Dev-only dummy login (user/user by default) to unblock frontend work. */
  async devLogin(username: string, password: string): Promise<{ accessToken: string }> {
    const enabled = this.config.get<string>("DEV_LOGIN_ENABLED", "true") === "true";
    const u = this.config.get<string>("DEV_LOGIN_USERNAME", "user");
    const p = this.config.get<string>("DEV_LOGIN_PASSWORD", "user");
    if (!enabled || username !== u || password !== p) {
      throw new UnauthorizedException("Invalid credentials");
    }
    await this.ensureDummyUser();
    // Dev user gets admin role so the Admin CMS is reachable during development.
    return { accessToken: this.sign({ sub: DUMMY_USER_ID, role: "admin" }) };
  }

  /** Seed the dev user + wallet so dev-login works against the real DB. */
  private async ensureDummyUser(): Promise<void> {
    try {
      const [u] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, DUMMY_USER_ID))
        .limit(1);
      if (!u) {
        await this.db
          .insert(users)
          .values({ id: DUMMY_USER_ID, fullName: "Dev User", planType: "pro" });
        await this.db.insert(wallets).values({ userId: DUMMY_USER_ID, balance: "1000000" });
      }
    } catch (e) {
      this.logger.warn(`Could not seed dev user (DB down?): ${(e as Error).message}`);
    }
  }

  private genCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
    let body = "";
    const bytes = randomBytes(6);
    for (let i = 0; i < 6; i++) body += chars[bytes[i]! % chars.length];
    return WA_PREFIX + body;
  }

  /** Step 1: create a WA login session + deep link (PRD Bagian 3.1 / 20.3). */
  async waStart() {
    const code = this.genCode();
    const callbackToken = randomBytes(24).toString("hex");
    await this.db.insert(waLoginSessions).values({ code, callbackToken });

    const waNumber = this.config.get<string>("WA_AUTOTOKO_NUMBER", "");
    const appUrl = this.config.get<string>("APP_URL", "https://app.autotoko.id");
    const text = `${code} ${appUrl}/auth/wa-callback?token=${callbackToken}`;
    const waLink = `https://wa.me/${waNumber}?text=${encodeURIComponent(text)}`;

    return { code, callbackToken, waLink, expiresInSec: CODE_TTL_SEC };
  }

  /** Called by n8n when the user's WA message arrives (PRD Bagian 20.3 step 11). */
  async waVerify(rawCode: string, waNumber: string): Promise<{ ok: true }> {
    // Tolerate the raw message body or a bare code; normalize to AUTOTOKO-XXXXXX.
    const match = rawCode.toUpperCase().match(/AUTOTOKO-[A-Z0-9]{6,8}/);
    const code = match ? match[0] : rawCode.trim();

    const [session] = await this.db
      .select()
      .from(waLoginSessions)
      .where(eq(waLoginSessions.code, code))
      .limit(1);

    if (!session) throw new BadRequestException("Unknown code");
    if (session.status !== "pending") throw new BadRequestException("Code already used or expired");
    if (Date.now() - session.createdAt.getTime() > CODE_TTL_SEC * 1000) {
      await this.db
        .update(waLoginSessions)
        .set({ status: "expired" })
        .where(eq(waLoginSessions.code, code));
      throw new BadRequestException("Code expired");
    }

    const phone = waNumber.replace(/[^\d]/g, "");
    await this.upsertUserByWa(phone);

    await this.db
      .update(waLoginSessions)
      .set({ status: "verified", waNumber: phone, verifiedAt: new Date() })
      .where(eq(waLoginSessions.code, code));

    return { ok: true };
  }

  /** Step: frontend polls until verified, then receives a JWT. */
  async waStatus(callbackToken: string) {
    const [session] = await this.db
      .select()
      .from(waLoginSessions)
      .where(eq(waLoginSessions.callbackToken, callbackToken))
      .limit(1);

    if (!session) throw new BadRequestException("Unknown token");
    if (session.status !== "verified" || !session.waNumber) {
      return { status: session.status };
    }

    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.whatsapp, session.waNumber))
      .limit(1);

    if (!user) throw new BadRequestException("User not found for verified session");
    const accessToken = this.sign({ sub: user.id, role: "user", wa: user.whatsapp ?? undefined });
    return { status: "verified" as const, accessToken };
  }

  private async upsertUserByWa(phone: string): Promise<string> {
    const [existing] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.whatsapp, phone))
      .limit(1);
    if (existing) return existing.id;

    const id = randomUUID();
    await this.db.insert(users).values({ id, whatsapp: phone });
    await this.db.insert(wallets).values({ userId: id });
    this.logger.log(`Created new user via WA login: ${phone}`);
    return id;
  }
}
