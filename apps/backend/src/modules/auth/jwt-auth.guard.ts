import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  SetMetadata,
  UnauthorizedException,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { TenantService } from "../../database/tenant.service.js";
import { staffAccounts, users } from "../../database/schema/index.js";
import {
  ANY_STAFF,
  OWNER_ONLY,
  permissionForRequest,
} from "../staff/permissions.js";

export interface JwtPayload {
  sub: string;
  role: "user" | "admin";
  wa?: string;
  email?: string;
  // Present only for a sub-seller/sub-sub-seller PORTAL login (Bagian 5,
  // FLOW_PENCAIRAN_V2_FINAL.md). `sub` is STILL the underlying tenant's
  // users.id even for a portal token — every existing RLS/app.user_id query
  // keeps working unchanged; principalType/principalId is what the app layer
  // uses to restrict a portal caller to their own shops/history only.
  principalType?: "sub_seller" | "sub_sub_seller";
  principalId?: string;
  /**
   * Ada hanya untuk login AKUN KARYAWAN.
   *
   * `sub` tetap users.id PEMILIK, sama seperti token portal -- seluruh RLS dan
   * app.user_id bekerja tanpa perubahan. Izin sengaja TIDAK ditanam di token:
   * ia dibaca dari baris staff_accounts pada tiap permintaan, supaya mencabut
   * akses berlaku dalam hitungan detik dan bukan setelah token kedaluwarsa.
   */
  staffId?: string;

  /**
   * Kapan token ini lahir, dalam milidetik.
   *
   * `iat` bawaan JWT hanya beresolusi detik, dan di dalam satu detik yang
   * sama token lama tidak bisa dibedakan dari token baru hasil login ulang.
   * Pencabutan akses tidak boleh bergantung pada tebakan sehalus itu.
   */
  iatMs?: number;
  /** Issued-at, seconds. Set by jwt.sign(); used for the session-epoch check. */
  iat?: number;
}

/** Mark a route/controller as admin-only. */
export const ADMIN_ONLY = "admin_only";
export const AdminOnly = () => SetMetadata(ADMIN_ONLY, true);

/**
 * Mark a route/controller as OFF LIMITS to sub-seller/sub-sub-seller portal
 * tokens — required on every regular tenant endpoint, since a portal token's
 * `sub` still resolves to the real tenant id (by design, for RLS) and would
 * otherwise see the tenant's full data, defeating the portal's restricted view.
 */
export const TENANT_OWNER_ONLY = "tenant_owner_only";
export const TenantOwnerOnly = () => SetMetadata(TENANT_OWNER_ONLY, true);

/** Mark a route/controller as reachable ONLY by a sub-seller/sub-sub-seller portal token. */
export const PORTAL_ONLY = "portal_only";
export const PortalOnly = () => SetMetadata(PORTAL_ONLY, true);

interface SuspensionCacheEntry {
  blocked: boolean;
  /** users.sessions_valid_from as epoch SECONDS, or 0 when never invalidated. */
  validFromSec: number;
  expiresAt: number;
}
// Short-TTL cache so a fresh suspend/delete from the admin panel takes effect
// within seconds without adding a DB round-trip to every single authenticated
// request. Module-level (not per-instance) since pm2 runs this app as a
// single fork, not a cluster — no cross-process invalidation to worry about.
const SUSPENSION_CACHE_TTL_MS = 20_000;
const suspensionCache = new Map<string, SuspensionCacheEntry>();

/**
 * Called by AdminUsersService right after suspend()/unsuspend()/remove() so
 * the change is visible on that user's VERY NEXT request instead of waiting
 * out the cache TTL — matters most for unsuspend, where a stale "still
 * blocked" entry would otherwise leave someone locked out for up to
 * SUSPENSION_CACHE_TTL_MS after an admin already reversed it.
 */
export function invalidateSuspensionCache(userId: string): void {
  suspensionCache.delete(userId);
}

interface StaffCacheEntry {
  ok: boolean;
  ownerId: string;
  permissions: string[];
  /** Milidetik, bukan detik -- lihat catatan pada iatMs. */
  validFromMs: number;
  expiresAt: number;
}
const staffCache = new Map<string, StaffCacheEntry>();

