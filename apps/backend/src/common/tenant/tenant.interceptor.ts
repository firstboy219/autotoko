import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { from, lastValueFrom, Observable } from "rxjs";
import type { FastifyRequest } from "fastify";
import { TenantService } from "../../database/tenant.service.js";
import type { JwtPayload } from "../../modules/auth/jwt-auth.guard.js";

/**
 * Wraps each HTTP request in a tenant-scoped DB transaction so Postgres RLS sees
 * the right context (runs after JwtAuthGuard, so req.user is populated):
 *  - authenticated non-admin → SET app.user_id = sub (sees only own rows)
 *  - admin / unauthenticated (login, webhooks, health) → bypass (cross-tenant ok)
 * No-op when RLS_ENABLED=false.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(private readonly tenant: TenantService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.tenant.enabled || context.getType() !== "http") {
      return next.handle();
    }
    const req = context.switchToHttp().getRequest<FastifyRequest & { user?: JwtPayload }>();
    const user = req.user;
    const exec = () => lastValueFrom(next.handle());
    const wrapped =
      user?.sub && user.role !== "admin"
        ? this.tenant.runAsUser(user.sub, exec)
        : this.tenant.runBypass(exec);
    return from(wrapped);
  }
}
