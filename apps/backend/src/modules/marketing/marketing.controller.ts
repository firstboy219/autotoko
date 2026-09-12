import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { MarketingService } from "./marketing.service.js";

@Controller("marketing")
@UseGuards(JwtAuthGuard)
export class MarketingController {
  constructor(private readonly marketing: MarketingService) {}

  private uid(req: FastifyRequest): string {
    return (req as FastifyRequest & { user?: JwtPayload }).user!.sub;
  }

  @Get("affiliates")
  async affiliates(@Req() req: FastifyRequest): Promise<ApiResponse<unknown[]>> {
    return { success: true, data: await this.marketing.listAffiliates(this.uid(req)) };
  }

  @Get("chat-logs")
  async chatLogs(@Req() req: FastifyRequest): Promise<ApiResponse<unknown[]>> {
    return { success: true, data: await this.marketing.listChatLogs(this.uid(req)) };
  }

  @Get("review-logs")
  async reviewLogs(@Req() req: FastifyRequest): Promise<ApiResponse<unknown[]>> {
    return { success: true, data: await this.marketing.listReviewLogs(this.uid(req)) };
  }
}
