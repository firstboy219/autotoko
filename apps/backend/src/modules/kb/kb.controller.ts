import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ApiResponse } from "@autotoko/shared";
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";
import { JwtAuthGuard, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { KbService } from "./kb.service.js";

const uid = (req: FastifyRequest) => (req as FastifyRequest & { user: JwtPayload }).user.sub;

class KbDto {
  @IsOptional() @IsString() kind?: string;
  @IsString() @MaxLength(2000) keywords!: string;
  @IsString() @MaxLength(4000) answer!: string;
  @IsOptional() @IsInt() @Min(0) priority?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

class KbDraftDto {
  @IsString() @MaxLength(4000) text!: string;
  @IsOptional() @IsString() kind?: string;
  @IsOptional() @IsString() orderId?: string;
}

@Controller("kb")
@UseGuards(JwtAuthGuard)
export class KbController {
  constructor(private readonly kb: KbService) {}

  @Get()
  async list(@Req() req: FastifyRequest, @Query("kind") kind?: string): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.kb.list(uid(req), kind) };
  }

  @Post()
  async create(@Req() req: FastifyRequest, @Body() dto: KbDto): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.kb.create(uid(req), dto) };
  }

  @Put(":id")
  async update(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() dto: KbDto,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.kb.update(uid(req), id, dto) };
  }

  @Delete(":id")
  async remove(@Req() req: FastifyRequest, @Param("id") id: string): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.kb.remove(uid(req), id) };
  }

  /** Susun draf balasan dari KB untuk sebuah teks (dipakai tombol "Saran"). */
  @Post("draft")
  async draft(@Req() req: FastifyRequest, @Body() dto: KbDraftDto): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.kb.draft(uid(req), dto) };
  }
}
