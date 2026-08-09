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
import { CostingService } from "./costing.service.js";
import {
  AddPackingMaterialDto,
  CreateMaterialDto,
  LinkMaterialDto,
  SetProductPackingDto,
  SuggestPriceDto,
  UpdateCostingDto,
  UpdateMaterialCostDto,
  UpdatePackingDefaultDto,
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
  async list(
    @Req() req: FastifyRequest,
    @Query("brandId") brandId?: string,
  ) {
    return ok(await this.costing.list(uid(req), brandId || null));
  }

  // Declared BEFORE @Get(":productId") — otherwise "packing-materials" is
  // captured as a product id and every request 404s on a lookup for something
  // that was never a product.
  @Get("packing-materials")
  async listPacking(@Req() req: FastifyRequest) {
    return ok(await this.costing.listPackingMaterials(uid(req)));
  }

  @Post("packing-materials")
  async addPacking(@Req() req: FastifyRequest, @Body() dto: AddPackingMaterialDto) {
    return ok(
      await this.costing.addPackingMaterial(
        uid(req),
        {
          materialId: dto.materialId,
          materialName: dto.materialName,
          unit: dto.unit,
          unitCost: dto.unitCost,
        },
        dto.defaultQuantity,
      ),
    );
  }

  @Patch("packing-materials/:id")
  async updatePacking(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() dto: UpdatePackingDefaultDto,
  ) {
    return ok(await this.costing.updatePackingDefault(uid(req), id, dto.defaultQuantity));
  }

  @Delete("packing-materials/:id")
  async removePacking(@Req() req: FastifyRequest, @Param("id") id: string) {
    return ok(await this.costing.removePackingMaterial(uid(req), id));
  }

  /** What ONE product uses; omit quantity to fall back to the shared default. */
  @Patch(":productId/packing/:packingMaterialId")
  async setProductPacking(
    @Req() req: FastifyRequest,
    @Param("productId") productId: string,
    @Param("packingMaterialId") packingMaterialId: string,
    @Body() dto: SetProductPackingDto,
  ) {
    return ok(
      await this.costing.setProductPackingQuantity(
        uid(req),
        productId,
        packingMaterialId,
        dto.quantity ?? null,
      ),
    );
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

  /** Attaches an old free-text recipe line to the shared catalogue. */
  @Patch("materials/:bomItemId/link")
  async linkMaterial(
    @Req() req: FastifyRequest,
    @Param("bomItemId") bomItemId: string,
    @Body() dto: LinkMaterialDto,
  ) {
    return ok(await this.costing.linkMaterialToCatalog(uid(req), bomItemId, dto.materialId));
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

  /** Average units per shipment, derived from real order history. */
  @Get("meta/avg-units-per-order")
  async avgUnits(@Req() req: FastifyRequest) {
    return ok(await this.costing.suggestAvgUnitsPerOrder(uid(req)));
  }
}
