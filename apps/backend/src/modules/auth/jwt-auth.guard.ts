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
import { users } from "../../database/schema/index.js";

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

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @Inject(DRIZZLE) private readonly db: Database,
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
    if (payload.role === "user" && (await this.isBlocked(payload.sub))) {
      throw new UnauthorizedException("Akun ini telah dinonaktifkan atau ditangguhkan");
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

  private async isBlocked(userId: string): Promise<boolean> {
    const cached = suspensionCache.get(userId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.blocked;

    try {
      const [row] = await this.db
        .select({ isActive: users.isActive, isSuspended: users.isSuspended })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      // A vanished (deleted) user row is also blocked.
      const blocked = !row || !row.isActive || row.isSuspended;
      suspensionCache.set(userId, { blocked, expiresAt: now + SUSPENSION_CACHE_TTL_MS });
      return blocked;
    } catch (e) {
      // Fail OPEN on a DB hiccup — a transient outage must not lock every
      // single user out of the app; a real suspension just takes effect a
      // little later once the DB is reachable again.
      this.logger.warn(`Suspension check failed for ${userId}: ${(e as Error).message}`);
      return false;
    }
  }
}
