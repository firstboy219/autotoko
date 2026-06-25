import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { DashboardService } from "./dashboard.service.js";

function uid(req: FastifyRequest): string {
  return (req as FastifyRequest & { user: JwtPayload }).user.sub;
}

@Controller("dashboard")
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get("summary")
  async summary(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.dashboard.summary(uid(req)) };
  }

  @Get("alerts")
  async alerts(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.dashboard.alerts(uid(req)) };
  }
}
