import { Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { BadRequestException } from "@nestjs/common";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, AdminOnly, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { ReportsService, type Report, type ReportType } from "./reports.service.js";

const TYPES: ReportType[] = ["daily", "weekly", "monthly"];

function assertType(t: string): ReportType {
  if (!TYPES.includes(t as ReportType)) {
    throw new BadRequestException(`type harus salah satu: ${TYPES.join(", ")}`);
  }
  return t as ReportType;
}

@Controller("reports")
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Preview the signed-in seller's report (JSON) — for dashboard / testing. */
  @Get("preview/:type")
  async preview(
    @Param("type") type: string,
    @Req() req: FastifyRequest,
  ): Promise<ApiResponse<Report>> {
    const user = (req as FastifyRequest & { user?: JwtPayload }).user!;
    return { success: true, data: await this.reports.buildReport(user.sub, assertType(type)) };
  }

  /** Email the report to all sellers now (admin manual trigger of the cron). */
  @Post("run/:type")
  @AdminOnly()
  async run(@Param("type") type: string): Promise<ApiResponse<{ sent: number }>> {
    const sent = await this.reports.sendToAll(assertType(type));
    return { success: true, data: { sent } };
  }
}
