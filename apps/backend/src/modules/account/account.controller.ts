import { Body, Controller, Get, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import type { FastifyRequest } from "fastify";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { AccountService } from "./account.service.js";

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  fullName?: string;
}

class SelectPlanDto {
  @IsIn(["freemium", "starter", "pro"])
  planType!: "freemium" | "starter" | "pro";
}

@Controller("account")
@UseGuards(JwtAuthGuard)
export class AccountController {
  constructor(private readonly account: AccountService) {}

  private uid(req: FastifyRequest): string {
    return (req as FastifyRequest & { user?: JwtPayload }).user!.sub;
  }

  @Get("me")
  async me(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.account.getProfile(this.uid(req)) };
  }

  @Patch("me")
  async update(@Req() req: FastifyRequest, @Body() dto: UpdateProfileDto): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.account.updateProfile(this.uid(req), dto.fullName) };
  }

  @Get("plans")
  async plans(): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.account.listPlans() };
  }

  @Post("plan")
  async selectPlan(@Req() req: FastifyRequest, @Body() dto: SelectPlanDto): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.account.selectPlan(this.uid(req), dto.planType) };
  }

  @Get("notifications")
  async notifications(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.account.listNotifications(this.uid(req)) };
  }
}
