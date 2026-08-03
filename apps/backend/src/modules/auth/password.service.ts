import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { and, eq, isNull } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { passwordResetTokens, users } from "../../database/schema/index.js";
import { MailService } from "../../common/mail/mail.service.js";
import { ConfigService } from "@nestjs/config";
import { TenantService } from "../../database/tenant.service.js";
import type { JwtPayload } from "./jwt-auth.guard.js";
import { MIN_PASSWORD_LENGTH, hashPassword, verifyPassword } from "./password.util.js";

/**
 * Email + password login, offered alongside the existing passwordless WA/email
 * OTP flows rather than replacing them.
 *
 * There is deliberately no "forgot password" email flow: OTP login already IS
 * the recovery path, and it proves ownership of the same address. A user who
 * forgets their password signs in with an OTP and sets a new one.
 */
@Injectable()
export class PasswordAuthService {
  private readonly logger = new Logger(PasswordAuthService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly tenant: TenantService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async login(rawEmail: string, password: string): Promise<{ accessToken: string }> {
    const email = rawEmail.trim().toLowerCase();

    // `users` has RLS forced and this runs before any tenant context exists —
    // same situation as the suspension check in JwtAuthGuard, so it needs the
    // same bypass or the lookup silently returns nothing.
    const row = await this.tenant.runBypass(async () => {
      const [u] = await this.db
        .select({
          id: users.id,
          passwordHash: users.passwordHash,
          isActive: users.isActive,
          isSuspended: users.isSuspended,
        })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      return u ?? null;
    });

    // Verify even when the account is missing, against a throwaway hash, so a
    // wrong email and a wrong password take the same time — otherwise the
    // response latency reveals which addresses are registered.
    const ok = await verifyPassword(password, row?.passwordHash ?? null);

    if (!row || !ok) {
      throw new UnauthorizedException("Email atau password salah.");
    }
    if (!row.isActive || row.isSuspended) {
      throw new UnauthorizedException("Akun ini telah dinonaktifkan atau ditangguhkan.");
    }

    const payload: JwtPayload = { sub: row.id, role: "user", email };
    return { accessToken: this.jwt.sign(payload) };
  }

  /** Sets or replaces the caller's own password. Requires an authenticated session. */
  async setPassword(userId: string, newPassword: string, currentPassword?: string): Promise<{ ok: true }> {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(
        `Password minimal ${MIN_PASSWORD_LENGTH} karakter.`,
      );
    }

    const [row] = await this.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) throw new UnauthorizedException("Akun tidak ditemukan.");

    // Changing an existing password requires proving you know it — otherwise a
    // hijacked session could lock the real owner out permanently. Setting one
    // for the first time only needs the session, which was already established
    // by OTP.
    if (row.passwordHash) {
      if (!currentPassword) {
        throw new BadRequestException("Masukkan password lama untuk menggantinya.");
      }
      if (!(await verifyPassword(currentPassword, row.passwordHash))) {
        throw new BadRequestException("Password lama salah.");
      }
    }

    await this.db
      .update(users)
      .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
      .where(eq(users.id, userId));

