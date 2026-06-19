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
}

/** Mark a route/controller as admin-only. */
export const ADMIN_ONLY = "admin_only";
export const AdminOnly = () => SetMetadata(ADMIN_ONLY, true);

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
    return true;
  }
}
