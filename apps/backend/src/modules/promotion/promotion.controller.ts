import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, Max, Min } from "class-validator";
import type { FastifyRequest } from "fastify";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, TenantOwnerOnly, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { MarketplaceSyncService } from "../marketplace-sync/marketplace-sync.service.js";

function uid(req: FastifyRequest): string {
  return (req as FastifyRequest & { user: JwtPayload }).user.sub;
}
const ok = <T>(data: T): ApiResponse<T> => ({ success: true, data });

class AddProductsDto {
  @IsArray() products!: Array<Record<string, unknown>>;
}
class PromoSettingsDto {
  @IsOptional() @IsBoolean() autoJoin?: boolean;
  @IsOptional() @IsString() activityId?: string | null;
  @IsOptional() @IsNumber() @Min(0) @Max(99) discountPct?: number;
}

@Controller("promotion")
@UseGuards(JwtAuthGuard)
@TenantOwnerOnly()
export class PromotionController {
  constructor(private readonly sync: MarketplaceSyncService) {}

  @Get("activities")
  async activities(@Req() req: FastifyRequest, @Query("status") status?: string, @Query("type") type?: string, @Query("title") title?: string) {
    return ok(await this.sync.promoListActivities(uid(req), { status, type, title }));
  }

  @Get("activities/:shopId/:activityId")
  async activityDetail(@Req() req: FastifyRequest, @Param("shopId") shopId: string, @Param("activityId") activityId: string) {
    return ok(await this.sync.promoActivityDetail(uid(req), shopId, activityId));
  }

  /** Tambah produk ke activity (aksi outward — memicu harga promo). */
  @Put("activities/:shopId/:activityId/products")
  async addProducts(@Req() req: FastifyRequest, @Param("shopId") shopId: string, @Param("activityId") activityId: string, @Body() dto: AddProductsDto) {
    return ok(await this.sync.promoAddProducts(uid(req), shopId, activityId, dto.products));
  }

  /** Nonaktifkan activity (aksi outward). */
  @Post("activities/:shopId/:activityId/deactivate")
  async deactivate(@Req() req: FastifyRequest, @Param("shopId") shopId: string, @Param("activityId") activityId: string) {
    return ok(await this.sync.promoDeactivate(uid(req), shopId, activityId));
  }

  @Get("coupons")
  async coupons(@Req() req: FastifyRequest, @Query("status") status?: string) {
    return ok(await this.sync.promoListCoupons(uid(req), { status }));
  }

  @Get("settings")
  async getSettings(@Req() req: FastifyRequest) {
    return ok(await this.sync.getPromoSettings(uid(req)));
  }

  @Put("settings/:shopId")
  async setSettings(@Req() req: FastifyRequest, @Param("shopId") shopId: string, @Body() dto: PromoSettingsDto) {
    return ok(await this.sync.setPromoSettings(uid(req), shopId, dto));
  }

  /** Auto-ikut: daftarkan produk aktif toko ke activity target (aksi outward). */
  @Post("settings/:shopId/apply")
  async applyAutoJoin(@Req() req: FastifyRequest, @Param("shopId") shopId: string) {
    return ok(await this.sync.applyAutoJoin(uid(req), shopId));
  }
}
