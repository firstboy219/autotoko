import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import type { FastifyRequest } from "fastify";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, TenantOwnerOnly, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { MarketplaceSyncService } from "../marketplace-sync/marketplace-sync.service.js";
import { PromotionAutomationService } from "./promotion-automation.service.js";
import { PromoCardsService } from "./promo-cards.service.js";

function uid(req: FastifyRequest): string {
  return (req as FastifyRequest & { user: JwtPayload }).user.sub;
}
const ok = <T>(data: T): ApiResponse<T> => ({ success: true, data });

class AddProductsDto {
  @IsArray() products!: Array<Record<string, unknown>>;
}
class CreateActivityDto {
  @IsString() activityType!: string;
  @IsString() @MaxLength(50) title!: string;
  @IsOptional() @IsNumber() beginTime?: number;
  @IsOptional() @IsNumber() endTime?: number;
  @IsOptional() @IsString() durationType?: string;
  @IsOptional() @IsString() productLevel?: string;
}
class UpdateActivityDto {
  @IsOptional() @IsString() @MaxLength(50) title?: string;
  @IsOptional() @IsNumber() beginTime?: number;
  @IsOptional() @IsNumber() endTime?: number;
}
class RemoveProductsDto {
  @IsArray() @IsString({ each: true }) productIds!: string[];
}
class ReplicateDto {
  @IsArray() @IsString({ each: true }) targetShopIds!: string[];
  @IsOptional() @IsNumber() @Min(0) @Max(99) discountPct?: number;
}
class AutomationDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() dryRun?: boolean;
  @IsOptional() @IsBoolean() onlyOngoing?: boolean;
  @IsOptional() @IsNumber() @Min(0) minUpliftPct?: number;
  @IsOptional() @IsBoolean() requireProfit?: boolean;
  @IsOptional() @IsNumber() @Min(0) minOrders?: number;
  @IsOptional() @IsBoolean() autoExtend?: boolean;
  @IsOptional() @IsNumber() @Min(1) @Max(90) extendDays?: number;
  @IsOptional() @IsBoolean() autoReplicate?: boolean;
  @IsOptional() @IsNumber() @Min(0) @Max(99) replicateDiscountPct?: number;
}
class ReplicateProdukDto {
  @IsArray() @IsString({ each: true }) targetShopIds!: string[];
  @IsOptional() @IsBoolean() dryRun?: boolean;
  @IsOptional() @IsNumber() beginTime?: number;
  @IsOptional() @IsNumber() endTime?: number;
}
class ReactivateDto {
  @IsOptional() @IsNumber() @Min(1) @Max(365) days?: number;
  @IsOptional() @IsNumber() beginTime?: number;
  @IsOptional() @IsNumber() endTime?: number;
  @IsOptional() @IsBoolean() dryRun?: boolean;
}
class ExtendDto {
  @IsOptional() @IsNumber() @Min(1) @Max(365) days?: number;
  @IsOptional() @IsNumber() endTime?: number;
}
class RunDto {
  @IsOptional() @IsBoolean() dryRun?: boolean;
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
  constructor(
    private readonly sync: MarketplaceSyncService,
    private readonly auto: PromotionAutomationService,
    private readonly cardsSvc: PromoCardsService,
  ) {}

  /** Kartu promo berfokus produk (APK): produk, potongan, rentang tanggal. */
  @Get("cards")
  async cards(@Req() req: FastifyRequest, @Query("status") status?: string) {
    return ok(await this.cardsSvc.cards(uid(req), status ?? ""));
  }

  /**
   * Replikasi promo dengan produk & potongan yang SAMA ke toko lain.
   * dryRun=true -> rencana pemetaan saja; false -> aksi outward (klik seller).
   */
  /** Aktifkan kembali promo berakhir/nonaktif = buat ulang di toko sama (aksi outward bila dryRun=false). */
  @Post("activities/:shopId/:activityId/reactivate")
  async reactivate(@Req() req: FastifyRequest, @Param("shopId") shopId: string, @Param("activityId") activityId: string, @Body() dto: ReactivateDto) {
    return ok(await this.cardsSvc.reactivate(uid(req), shopId, activityId, dto));
  }

