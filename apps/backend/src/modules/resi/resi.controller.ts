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
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  Matches,
} from "class-validator";
import { Type } from "class-transformer";
import type { FastifyRequest } from "fastify";
import type { ApiResponse } from "@autotoko/shared";
import {
  AdminOnly,
  JwtAuthGuard,
  TenantOwnerOnly,
  type JwtPayload,
} from "../auth/jwt-auth.guard.js";
import { ResiService } from "./resi.service.js";
import { CourierTrackingService } from "./courier-tracking.service.js";

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

  // "barcode" is what the app sends now that the waybill is decoded rather
  // than read visually. "ocr" stays accepted so an older installed APK keeps
  // working through a staged rollout instead of failing every scan.
  @IsOptional() @IsIn(["barcode", "ocr", "manual"])
  source?: "barcode" | "ocr" | "manual";

  @IsOptional() @IsString() @MaxLength(64)
  deviceLabel?: string;

  /** JPEG of the label, base64. Read by OCR later, not on this request. */
  @IsOptional() @IsString() @MaxLength(12_000_000)
  photoBase64?: string;

  @IsOptional() @IsString() @MaxLength(32)
  barcodeFormat?: string;
}

class LinkDto {
  @IsUUID()
  orderId!: string;
}

class TrackingConfigDto {
  @IsOptional() @IsString() @MaxLength(200)
  apiKey?: string;

  @IsOptional() @IsString() @MaxLength(40)
  provider?: string;

  @IsOptional() @IsBoolean()
  blockInTransit?: boolean;
}

class TrackingTestDto {
  @IsString() @MaxLength(200)
  apiKey!: string;

  @IsString() @MaxLength(40)
  courier!: string;

  @IsString() @MaxLength(64)
  awb!: string;
}

class PackingSettingsDto {
  @Type(() => Number) @IsNumber() @Min(0) @Max(10_000_000)
  feePerResi!: number;
}

class PayDto {
  /** Settle a whole day (YYYY-MM-DD), or hand-pick parcels with ids. */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "Tanggal harus YYYY-MM-DD." })
  day?: string;

  @IsOptional() @IsArray() @IsUUID("4", { each: true })
  ids?: string[];

  @IsOptional() @IsString() @MaxLength(120)
  note?: string;
}

class DailyQuery {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  limit?: number;
}

class ListQuery {
  @IsOptional() @IsString() @MaxLength(64)
  q?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;

  /** "yes" = only scans already attached to an order, "no" = only loose ones. */
  @IsOptional() @IsIn(["yes", "no"])
  linked?: "yes" | "no";
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
  constructor(
    private readonly resi: ResiService,
    private readonly tracking: CourierTrackingService,
  ) {}

  /** 201 on a new resi; 409 with the earlier scan's details on a repeat. */
  @Post("scan")
  async scan(@Req() req: FastifyRequest, @Body() dto: ScanDto): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.scan(uid(req), dto) };
  }

  @Get("scans")
  async list(@Req() req: FastifyRequest, @Query() q: ListQuery): Promise<ApiResponse<unknown>> {
    return {
      success: true,
      data: await this.resi.list(uid(req), {
        q: q.q,
        limit: q.limit,
        offset: q.offset,
        linked: q.linked,
      }),
    };
  }

  /** Where to get the scanner APK, or null when none is published. */
  @Get("app-download")
  async appDownload(): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.appDownload() };
  }

  @Get("scans/summary")
  async summary(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.summary(uid(req)) };
  }

  /** Orders a loose scan can still be attached to. */
  @Get("linkable-orders")
  async linkable(
    @Req() req: FastifyRequest,
    @Query("q") q?: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.linkableOrders(uid(req), q) };
  }

  /** Attach a scan to an order: writes the resi onto it and marks it dikirim. */
  @Post("scans/:id/link")
  async link(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() dto: LinkDto,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.link(uid(req), id, dto.orderId) };
  }

  @Delete("scans/:id/link")
  async unlink(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.unlink(uid(req), id) };
  }

  // --- Courier tracking ---------------------------------------------

  @Get("tracking-config")
  @AdminOnly()
  async trackingConfig(): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.tracking.getConfig() };
  }

  @Patch("tracking-config")
  @AdminOnly()
  async saveTrackingConfig(@Body() dto: TrackingConfigDto): Promise<ApiResponse<unknown>> {
    return {
      success: true,
      data: await this.tracking.saveConfig({
        apiKey: dto.apiKey,
        provider: dto.provider,
        blockInTransit: dto.blockInTransit,
      }),
    };
  }

  @Post("tracking-test")
  @AdminOnly()
  async testTracking(@Body() dto: TrackingTestDto): Promise<ApiResponse<unknown>> {
    return {
      success: true,
      data: await this.tracking.testKey(dto.apiKey, dto.courier, dto.awb),
    };
  }

  // --- Packing wage -------------------------------------------------

  @Get("packing-settings")
  async packingSettings(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.getSettings(uid(req)) };
  }

  @Patch("packing-settings")
  async savePackingSettings(
    @Req() req: FastifyRequest,
    @Body() dto: PackingSettingsDto,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.saveSettings(uid(req), dto.feePerResi) };
  }

  /** Parcels handed over per Jakarta day, with what is owed and what is settled. */
  @Get("daily")
  async daily(
    @Req() req: FastifyRequest,
    @Query() q: DailyQuery,
  ): Promise<ApiResponse<unknown>> {
    return {
      success: true,
      data: await this.resi.daily(uid(req), { from: q.from, to: q.to, limit: q.limit }),
    };
  }

  @Post("pay-packer")
  async payPacker(
    @Req() req: FastifyRequest,
    @Body() dto: PayDto,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.payPacker(uid(req), dto) };
  }

  @Post("unpay-packer")
  async unpayPacker(
    @Req() req: FastifyRequest,
    @Body() dto: PayDto,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.unpayPacker(uid(req), dto) };
  }

  @Delete("scans/:id")
  async remove(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.remove(uid(req), id) };
  }
}
