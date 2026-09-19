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
import { JwtAuthGuard, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { MasterPostingsService } from "./master-postings.service.js";
import {
  AddMappingDto,
  CreateMasterPostingDto,
  SetSkuDto,
  UpdateMasterPostingDto,
} from "./dto/master-postings.dto.js";

function uid(req: FastifyRequest): string {
  return (req as FastifyRequest & { user: JwtPayload }).user.sub;
}

@Controller("master-postings")
@UseGuards(JwtAuthGuard)
export class MasterPostingsController {
  constructor(private readonly svc: MasterPostingsService) {}

  @Get()
  async list(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.svc.list(uid(req)) };
  }

  @Post()
  async create(
    @Req() req: FastifyRequest,
    @Body() dto: CreateMasterPostingDto,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.svc.create(uid(req), dto) };
  }


  /** Impor listing marketplace jadi master posting (prefill otomatis). */
  @Post("import")
  async importListing(
    @Req() req: FastifyRequest,
    @Body() body: { shopId: string; productId: string },
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.svc.importFromListing(uid(req), body.shopId, body.productId) };
  }

  /** Master produk AutoToko untuk dropdown pemetaan SKU. */
  @Get("master-products")
  async masterProducts(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.svc.masterProductOptions(uid(req)) };
  }

  /** Produk marketplace sebuah toko (untuk memilih listing yang dipetakan). */
  @Get("shop-products")
  async shopProducts(
    @Req() req: FastifyRequest,
    @Query("shopId") shopId: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.svc.shopProducts(uid(req), shopId) };
  }

  @Get(":id")
  async detail(@Req() req: FastifyRequest, @Param("id") id: string): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.svc.get(uid(req), id) };
  }

  @Patch(":id")
  async update(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() dto: UpdateMasterPostingDto,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.svc.update(uid(req), id, dto) };
  }

  @Delete(":id")
  async remove(@Req() req: FastifyRequest, @Param("id") id: string): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.svc.remove(uid(req), id) };
  }

  /** Set kode SKU / peta ke master produk / harga / stok / gambar satu varian. */
  @Patch(":id/skus/:skuId")
  async setSku(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Param("skuId") skuId: string,
    @Body() dto: SetSkuDto,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.svc.setSku(uid(req), id, skuId, dto) };
  }

  @Post(":id/mappings")
  async addMapping(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() dto: AddMappingDto,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.svc.addMapping(uid(req), id, dto) };
  }

  @Delete(":id/mappings/:mappingId")
  async removeMapping(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Param("mappingId") mappingId: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.svc.removeMapping(uid(req), id, mappingId) };
  }

  /** TERAPKAN ke marketplace (tulisan keluar; klik eksplisit penjual). */
  @Post(":id/apply")
  async apply(@Req() req: FastifyRequest, @Param("id") id: string): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.svc.apply(uid(req), id) };
  }

  /** Terapkan SATU toko sesuai modenya di tabel (update = perbarui; create = distage). */
  @Post(":id/mappings/:mappingId/apply")
  async applyOne(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Param("mappingId") mappingId: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.svc.apply(uid(req), id, mappingId) };
  }
}
