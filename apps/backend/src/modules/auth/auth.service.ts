import {
  Injectable,
  Inject,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { users, wallets, waLoginSessions } from "../../database/schema/index.js";
import type { JwtPayload } from "./jwt-auth.guard.js";

// Shared WA workflow uses uppercase prefixes (xtracker = "XTRACKER-"); AutoToko
// uses "AUTOTOKO-" so the same n8n switch can route by prefix without collision.
const WA_PREFIX = "AUTOTOKO-";
const CODE_TTL_SEC = 300; // 5 minutes (PRD Bagian 3.2)
const DUMMY_USER_ID = "00000000-0000-0000-0000-000000000001";
// Fixed demo seller (demo@autotoko.id) used for the TikTok App Review. The seed
// script (scripts/seed-demo) populates this same id with shops/products/orders.
export const DEMO_USER_ID = "00000000-0000-0000-0000-0000000000de";
const DEMO_EMAIL = "demo@autotoko.id";

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

  /** Constant-time string compare that tolerates length differences. */
  private safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }

  /**
   * Username/password admin login. Two credential sources:
   *  1. ADMIN_USERNAME / ADMIN_PASSWORD — the real admin account (works in any
   *     env, including production; intended for the Admin CMS).
   *  2. DEV_LOGIN_* — convenience dev backdoor, only honored when
   *     DEV_LOGIN_ENABLED=true AND NODE_ENV !== "production".
   * Both issue an admin JWT bound to the dev/admin user row.
   */
  async login(username: string, password: string): Promise<{ accessToken: string }> {
    const adminUser = this.config.get<string>("ADMIN_USERNAME", "");
    const adminPass = this.config.get<string>("ADMIN_PASSWORD", "");
    if (adminUser && adminPass && this.safeEqual(username, adminUser) && this.safeEqual(password, adminPass)) {
      await this.ensureDummyUser();
      return { accessToken: this.sign({ sub: DUMMY_USER_ID, role: "admin" }) };
    }

    const devEnabled = this.config.get<string>("DEV_LOGIN_ENABLED", "false") === "true";
    const isProd = this.config.get<string>("NODE_ENV") === "production";
    if (devEnabled && !isProd) {
      const u = this.config.get<string>("DEV_LOGIN_USERNAME", "user");
      const p = this.config.get<string>("DEV_LOGIN_PASSWORD", "user");
      if (username === u && password === p) {
        await this.ensureDummyUser();
        // Dev user gets admin role so the Admin CMS is reachable during development.
        return { accessToken: this.sign({ sub: DUMMY_USER_ID, role: "admin" }) };
      }
    }

    throw new UnauthorizedException("Invalid credentials");
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

  /**
   * Passwordless demo login for the TikTok App Review reviewer. Issues a JWT for
   * the fixed demo seller ONLY (never admin, never an arbitrary account), and
   * only when DEMO_LOGIN_ENABLED=true. Much narrower than the old user/user →
   * admin dev backdoor, so it is safe to expose on the public login page.
   */
  async demoLogin(): Promise<{ accessToken: string }> {
    if (this.config.get<string>("DEMO_LOGIN_ENABLED", "false") !== "true") {
      throw new UnauthorizedException("Demo login disabled");
    }
    await this.ensureDemoUser();
    return { accessToken: this.sign({ sub: DEMO_USER_ID, role: "user" }) };
  }

  /** Ensure the demo seller + wallet exist (idempotent). */
  private async ensureDemoUser(): Promise<void> {
    try {
      const [u] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, DEMO_USER_ID))
        .limit(1);
      if (!u) {
        await this.db
          .insert(users)
          .values({
            id: DEMO_USER_ID,
            email: DEMO_EMAIL,
            whatsapp: "+6281234567890",
            fullName: "Demo AutoToko",
            planType: "pro",
          })
          .onConflictDoNothing();
        await this.db
          .insert(wallets)
          .values({ userId: DEMO_USER_ID, balance: "450000" })
          .onConflictDoNothing();
      }
    } catch (e) {
      this.logger.warn(`Could not seed demo user (DB down?): ${(e as Error).message}`);
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
