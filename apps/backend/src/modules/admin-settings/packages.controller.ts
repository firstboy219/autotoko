import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from "@nestjs/common";
import {
  IsBoolean, IsInt, IsNumberString, IsObject, IsOptional, IsString, MaxLength, Min,
} from "class-validator";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, AdminOnly } from "../auth/jwt-auth.guard.js";
import { PackagesService } from "./packages.service.js";

const ok = <T>(data: T): ApiResponse<T> => ({ success: true, data });

class PackageBodyDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsNumberString() setupFee?: string;
  @IsOptional() @IsNumberString() monthlyFee?: string;
  @IsOptional() @IsNumberString() perTransactionFee?: string;
  @IsOptional() @IsInt() @Min(0) maxShops?: number;
  @IsOptional() @IsInt() @Min(0) maxOrdersPerMonth?: number;
  @IsOptional() @IsObject() features?: Record<string, boolean>;
  @IsOptional() @IsObject() activityFees?: Record<string, number>;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

class CreatePackageDto extends PackageBodyDto {
  @IsString() @MaxLength(64) code!: string;
}

@Controller("admin/packages")
@UseGuards(JwtAuthGuard)
@AdminOnly()
export class PackagesController {
  constructor(private readonly packages: PackagesService) {}

  @Get()
  async list() {
    return ok(await this.packages.list());
  }

  @Post()
  async create(@Body() dto: CreatePackageDto) {
    const { code, ...rest } = dto;
    return ok(await this.packages.create(code, rest));
  }

  @Put(":code")
  async update(@Param("code") code: string, @Body() dto: PackageBodyDto) {
    return ok(await this.packages.update(code, dto));
  }

  @Delete(":code")
  async remove(@Param("code") code: string) {
    return ok(await this.packages.remove(code));
  }
}
