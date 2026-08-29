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
  ValidateNested,
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
import { AppReleasesService } from "./app-releases.service.js";
import { OcrMemoryService } from "./ocr-memory.service.js";

function uid(req: FastifyRequest): string {
  return (req as FastifyRequest & { user: JwtPayload }).user.sub;
}

/** One barcode the phone decoded while looking at a label. */
class ScanCodeDto {
  @IsString() @MaxLength(64)
  value!: string;

  @IsOptional() @IsString() @MaxLength(32)
  format?: string;
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

  // --- What the phone made of the label while the packer held it.
  //
  // Sent alongside the photo rather than instead of it. The photo is still the
  // record and the server still reads it, but the phone had dozens of frames
  // at full sensor resolution and the server has one JPEG, so where the two
  // disagree the phone is usually the one that saw more.

  /** Read off the label. There is no order list to check it against. */
  @IsOptional() @IsString() @MaxLength(128)
  labelOrderNo?: string;

  /** Everything ML Kit read, for comparing the two engines. */
  @IsOptional() @IsString() @MaxLength(20_000)
  deviceText?: string;

  /** The scanner's own sharpness meter at the moment of capture. */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100)
  deviceClarity?: number;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ScannedItemDto)
  items?: ScannedItemDto[];

  /**
   * Where the parcel came from, as the packer confirmed it on the sheet.
   *
   * Optional throughout: a manual entry sends none of it and the scan is then
   * unmapped, which the pending-task list is there to surface.
   */
  @IsOptional() @IsUUID()
  shopId?: string;

  @IsOptional() @IsString() @MaxLength(24)
  marketplace?: string;

  @IsOptional() @IsString() @MaxLength(32)
  courierConfirmed?: string;

  /**
   * Every barcode seen on this label, not only the one that became the resi.
   *
   * A courier label carries several; the extras are what make a second scan of
   * the same parcel recognisable when a different one wins.
   */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ScanCodeDto)
  codes?: ScanCodeDto[];
}

/**
 * One product line as the scanner app resolved it.
 *
 * masterProductId is what the packer's phone matched or the packer confirmed;
 * rawName is the label's own wording, kept beside it rather than replaced, so
 * a bad match stays visible.
 */
class ScannedItemDto {
  @IsOptional() @IsUUID()
  masterProductId?: string;

  @IsOptional() @IsString() @MaxLength(255)
  rawName?: string;

  @Type(() => Number) @IsNumber() @Min(0.01) @Max(9999)
  qty!: number;

  /** device_auto when the phone was sure, device_confirmed when it asked. */
  @IsOptional() @IsIn(["device_auto", "device_confirmed", "manual"])
  source?: "device_auto" | "device_confirmed" | "manual";

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1)
  matchScore?: number;
}

class AddPageDto {
  @IsString() @MaxLength(12_000_000)
  photoBase64!: string;

  @IsOptional() @IsString() @MaxLength(20_000)
  deviceText?: string;
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

class ScanItemDto {
  /** Null/omitted leaves the line unmapped, which is a valid state. */
  @IsOptional() @IsUUID()
  masterProductId?: string | null;

  @IsOptional() @IsString() @MaxLength(255)
  rawName?: string;

  @Type(() => Number) @IsNumber() @Min(0.01)
  qty!: number;
}

class UpdateScanItemDto {
  @IsOptional() @IsUUID()
  masterProductId?: string | null;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01)
  qty?: number;
}

/**
 * Corrections to what the label says.
 *
 * Every field is optional and every field accepts null, which is the point:
 * OCR reads the fine print on these photographs essentially never, so most of
 * these arrive from a keyboard, and an operator who finds a wrong guess must
 * be able to empty the box as well as retype it.
 */
class LabelDto {
  @IsOptional() @IsString() @MaxLength(128) orderNo?: string | null;
  @IsOptional() @IsString() @MaxLength(255) recipient?: string | null;
  @IsOptional() @IsString() @MaxLength(200) recipientArea?: string | null;
  @IsOptional() @IsString() @MaxLength(400) recipientAddress?: string | null;
  /** The seller's own shop, as printed under "Pengirim". */
  @IsOptional() @IsString() @MaxLength(160) senderName?: string | null;
  @IsOptional() @IsString() @MaxLength(160) senderArea?: string | null;
  @IsOptional() @IsString() @MaxLength(32) marketplace?: string | null;
  @IsOptional() @IsString() @MaxLength(32) service?: string | null;
  @IsOptional() @IsString() @MaxLength(48) sortCode?: string | null;
  @IsOptional() @IsString() @MaxLength(64) packageId?: string | null;
  @IsOptional() @IsString() @MaxLength(120) buyerNickname?: string | null;
  @IsOptional() @IsString() @MaxLength(32) shipDate?: string | null;

  @IsOptional() @IsBoolean() cod?: boolean | null;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1000) weightKg?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(9999) qtyTotal?: number | null;
}

class RecheckBulkDto {
  /** Hand-picked scans. Takes precedence over scope when both are sent. */
  @IsOptional() @IsArray() @IsUUID("4", { each: true })
  ids?: string[];

  /** failed = the reader gave up, blank = it read nothing useful. */
  @IsOptional() @IsIn(["failed", "blank", "all"])
  scope?: "failed" | "blank" | "all";

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
    private readonly appReleases: AppReleasesService,
    private readonly memory: OcrMemoryService,
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

