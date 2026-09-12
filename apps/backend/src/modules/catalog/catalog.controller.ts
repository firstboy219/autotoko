import { Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, AdminOnly, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { CatalogService, type ProductHealth } from "./catalog.service.js";

@Controller("catalog")
@UseGuards(JwtAuthGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  /** Evaluate + persist the signed-in seller's catalog health (idempotent). */
  @Get("health")
  async health(@Req() req: FastifyRequest): Promise<ApiResponse<ProductHealth[]>> {
    const user = (req as FastifyRequest & { user?: JwtPayload }).user!;
    return { success: true, data: await this.catalog.evaluate(user.sub) };
  }

  /** Admin: run catalog evaluation for all sellers (manual cron trigger). */
  @Post("evaluate-all")
  @AdminOnly()
  async evaluateAll(): Promise<ApiResponse<{ users: number }>> {
    return { success: true, data: { users: await this.catalog.evaluateAllUsers() } };
  }
}
