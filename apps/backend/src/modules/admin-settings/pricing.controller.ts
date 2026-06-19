import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  UseGuards,
  BadRequestException,
} from "@nestjs/common";
import {
  IsBooleanString,
  IsInt,
  IsNumberString,
  IsOptional,
} from "class-validator";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, AdminOnly } from "../auth/jwt-auth.guard.js";
import { PricingService } from "./pricing.service.js";

class PricingDto {
  @IsOptional() @IsNumberString() setupFee?: string;
  @IsOptional() @IsNumberString() monthlyFee?: string;
  @IsOptional() @IsNumberString() perTransactionFee?: string;
  @IsOptional() @IsInt() maxShops?: number;
  @IsOptional() @IsInt() maxOrdersPerMonth?: number;
  @IsOptional() @IsBooleanString() isActive?: string;
}

const PLANS = ["freemium", "starter", "pro"] as const;

@Controller("admin/pricing")
@UseGuards(JwtAuthGuard)
@AdminOnly()
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get()
  async list(): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.pricing.list() };
  }

  @Put(":plan")
  async upsert(
    @Param("plan") plan: string,
    @Body() dto: PricingDto,
  ): Promise<ApiResponse<unknown>> {
    if (!PLANS.includes(plan as (typeof PLANS)[number])) {
      throw new BadRequestException("Invalid plan");
    }
    const { isActive, ...rest } = dto;
    return {
      success: true,
      data: await this.pricing.upsert(plan as (typeof PLANS)[number], {
        ...rest,
        ...(isActive !== undefined ? { isActive: isActive === "true" } : {}),
      }),
    };
  }
}