  /**
   * Every build handed out, newest first, with only the current one carrying
   * a download link.
   *
   * An older APK still sitting on disk is a support problem waiting to
   * happen: it talks to an API that has moved on, and the failure reaches the
   * seller as "the app is broken" rather than "you are on last month's build".
   */
  @Get("app/releases")
  async releases(): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.appReleases.list() };
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

  // --- What was in the parcel -----------------------------------------

  @Get("scans/:id/items")
  async listItems(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.listItems(uid(req), id) };
  }

  @Post("scans/:id/items")
  async addItem(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() dto: ScanItemDto,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.addItem(uid(req), id, dto) };
  }

  @Patch("scans/:id/items/:itemId")
  async updateItem(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @Body() dto: UpdateScanItemDto,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.updateItem(uid(req), id, itemId, dto) };
  }

  /**
   * "This is what was in the parcel."
   *
   * Its own call rather than a side effect of editing a line, because the
   * editor saves as you type and none of those saves is a person declaring
   * they are finished.
   */
  /**
   * The shops, couriers and marketplaces to choose from, plus a guess.
   *
   * Ranked on the server because the label text it is matched against was read
   * there too; matching again on the handset would give two answers to one
   * question with no way to tell which was shown.
   */
  /**
   * The lists alone, with no scan to guess against.
   *
   * The phone's mapping sheet opens before the parcel is saved, so there is no
   * id yet — it needs the choices, not a suggestion.
   */
  /**
   * Everything learned from past corrections, for the phone to carry offline.
   *
   * Sent whole rather than queried per scan: the sheet opens in the moment
   * after a barcode reads, and a round trip there is a delay the packer feels.
   */
  /** One day's packing, for the end-of-shift message. */
  @Get("daily-recap")
  async dailyRecap(
    @Req() req: FastifyRequest,
    @Query("date") date?: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.dailyRecap(uid(req), date) };
  }

  @Get("ocr-hints")
  async ocrHints(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.memory.hints(uid(req)) };
  }

  /**
   * Kurir yang boleh dipilih: bawaan dari kode, tambahan dari seller.
   *
   * Dipisah di sini -- tidak seperti mapping-options yang menggabungkannya --
   * karena layar yang mengelola perlu tahu mana yang boleh dihapus.
   */
  @Get("couriers")
  async couriers(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.couriers(uid(req)) };
  }

  @Post("couriers")
  async addCourier(
    @Req() req: FastifyRequest,
    @Body() body: { name: string },
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.addCourier(uid(req), body?.name) };
  }

  @Delete("couriers/:id")
  async removeCourier(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.removeCourier(uid(req), id) };
  }

  @Get("mapping-options")
  async mappingLists(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.mappingOptions(uid(req)) };
  }

  @Get("scans/:id/mapping-options")
  async mappingOptions(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.mappingOptions(uid(req), id) };
  }

  /**
   * Map several scans at once, for the backlog recorded before mapping existed.
   *
   * The phone can only reach what it recently scanned; everything older is
   * only fixable from here.
   */
  @Post("scans/mapping-bulk")
  async confirmMappingBulk(
    @Req() req: FastifyRequest,
    @Body() body: { scanIds: string[]; shopId?: string | null; marketplace?: string | null; courier?: string | null },
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.confirmMappingBulk(uid(req), { ...body, by: "web" }) };
  }

  /** Where the parcel came from — shop, marketplace, courier — as decided. */
  @Post("scans/:id/mapping")
  async confirmMapping(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() body: { shopId?: string | null; marketplace?: string | null; courier?: string | null; by?: string },
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.confirmMapping(uid(req), id, body) };
  }

  @Post("scans/:id/items/confirm")
  async confirmItems(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() body: { by?: string },
  ) {
    return { success: true, data: await this.resi.confirmItems(uid(req), id, body?.by) };
  }

  @Delete("scans/:id/items/:itemId")
  async removeItem(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Param("itemId") itemId: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.removeItem(uid(req), id, itemId) };
  }

  // --- What the label says, and reading it again ----------------------

  /** Every field recorded from one label, plus the raw OCR text behind it. */
  @Get("scans/:id/label")
  async labelDetail(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.labelDetail(uid(req), id) };
  }

  /** Correct the label by hand; stops the reader overwriting what you typed. */
  @Patch("scans/:id/label")
  async updateLabel(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() dto: LabelDto,
  ): Promise<ApiResponse<unknown>> {
    return {
      success: true,
      data: await this.resi.updateLabel(uid(req), id, dto as Record<string, never>),
    };
  }

  /** Queue this scan's saved photo to be read again. */
  @Post("scans/:id/recheck-ocr")
  async recheckOcr(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.recheckOcr(uid(req), id) };
  }

  /** Queue a batch: named ids, or everything that failed or came back blank. */
  @Post("recheck-ocr")
  async recheckOcrBulk(
    @Req() req: FastifyRequest,
    @Body() dto: RecheckBulkDto,
  ): Promise<ApiResponse<unknown>> {
    return {
      success: true,
      data: await this.resi.recheckOcrBulk(uid(req), {
        ids: dto.ids,
        scope: dto.scope,
        limit: dto.limit,
      }),
    };
  }

  /** Another sheet of the same waybill; triggers a re-read of the whole set. */
  @Post("scans/:id/pages")
  async addPage(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() dto: AddPageDto,
  ): Promise<ApiResponse<unknown>> {
    return {
      success: true,
      data: await this.resi.addPage(uid(req), id, dto.photoBase64, dto.deviceText),
    };
  }

  @Get("scans/:id/pages")
  async listPages(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.listPages(uid(req), id) };
  }

  @Delete("scans/:id")
  async remove(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.resi.remove(uid(req), id) };
  }
}
