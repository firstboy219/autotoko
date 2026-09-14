import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Param,
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
  @Post("enrich-names")
  async enrichNames(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.sync.perbaikiNamaVarian(uid(req)) };
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
