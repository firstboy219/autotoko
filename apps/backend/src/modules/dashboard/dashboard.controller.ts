import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { DashboardService } from "./dashboard.service.js";
import { PendingTasksService } from "./pending-tasks.service.js";
import { ShopInsightsService } from "./shop-insights.service.js";

function uid(req: FastifyRequest): string {
  return (req as FastifyRequest & { user: JwtPayload }).user.sub;
}

@Controller("dashboard")
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly pending: PendingTasksService,
    private readonly insights: ShopInsightsService,
  ) {}

  /**
   * What is not finished, and what it costs to leave alone.
   *
   * On the dashboard rather than buried in each page: nobody opens a page to
   * find out that nothing is wrong, which is how incomplete data sits until it
   * breaks a number somewhere else.
   */
  @Get("pending-tasks")
  async pendingTasks(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.pending.list(uid(req)) };
  }

  /** Per-shop health, earnings and what is actually selling. */
  @Get("shop-insights")
  async shopInsights(
    @Req() req: FastifyRequest,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("categoryId") categoryId?: string,
  ): Promise<ApiResponse<unknown>> {
    return {
      success: true,
      data: await this.insights.overview(uid(req), {
        from,
        to,
        // "all" is the absence of a filter, sent explicitly so the client does
        // not have to decide between omitting the parameter and sending blank.
        categoryId: categoryId && categoryId !== "all" ? categoryId : null,
      }),
    };
  }

  @Get("summary")
  async summary(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.dashboard.summary(uid(req)) };
  }

  @Get("alerts")
  async alerts(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.dashboard.alerts(uid(req)) };
  }
}
