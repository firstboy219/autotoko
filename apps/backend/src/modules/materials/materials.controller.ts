import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, TenantOwnerOnly, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { MaterialsService } from "./materials.service.js";
import {
  CreateMaterialDto,
  CreatePurchaseDto,
  RecordDeliveryDto,
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

  @Post()
  async create(@Req() req: FastifyRequest, @Body() dto: CreateMaterialDto) {
    return ok(await this.materials.createMaterial(uid(req), dto));
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
  @Get(":id/usage")
  async usage(@Req() req: FastifyRequest, @Param("id") id: string) {
    return ok(await this.materials.materialUsage(uid(req), id));
  }

  /**
   * Deleting a material in use is refused unless a replacement is named — the
   * FK would otherwise unlink recipe lines silently and leave them costing
   * from a stale copy.
   */
  @Delete(":id")
  async remove(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Query("replaceWith") replaceWith?: string,
  ) {
    return ok(await this.materials.deleteMaterial(uid(req), id, replaceWith || null));
  }

  /**
   * Report a parcel of raw materials arriving at the packing room.
   *
   * Same shape as the packing scan on purpose: one waybill, a photo, and the
   * mapping of what was inside. The difference is that this adds to stock
   * instead of taking it away.
   */
  @Post("deliveries")
  async recordDelivery(@Req() req: FastifyRequest, @Body() dto: RecordDeliveryDto) {
    return ok(await this.materials.recordDelivery(uid(req), dto));
  }

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
