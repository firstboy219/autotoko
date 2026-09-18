import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
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
import { MarketplaceSyncService, type JenisSync } from "./marketplace-sync.service.js";

function uid(req: FastifyRequest): string {
  return (req as FastifyRequest & { user: JwtPayload }).user.sub;
}

@Controller("marketplace-sync")
@UseGuards(JwtAuthGuard)
export class MarketplaceSyncController {
  private readonly logger = new Logger(MarketplaceSyncController.name);
  constructor(private readonly sync: MarketplaceSyncService) {}

  /** Toko yang bisa disinkronkan milik pengguna ini. */
  @Get("shops")
  async daftar(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    const toko = await this.sync.tokoSiap(uid(req));
    return {
      success: true,
      data: toko.map((t) => ({
        id: t.id,
        shopName: t.shopName,
        marketplace: t.marketplace,
        lastSyncAt: t.lastSyncAt,
        accessTokenExpireAt: t.accessTokenExpireAt,
      })),
    };
  }

  /**
   * Memulai sinkronisasi satu toko dan LANGSUNG kembali.
   *
   * Toko terbesar hari ini 9.045 pesanan -- sembilan puluh halaman, lebih
   * dari dua menit. Menahan permintaan HTTP selama itu menabrak batas waktu
   * proxy dan meninggalkan run setengah jalan yang tidak dilaporkan. Jadi
   * run dijalankan di latar -- service membungkus tiap sentuhan DB dengan
   * bypass sendiri, jadi tidak ada satu transaksi panjang -- dan kemajuannya
   * dibaca lewat /runs.
   */
  @Post("shops/:id")
  async mulai(
    @Req() req: FastifyRequest,
    @Param("id") shopId: string,
    @Body() body: { kind?: JenisSync | "all" },
  ): Promise<ApiResponse<unknown>> {
    const kind = body?.kind ?? "all";
    if (!["orders", "products", "all"].includes(kind)) {
      throw new BadRequestException("kind harus orders, products, atau all");
    }
    const userId = uid(req);
    // Kepemilikan diperiksa DI SINI sebelum apa pun berjalan. tokoSiap
    // menyaring per userId di dalam SQL, jadi hanya toko pengguna ini yang
    // pernah bisa terpilih.
    const milik = (await this.sync.tokoSiap(userId)).find((t) => t.id === shopId);
    if (!milik) throw new BadRequestException("Toko tidak ditemukan atau belum tersambung");

    void this.sync
      .syncToko(shopId, kind, "manual", userId)
      .catch((e) => {
        // Galat yang terjadi SEBELUM mulaiRun tidak punya baris sync_runs
        // untuk menampungnya, jadi harus muncul di log -- kalau tidak, ia
        // hilang tanpa jejak, persis yang menyembunyikan bug jalur inkremental.
        this.logger.error(`Sync latar ${shopId} (${kind}): ${(e as Error).stack ?? (e as Error).message}`);
      });

    return { success: true, data: { started: true, shopId, kind } };
  }

