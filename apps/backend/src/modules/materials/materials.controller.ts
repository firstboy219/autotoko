import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, TenantOwnerOnly, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { MaterialsService } from "./materials.service.js";
import {
  CreatePurchaseDto,
  ParseReceiptDto,
  UpdateMaterialDto,
} from "./dto/materials.dto.js";

function uid(req: FastifyRequest): string {
  return (req as FastifyRequest & { user: JwtPayload }).user.sub;
}
const ok = <T>(data: T): ApiResponse<T> => ({ success: true, data });

@Controller("materials")
@UseGuards(JwtAuthGuard)
@TenantOwnerOnly()
export class MaterialsController {
  constructor(private readonly materials: MaterialsService) {}

  @Get()
  async list(@Req() req: FastifyRequest) {
    return ok(await this.materials.list(uid(req)));
  }

  @Patch(":id")
  async update(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() dto: UpdateMaterialDto,
  ) {
    return ok(await this.materials.updateMaterial(uid(req), id, dto));
  }

  /** OCR only — proposes rows, writes nothing. */
  @Post("purchases/parse")
  async parse(@Req() req: FastifyRequest, @Body() dto: ParseReceiptDto) {
    return ok(await this.materials.parseReceipt(uid(req), dto.imageUrl));
  }

  @Get("purchases")
  async listPurchases(@Req() req: FastifyRequest) {
    return ok(await this.materials.listPurchases(uid(req)));
  }

  @Get("purchases/:id")
  async getPurchase(@Req() req: FastifyRequest, @Param("id") id: string) {
    return ok(await this.materials.getPurchase(uid(req), id));
  }

  @Post("purchases")
  async createPurchase(@Req() req: FastifyRequest, @Body() dto: CreatePurchaseDto) {
    return ok(await this.materials.createPurchase(uid(req), dto));
  }
}
