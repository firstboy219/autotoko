import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { eq } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { users } from "../../database/schema/index.js";
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
}
