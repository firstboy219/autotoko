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
import { JwtAuthGuard, TenantOwnerOnly, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { CostingService } from "./costing.service.js";
import {
  CreateMaterialDto,
  SuggestPriceDto,
  UpdateCostingDto,
  UpdateMaterialCostDto,
} from "./dto/costing.dto.js";

function uid(req: FastifyRequest): string {
  return (req as FastifyRequest & { user: JwtPayload }).user.sub;
}
const ok = <T>(data: T): ApiResponse<T> => ({ success: true, data });

@Controller("costing")
@UseGuards(JwtAuthGuard)
@TenantOwnerOnly()
export class CostingController {
  constructor(private readonly costing: CostingService) {}

  @Get()
  async list(@Req() req: FastifyRequest) {
    return ok(await this.costing.list(uid(req)));
  }

  @Get(":productId")
  async detail(@Req() req: FastifyRequest, @Param("productId") productId: string) {
    return ok(await this.costing.detail(uid(req), productId));
  }

  @Patch(":productId")
  async update(
    @Req() req: FastifyRequest,
    @Param("productId") productId: string,
    @Body() dto: UpdateCostingDto,
  ) {
    return ok(await this.costing.updateCosting(uid(req), productId, dto));
  }

  @Post(":productId/materials")
  async addMaterial(
    @Req() req: FastifyRequest,
    @Param("productId") productId: string,
    @Body() dto: CreateMaterialDto,
  ) {
    return ok(await this.costing.addMaterial(uid(req), productId, dto));
  }

  @Patch("materials/:bomItemId")
  async updateMaterial(
    @Req() req: FastifyRequest,
    @Param("bomItemId") bomItemId: string,
    @Body() dto: UpdateMaterialCostDto,
  ) {
    return ok(await this.costing.updateMaterial(uid(req), bomItemId, dto));
  }

  @Delete("materials/:bomItemId")
  async removeMaterial(@Req() req: FastifyRequest, @Param("bomItemId") bomItemId: string) {
    return ok(await this.costing.removeMaterial(uid(req), bomItemId));
  }

  @Post(":productId/suggest-price")
  async suggestPrice(
    @Req() req: FastifyRequest,
    @Param("productId") productId: string,
    @Body() dto: SuggestPriceDto,
  ) {
    return ok(await this.costing.suggestPrice(uid(req), productId, dto));
  }
}