  /** Perpanjang promo berjalan/akan datang (aksi outward). */
  @Post("activities/:shopId/:activityId/extend")
  async extend(@Req() req: FastifyRequest, @Param("shopId") shopId: string, @Param("activityId") activityId: string, @Body() dto: ExtendDto) {
    return ok(await this.cardsSvc.extend(uid(req), shopId, activityId, dto));
  }

  @Post("activities/:shopId/:activityId/replicate-produk")
  async replicateProduk(@Req() req: FastifyRequest, @Param("shopId") shopId: string, @Param("activityId") activityId: string, @Body() dto: ReplicateProdukDto) {
    return ok(await this.cardsSvc.replicate(uid(req), shopId, activityId, dto));
  }

  @Get("activities")
  async activities(@Req() req: FastifyRequest, @Query("status") status?: string, @Query("type") type?: string, @Query("title") title?: string) {
    return ok(await this.sync.promoListActivities(uid(req), { status, type, title }));
  }

  /** Buat activity promo baru (aksi outward). */
  @Post("activities/:shopId")
  async create(@Req() req: FastifyRequest, @Param("shopId") shopId: string, @Body() dto: CreateActivityDto) {
    const body: Record<string, unknown> = {
      activity_type: dto.activityType,
      title: dto.title,
      product_level: dto.productLevel ?? "PRODUCT",
      duration_type: dto.durationType ?? "NORMAL",
      ...(dto.beginTime ? { begin_time: dto.beginTime } : {}),
      ...(dto.endTime ? { end_time: dto.endTime } : {}),
    };
    return ok(await this.sync.promoCreate(uid(req), shopId, body));
  }

  /** Ubah activity (judul/waktu). */
  @Put("activities/:shopId/:activityId")
  async update(@Req() req: FastifyRequest, @Param("shopId") shopId: string, @Param("activityId") activityId: string, @Body() dto: UpdateActivityDto) {
    const body: Record<string, unknown> = {
      ...(dto.title != null ? { title: dto.title } : {}),
      ...(dto.beginTime ? { begin_time: dto.beginTime } : {}),
      ...(dto.endTime ? { end_time: dto.endTime } : {}),
    };
    return ok(await this.sync.promoUpdate(uid(req), shopId, activityId, body));
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

  /** Hapus produk dari activity (aksi outward). */
  @Post("activities/:shopId/:activityId/products/remove")
  async removeProducts(@Req() req: FastifyRequest, @Param("shopId") shopId: string, @Param("activityId") activityId: string, @Body() dto: RemoveProductsDto) {
    return ok(await this.sync.promoRemoveProducts(uid(req), shopId, activityId, dto.productIds));
  }

  /** Replikasi promo ke toko lain (aksi outward). */
  @Post("activities/:shopId/:activityId/replicate")
  async replicate(@Req() req: FastifyRequest, @Param("shopId") shopId: string, @Param("activityId") activityId: string, @Body() dto: ReplicateDto) {
    return ok(await this.sync.replicatePromo(uid(req), shopId, activityId, dto.targetShopIds, dto.discountPct ?? 10));
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

  @Get("coupons/:shopId/:couponId")
  async couponDetail(@Req() req: FastifyRequest, @Param("shopId") shopId: string, @Param("couponId") couponId: string) {
    return ok(await this.sync.promoCouponDetail(uid(req), shopId, couponId));
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

  // --- Otomasi Promosi ---
  @Get("automation")
  async getAutomation(@Req() req: FastifyRequest) {
    return ok(await this.auto.getSettings(uid(req)));
  }

  @Put("automation")
  async setAutomation(@Req() req: FastifyRequest, @Body() dto: AutomationDto) {
    return ok(await this.auto.setSettings(uid(req), dto));
  }

  /** Jalankan alur otomasi sekarang (hormati dryRun; aksi outward bila live). */
  @Post("automation/run")
  async runAutomation(@Req() req: FastifyRequest, @Body() dto: RunDto) {
    return ok(await this.auto.run(uid(req), { dryRun: dto.dryRun }));
  }

  /** Evaluasi 1 promo (penjualan vs periode sebelum + net). */
  @Get("activities/:shopId/:activityId/evaluate")
  async evaluate(@Req() req: FastifyRequest, @Param("shopId") shopId: string, @Param("activityId") activityId: string) {
    return ok(await this.auto.evaluateActivity(uid(req), shopId, activityId));
  }
}
