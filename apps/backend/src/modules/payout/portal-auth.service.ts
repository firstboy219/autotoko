import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { emailOtpSessions, subSellers, subSubSellers } from "../../database/schema/index.js";
import { MailService } from "../../common/mail/mail.service.js";
import type { JwtPayload } from "../auth/jwt-auth.guard.js";

const CODE_TTL_MIN = 5;
const MAX_ATTEMPTS = 5;
const MAX_PER_EMAIL_PER_15MIN = 3;

/**
 * Passwordless login for the Sub-seller/Sub-sub-seller portal
 * (MAPPING_DAN_SELFSERVICE_TOKO.md), reusing AutoToko's standard email-OTP
 * mechanism (the same emailOtpSessions table/flow as the main app's
 * EmailOtpService) rather than a separate auth system — per the requirement
 * doc's explicit instruction. It's a parallel implementation, not a reuse of
 * EmailOtpService itself, because verify() here must NOT upsert a `users` row
 * — it looks up which sub_seller/sub_sub_seller owns the email instead, and
 * mints a token carrying the underlying tenant's id (for RLS) PLUS the
 * principal type/id (for the portal's restricted view).
 */
@Injectable()
export class PayoutPortalAuthService {
  private readonly logger = new Logger(PayoutPortalAuthService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
  ) {}

  private hash(email: string, code: string): string {
    return createHash("sha256").update(`portal:${email}:${code}`).digest("hex");
  }

  async start(rawEmail: string): Promise<{ ok: true }> {
    const email = rawEmail.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new BadRequestException("Invalid email");
    }
    const principal = await this.findPrincipal(email);
    if (!principal) {
      throw new NotFoundException("Email tidak terdaftar sebagai sub-seller/sub-sub-seller");
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
      "Kode masuk Portal Sub-seller AutoToko",
      `<p>Kode login Portal Sub-seller Anda: <b style="font-size:20px;letter-spacing:3px">${code}</b></p>
       <p>Berlaku ${CODE_TTL_MIN} menit. Abaikan email ini jika Anda tidak meminta.</p>`,
      `Kode login Portal Sub-seller: ${code} (berlaku ${CODE_TTL_MIN} menit)`,
    );
    if (!this.mail.enabled) this.logger.warn(`[DEV] Portal OTP for ${email}: ${code}`);
    return { ok: true };
  }

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

    const principal = await this.findPrincipal(email);
    if (!principal) {
      // Extremely unlikely (checked in start()), but the entity could have
      // been deleted/deactivated between start() and verify().
      throw new NotFoundException("Email tidak terdaftar sebagai sub-seller/sub-sub-seller");
    }

    const payload: JwtPayload = {
      sub: principal.userId,
      role: "user",
      email,
      principalType: principal.type,
      principalId: principal.id,
    };
    return { accessToken: this.jwt.sign(payload) };
  }

  private async findPrincipal(
    email: string,
  ): Promise<{ type: "sub_seller" | "sub_sub_seller"; id: string; userId: string } | null> {
    const [sub] = await this.db
      .select({ id: subSellers.id, userId: subSellers.userId, status: subSellers.status })
      .from(subSellers)
      .where(eq(subSellers.loginEmail, email))
      .limit(1);
    if (sub) {
      if (sub.status !== "active") throw new BadRequestException("Akun sub-seller nonaktif");
      return { type: "sub_seller", id: sub.id, userId: sub.userId };
    }
    const [subsub] = await this.db
      .select({ id: subSubSellers.id, userId: subSubSellers.userId, status: subSubSellers.status })
      .from(subSubSellers)
      .where(eq(subSubSellers.loginEmail, email))
      .limit(1);
    if (subsub) {
      if (subsub.status !== "active") throw new BadRequestException("Akun sub-sub-seller nonaktif");
      return { type: "sub_sub_seller", id: subsub.id, userId: subsub.userId };
    }
    return null;
  }
}
