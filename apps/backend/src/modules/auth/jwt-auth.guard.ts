import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { FastifyRequest } from "fastify";

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

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
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
}