    this.logger.log(`Password set for user ${userId}`);
    return { ok: true };
  }

  /** Lets the UI show "set" vs "change" without leaking the hash. */
  async status(userId: string): Promise<{ hasPassword: boolean }> {
    const [row] = await this.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return { hasPassword: Boolean(row?.passwordHash) };
  }

  /* ------------------------------------------------------- forgot password */

  /**
   * Issues a reset link.
   *
   * ALWAYS reports success, whether or not the address belongs to an account —
   * a different reply for unknown emails would turn this endpoint into a
   * membership oracle. A failure to actually send is logged server-side and
   * surfaced through the Admin SMTP page, not to the requester.
   */
  async requestReset(rawEmail: string): Promise<{ ok: true }> {
    const email = rawEmail.trim().toLowerCase();

    // Same RLS bypass the login path needs: this runs with no tenant context.
    const user = await this.tenant.runBypass(async () => {
      const [u] = await this.db
        .select({ id: users.id, isActive: users.isActive, isSuspended: users.isSuspended })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      return u ?? null;
    });

    if (!user || !user.isActive || user.isSuspended) {
      this.logger.log(`Password reset requested for a non-resettable address (${email})`);
      return { ok: true };
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + RESET_TTL_MIN * 60 * 1000);

    await this.tenant.runBypass(async () => {
      await this.db.insert(passwordResetTokens).values({
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt,
      });
    });

    const appUrl = this.config.get<string>("APP_URL", "https://viewtoko.cosger.online");
    const link = `${appUrl}/reset-password?token=${token}`;

    try {
      await this.mail.send(
        email,
        "Reset password AutoToko",
        `<p>Kami menerima permintaan reset password untuk akun ini.</p>
         <p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#0e6e55;color:#fff;border-radius:8px;text-decoration:none">Atur Password Baru</a></p>
         <p style="color:#6b7178;font-size:13px">Atau buka tautan ini: <br>${link}</p>
         <p style="color:#6b7178;font-size:13px">Berlaku ${RESET_TTL_MIN} menit dan hanya bisa dipakai sekali. Abaikan email ini jika kamu tidak memintanya — password lama tetap berlaku.</p>`,
        `Reset password AutoToko\n\nBuka: ${link}\n\nBerlaku ${RESET_TTL_MIN} menit, sekali pakai.`,
      );
      this.logger.log(`Password reset link sent to ${email}`);
    } catch (e) {
      // Deliberately swallowed for the caller: reporting the send failure here
      // would reveal that the address exists. The admin sees SMTP health on
      // the Admin > Email/SMTP page instead.
      this.logger.error(
        `Password reset email FAILED for ${email}: ${(e as Error).message.split("\n")[0]}`,
      );
    }

    return { ok: true };
  }

  /** Checks a link before showing the form, so an expired one says so up front. */
  async checkResetToken(token: string): Promise<{ valid: boolean; reason?: string }> {
    const row = await this.findToken(token);
    if (!row) return { valid: false, reason: "Tautan tidak valid." };
    if (row.usedAt) return { valid: false, reason: "Tautan ini sudah dipakai." };
    if (row.expiresAt.getTime() < Date.now()) return { valid: false, reason: "Tautan sudah kedaluwarsa." };
    return { valid: true };
  }

  async resetWithToken(token: string, newPassword: string): Promise<{ ok: true }> {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(`Password minimal ${MIN_PASSWORD_LENGTH} karakter.`);
    }
    const row = await this.findToken(token);
    if (!row) throw new BadRequestException("Tautan tidak valid.");
    if (row.usedAt) throw new BadRequestException("Tautan ini sudah dipakai. Minta tautan baru.");
    if (row.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException("Tautan sudah kedaluwarsa. Minta tautan baru.");
    }

    const hashed = await hashPassword(newPassword);
    await this.tenant.runBypass(async () => {
      await this.db
        .update(users)
        .set({ passwordHash: hashed, updatedAt: new Date() })
        .where(eq(users.id, row.userId));

      // Burn this token, and every other outstanding one for the same user — a
      // second link sitting in an inbox must not still work after a reset.
      await this.db
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordResetTokens.userId, row.userId), isNull(passwordResetTokens.usedAt)));
    });

    this.logger.log(`Password reset completed for user ${row.userId}`);
    return { ok: true };
  }

  private async findToken(token: string) {
    if (!token || token.length < 20) return null;
    return this.tenant.runBypass(async () => {
      const [row] = await this.db
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.tokenHash, hashToken(token)))
        .limit(1);
      return row ?? null;
    });
  }
}

const RESET_TTL_MIN = 60;

/** Tokens are looked up by hash, never stored in the clear. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
