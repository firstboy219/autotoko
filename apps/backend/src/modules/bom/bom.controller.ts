import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { BomService } from "./bom.service.js";
import { CreateBomDto, UpdateBomDto, RestockDto } from "./dto/bom.dto.js";

function uid(req: FastifyRequest): string {
  return (req as FastifyRequest & { user: JwtPayload }).user.sub;
}

@Controller("bom")
@UseGuards(JwtAuthGuard)
export class BomController {
  constructor(private readonly bom: BomService) {}

  @Get()
  async list(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.bom.list(uid(req)) };
  }

  @Get("alerts")
  async alerts(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.bom.alerts(uid(req)) };
  }

  @Post()
  async create(
    @Req() req: FastifyRequest,
    @Body() dto: CreateBomDto,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.bom.create(uid(req), dto) };
  }

  @Patch(":id")
  async update(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() dto: UpdateBomDto,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.bom.update(uid(req), id, dto) };
  }

  @Delete(":id")
  async remove(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.bom.remove(uid(req), id) };
  }

  @Post(":id/restock")
  async restock(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() dto: RestockDto,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.bom.restock(uid(req), id, dto.amount) };
  }
}