/** Dipanggil StaffService setelah izin diubah, akun dimatikan, atau dihapus. */
export function invalidateStaffCache(staffId: string): void {
  staffCache.delete(staffId);
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly tenant: TenantService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const header = req.headers["authorization"];
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }
    const token = header.slice("Bearer ".length);
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
    (req as FastifyRequest & { user?: JwtPayload }).user = payload;

    // Admin-role tokens (env-var ADMIN_USERNAME/PASSWORD login) are not a row
    // managed through the admin Users page's suspend/delete — never blocked
    // here. Every "user" role token (regular seller login AND any portal
    // token, whose `sub` is the real tenant/seller) is checked live so a
    // suspend/delete takes effect immediately, not just on the next login.
    if (payload.role === "user") {
      const state = await this.loadState(payload.sub);
      if (state.blocked) {
        throw new UnauthorizedException("Akun ini telah dinonaktifkan atau ditangguhkan");
      }
      // Password changed after this token was minted -> the token is dead.
      // `iat` is whole seconds, so compare in seconds and let a token issued
      // during the very same second survive: setPassword() hands the caller a
      // freshly signed token, and flooring must not kill the replacement it
      // just issued.
      if (state.validFromSec > 0 && (payload.iat ?? 0) < state.validFromSec) {
        throw new UnauthorizedException("Sesi berakhir karena password diubah. Silakan masuk lagi.");
      }
    }

    // Akun karyawan: aktif, tokennya belum dicabut, dan modul yang dituju
    // memang diizinkan untuknya.
    if (payload.staffId) {
      const staf = await this.loadStaff(payload.staffId);
      if (!staf.ok || staf.ownerId !== payload.sub) {
        throw new UnauthorizedException("Akun karyawan ini sudah tidak aktif.");
      }
      // Dibandingkan dalam milidetik supaya tidak ada detik yang ambigu:
      // token lama yang lahir pada detik pencabutan tetap mati, sedangkan
      // token baru hasil login ulang pada detik yang sama tetap hidup.
      const lahirMs = payload.iatMs ?? (payload.iat ?? 0) * 1000;
      if (staf.validFromMs > 0 && lahirMs < staf.validFromMs) {
        throw new UnauthorizedException(
          "Sesi berakhir karena akses akun ini diubah. Silakan masuk lagi.",
        );
      }
      const perlu = permissionForRequest(req.method ?? "GET", req.url ?? "");
      if (perlu === null || perlu === OWNER_ONLY) {
        // Gagal-tertutup: yang tidak dipetakan ditolak. Modul baru yang lupa
        // didaftarkan akan dilaporkan sebagai "karyawan tidak bisa membuka X",
        // sedangkan gagal-terbuka tidak akan terlihat sampai terlambat.
        throw new ForbiddenException("Akun karyawan tidak punya akses ke bagian ini.");
      }
      if (perlu !== ANY_STAFF && !staf.permissions.includes(perlu)) {
        throw new ForbiddenException("Akses ke bagian ini belum diberikan untuk akun Anda.");
      }
    }

    const adminOnly = this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (adminOnly && payload.role !== "admin") {
      throw new ForbiddenException("Admin access required");
    }

    const tenantOwnerOnly = this.reflector.getAllAndOverride<boolean>(TENANT_OWNER_ONLY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (tenantOwnerOnly && payload.principalType) {
      throw new ForbiddenException("Not available to sub-seller/sub-sub-seller portal logins");
    }

    const portalOnly = this.reflector.getAllAndOverride<boolean>(PORTAL_ONLY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (portalOnly && !payload.principalType) {
      throw new ForbiddenException("Portal access only");
    }

    return true;
  }

  /**
   * Keadaan satu akun karyawan, dengan cache pendek seperti pemeriksaan suspend.
   *
   * Gagal-TERTUTUP kalau database bermasalah, kebalikan dari loadState() di
   * bawah. Alasannya berbeda: di sana menutup berarti mengunci seluruh pemilik
   * dari aplikasinya sendiri, di sini membuka berarti memberi akses penuh ke
   * akun yang mungkin sudah dicabut.
   */
  private async loadStaff(staffId: string): Promise<StaffCacheEntry> {
    const now = Date.now();
    const cached = staffCache.get(staffId);
    if (cached && cached.expiresAt > now) return cached;

    try {
      const hasil = await this.tenant.runBypass(async () => {
        const [row] = await this.db
          .select({
            userId: staffAccounts.userId,
            isActive: staffAccounts.isActive,
            permissions: staffAccounts.permissions,
            sessionsValidFrom: staffAccounts.sessionsValidFrom,
          })
          .from(staffAccounts)
          .where(eq(staffAccounts.id, staffId))
          .limit(1);
        return row ?? null;
      });
      const entry: StaffCacheEntry = {
        ok: Boolean(hasil?.isActive),
        ownerId: hasil?.userId ?? "",
        permissions: Array.isArray(hasil?.permissions) ? hasil!.permissions : [],
        validFromMs: hasil?.sessionsValidFrom
          ? hasil.sessionsValidFrom.getTime()
          : 0,
        expiresAt: now + SUSPENSION_CACHE_TTL_MS,
      };
      staffCache.set(staffId, entry);
      return entry;
    } catch (e) {
      this.logger.warn(`Pemeriksaan akun karyawan ${staffId} gagal: ${(e as Error).message}`);
      return { ok: false, ownerId: "", permissions: [], validFromMs: 0, expiresAt: 0 };
    }
  }

  private async loadState(userId: string): Promise<{ blocked: boolean; validFromSec: number }> {
    const cached = suspensionCache.get(userId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return { blocked: cached.blocked, validFromSec: cached.validFromSec };
    }

    try {
      // users has RLS FORCED, keyed on its own id (app.user_id = id, or
      // app.bypass=on) — this check runs BEFORE any request-scoped
      // app.user_id is established (it IS the thing establishing who the
      // caller is), and it legitimately needs to look up an arbitrary
      // caller's row regardless of tenant context, so it goes through the
      // same runBypass() path as cron/webhook/admin reads. Without this,
      // RLS silently returns zero rows here and every real user gets
      // treated as "blocked" (a vanished row looks identical to a
      // suspended one) — caught by a live smoke test before this shipped.
      const state = await this.tenant.runBypass(async () => {
        const [row] = await this.db
          .select({
            isActive: users.isActive,
            isSuspended: users.isSuspended,
            sessionsValidFrom: users.sessionsValidFrom,
          })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        return {
          blocked: !row || !row.isActive || row.isSuspended,
          validFromSec: row?.sessionsValidFrom
            ? Math.floor(row.sessionsValidFrom.getTime() / 1000)
            : 0,
        };
      });
      suspensionCache.set(userId, { ...state, expiresAt: now + SUSPENSION_CACHE_TTL_MS });
      return state;
    } catch (e) {
      // Fail OPEN on a DB hiccup — a transient outage must not lock every
      // single user out of the app; a real suspension just takes effect a
      // little later once the DB is reachable again.
      this.logger.warn(`Suspension check failed for ${userId}: ${(e as Error).message}`);
      return { blocked: false, validFromSec: 0 };
    }
  }
}
