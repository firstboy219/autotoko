import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { emailOtpSessions, users, wallets } from "../../database/schema/index.js";
import { MailService } from "../../common/mail/mail.service.js";
import type { JwtPayload } from "./jwt-auth.guard.js";

const CODE_TTL_MIN = 5;
const MAX_ATTEMPTS = 5;
const MAX_PER_EMAIL_PER_15MIN = 3;

@Injectable()
export class EmailOtpService {
  private readonly logger = new Logger(EmailOtpService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
  ) {}

  private hash(email: string, code: string): string {
    return createHash("sha256").update(`${email}:${code}`).digest("hex");
  }

  /** Step 1: generate + email a 6-digit OTP. */
  async start(rawEmail: string): Promise<{ ok: true }> {
    const email = rawEmail.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new BadRequestException("Invalid email");
    }

    const since = new Date(Date.now() - 15 * 60 * 1000);
    const [recent] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(emailOtpSessions)
      .where(and(eq(emailOtpSessions.email, email), gt(emailOtpSessions.createdAt, since)));
    if ((recent?.count ?? 0) >= MAX_PER_EMAIL_PER_15MIN) {
      throw new HttpException(
        "Terlalu banyak permintaan OTP. Coba lagi nanti.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = new Date(Date.now() + CODE_TTL_MIN * 60 * 1000);
    await this.db.insert(emailOtpSessions).values({
      email,
      codeHash: this.hash(email, code),
      expiresAt,
    });

    await this.mail.send(
      email,
      "Kode masuk AutoToko",
      `<p>Kode login AutoToko Anda: <b style="font-size:20px;letter-spacing:3px">${code}</b></p>
       <p>Berlaku ${CODE_TTL_MIN} menit. Abaikan email ini jika Anda tidak meminta.</p>`,
      `Kode login AutoToko: ${code} (berlaku ${CODE_TTL_MIN} menit)`,
    );
    if (!this.mail.enabled) this.logger.warn(`[DEV] Email OTP for ${email}: ${code}`);
    return { ok: true };
  }

  /** Step 2: verify the OTP and issue an access token. */
  async verify(rawEmail: string, code: string): Promise<{ accessToken: string }> {
    const email = rawEmail.trim().toLowerCase();
    const [session] = await this.db
      .select()
      .from(emailOtpSessions)
      .where(and(eq(emailOtpSessions.email, email), eq(emailOtpSessions.status, "pending")))
      .orderBy(desc(emailOtpSessions.createdAt))
      .limit(1);

    if (!session) throw new BadRequestException("Kode tidak ditemukan. Minta OTP baru.");
    if (session.attempts >= MAX_ATTEMPTS) {
      await this.db
        .update(emailOtpSessions)
        .set({ status: "expired" })
        .where(eq(emailOtpSessions.id, session.id));
      throw new BadRequestException("Terlalu banyak percobaan. Minta OTP baru.");
    }
    if (session.expiresAt.getTime() < Date.now()) {
      await this.db
        .update(emailOtpSessions)
        .set({ status: "expired" })
        .where(eq(emailOtpSessions.id, session.id));
      throw new BadRequestException("Kode kedaluwarsa. Minta OTP baru.");
    }

    const expected = Buffer.from(session.codeHash);
    const got = Buffer.from(this.hash(email, code));
    const ok = expected.length === got.length && timingSafeEqual(expected, got);
    if (!ok) {
      await this.db
        .update(emailOtpSessions)
        .set({ attempts: session.attempts + 1 })
        .where(eq(emailOtpSessions.id, session.id));
      throw new BadRequestException("Kode salah.");
    }

    await this.db
      .update(emailOtpSessions)
      .set({ status: "verified", verifiedAt: new Date() })
      .where(eq(emailOtpSessions.id, session.id));

    const userId = await this.upsertUserByEmail(email);
    const payload: JwtPayload = { sub: userId, role: "user", email };
    return { accessToken: this.jwt.sign(payload) };
  }

  private async upsertUserByEmail(email: string): Promise<string> {
    const [existing] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing) return existing.id;

    const id = randomUUID();
    await this.db.insert(users).values({ id, email });
    await this.db.insert(wallets).values({ userId: id });
    this.logger.log(`Created new user via email login: ${email}`);
    return id;
  }
}
