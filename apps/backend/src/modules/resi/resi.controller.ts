import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, Matches } from "class-validator";
import { Type } from "class-transformer";
import type { FastifyRequest } from "fastify";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, TenantOwnerOnly, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { ResiService } from "./resi.service.js";

function uid(req: FastifyRequest): string {
  return (req as FastifyRequest & { user: JwtPayload }).user.sub;
}

class ScanDto {
  // \S guards against a whitespace-only string sneaking past MaxLength — the
  // same hole a nameless material row got through on the catalog endpoint.
  @IsString() @Matches(/\S/, { message: "Nomor resi tidak boleh kosong." }) @MaxLength(128)
  resi!: string;

  @IsOptional() @IsString() @MaxLength(128)
  resiRaw?: string;

  @IsOptional() @IsIn(["ocr", "manual"])
  source?: "ocr" | "manual";

  @IsOptional() @IsString() @MaxLength(64)
  deviceLabel?: string;
}

class ListQuery {
  @IsOptional() @IsString() @MaxLength(64)
  q?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

/**
 * Warehouse scanner endpoints, used by the Android app (and the Scan Resi page
 * on the web). Portal tokens are excluded: a sub-seller must not be able to
 * write into the tenant's scan log.
 */
@Controller("resi")
@UseGuards(JwtAuthGuard)
@TenantOwnerOnly()
export class ResiController {
  constructor(private readonly resi: ResiService) {}

  /** 201 on a new resi; 409 with the earlier scan's details on a repeat. */
  @Post("scan")
  async scan(@Req() req: FastifyRequest, @Body() dto: ScanDto): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.scan(uid(req), dto) };
  }

  @Get("scans")
  async list(@Req() req: FastifyRequest, @Query() q: ListQuery): Promise<ApiResponse<unknown>> {
    return {
      success: true,
      data: await this.resi.list(uid(req), { q: q.q, limit: q.limit, offset: q.offset }),
    };
  }

  @Get("scans/summary")
  async summary(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.summary(uid(req)) };
  }

  @Delete("scans/:id")
  async remove(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.remove(uid(req), id) };
  }
}