  /**
   * Samakan judul semua postingan aktif satu katalog dengan nama katalog,
   * langsung di marketplace (partial_edit). Menulis ke toko publik pengguna.
   */
  @Post("catalogs/:id/push-names")
  async pushNames(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.sync.pushCatalogNames(uid(req), id) };
  }

  /** Backfill nama varian dari detail marketplace (mengisi sku_name kosong). */
  @Post("returns/sync")
  async returnsSync(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.sync.syncReturns(uid(req)) };
  }

  @Get("returns")
  async returnsList(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.sync.listReturns(uid(req)) };
  }

  @Post("chat/sync")
  async chatSync(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.sync.syncChat(uid(req)) };
  }

  @Post("enrich-names")
  async enrichNames(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.sync.perbaikiNamaVarian(uid(req)) };
  }

  /** Batch packing: RTS bila perlu + kembalikan label(base64)+item, set packing. */
  @Post("orders/batch-packing")
  async batchPacking(
    @Req() req: FastifyRequest,
    @Body() body: { orderIds: string[]; handoverMethod?: string; pickupSlot?: { startTime: number; endTime: number }; takeouts?: { orderId: string; reason?: string }[] },
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.sync.batchPacking(uid(req), body?.orderIds ?? [], { handoverMethod: body?.handoverMethod, pickupSlot: body?.pickupSlot, takeouts: body?.takeouts }) };
  }

  /** Mulai batch packing ASINKRON (kembalikan batchId cepat; proses PDF di background). */
  @Post("orders/batch-packing-start")
  async batchPackingStart(
    @Req() req: FastifyRequest,
    @Body() body: { orderIds: string[]; handoverMethod?: string; pickupSlot?: { startTime: number; endTime: number }; takeouts?: { orderId: string; reason?: string }[] },
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.sync.batchPackingStart(uid(req), body?.orderIds ?? [], { handoverMethod: body?.handoverMethod, pickupSlot: body?.pickupSlot, takeouts: body?.takeouts }) };
  }

  /** Status + hasil (URL PDF resi & packing list) sebuah batch packing. */
  @Get("batch-packing/:id")
  async getBatchPacking(@Req() req: FastifyRequest, @Param("id") id: string): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.sync.getBatchPacking(uid(req), id) };
  }

  /** Saldo bisa ditarik per toko, direkonstruksi dari Finance API (Get Withdrawals). */
  @Get("saldo-tiktok")
  async saldoTiktok(
    @Req() req: FastifyRequest,
    @Query("shopId") shopId?: string,
    @Query("live") live?: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.sync.saldoTiktok(uid(req), shopId ?? null, live === "1" || live === "true") };
  }

  /** Set/hapus cutoff Saldo Cepat sebuah toko. */
  @Post("saldo-cutoff")
  async setSaldoCutoff(
    @Req() req: FastifyRequest,
    @Body() body: { shopId: string; tanggal?: string | null; saldo?: number | null },
  ): Promise<ApiResponse<unknown>> {
    return {
      success: true,
      data: await this.sync.setSaldoCutoff(uid(req), body?.shopId, body?.tanggal ?? null, body?.saldo ?? null),
    };
  }

  /** Audit Pesanan sumber API: tarik settlement per pesanan dari TikTok Finance. */
  @Post("tarik-pencairan")
  async tarikPencairan(
    @Req() req: FastifyRequest,
    @Body() body: { shopId?: string | null; from: string; to: string },
  ): Promise<ApiResponse<unknown>> {
    return {
      success: true,
      data: await this.sync.tarikPencairanApi(uid(req), {
        shopId: body?.shopId ?? null,
        from: body?.from,
        to: body?.to,
      }),
    };
  }

  /** E: dorong SKU varian mengikuti SKU master (push ke listing TikTok). */
  @Post("skus/:skuId/push-seller-sku")
  async pushSellerSku(@Req() req: FastifyRequest, @Param("skuId") skuId: string): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.sync.pushSellerSku(uid(req), skuId) };
  }

  /** Daftar batch yang sudah dibuat (poin 1: tampil di halaman order). */
  @Get("batches")
  async batches(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.sync.listBatches(uid(req)) };
  }

  @Get("batches/:id")
  async batch(@Req() req: FastifyRequest, @Param("id") id: string): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.sync.getBatch(uid(req), id) };
  }

  /** Edit batch: ganti catatan &/atau ubah anggota (tambah/lepas order). */
  @Patch("batches/:id")
  async editBatch(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() body: { note?: string; addOrderIds?: string[]; removeOrderIds?: string[] },
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.sync.editBatch(uid(req), id, { note: body?.note, addOrderIds: body?.addOrderIds, removeOrderIds: body?.removeOrderIds }) };
  }

  /** Batalkan batch: bubarkan grup (lepas order + status cancelled). */
  @Post("batches/:id/cancel")
  async cancelBatch(@Req() req: FastifyRequest, @Param("id") id: string): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.sync.cancelBatch(uid(req), id) };
  }

  /** Ambil URL label AWB order dari marketplace (read-only). */
  @Get("orders/:id/label")
  async labelOrder(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.sync.labelOrder(uid(req), id) };
  }

  /** Slot jadwal jemput (pickup) untuk order sameday/instant. */
  @Get("orders/:id/slot-jemput")
  async slotJemput(@Req() req: FastifyRequest, @Param("id") id: string): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.sync.slotJemputOrder(uid(req), id) };
  }

  /** RTS / arrange shipment ke marketplace (menulis; outward). */
  @Post("orders/:id/ship")
  async shipOrder(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() body: { handoverMethod?: string; pickupSlot?: { startTime: number; endTime: number } },
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.sync.shipOrder(uid(req), id, { handoverMethod: body?.handoverMethod, pickupSlot: body?.pickupSlot }) };
  }

  @Get("shops/:id/runs")
  async runs(
    @Req() req: FastifyRequest,
    @Param("id") shopId: string,
    @Query("limit") limit?: string,
  ): Promise<ApiResponse<unknown>> {
    return {
      success: true,
      data: await this.sync.riwayat(uid(req), shopId, limit ? Number(limit) : 10),
    };
  }
}
