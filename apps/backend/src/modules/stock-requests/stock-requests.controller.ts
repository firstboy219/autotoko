import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { StockRequestsService } from "./stock-requests.service.js";
import { SimpanRequestDto } from "./dto.js";

function uid(req: FastifyRequest): string {
  return (req as FastifyRequest & { user: JwtPayload }).user.sub;
}
const ok = <T>(data: T): ApiResponse<T> => ({ success: true, data });

/**
 * Permintaan pembelian stok. Menggantikan rekap stok.
 *
 * Rekap menjawab "apa yang ada di rak"; yang dibutuhkan langkah sesudahnya --
 * "apa yang harus dibeli, berapa banyak, berapa harganya" -- dan itu berakhir
 * di WhatsApp pemasok, bukan di layar.
 */
@Controller("stock-requests")
@UseGuards(JwtAuthGuard)
export class StockRequestsController {
  constructor(private readonly svc: StockRequestsService) {}

  @Get()
  async list(@Req() req: FastifyRequest) {
    return ok(await this.svc.list(uid(req)));
  }

  @Get(":id")
  async get(@Req() req: FastifyRequest, @Param("id") id: string) {
    return ok(await this.svc.get(uid(req), id));
  }

  @Post()
  async create(@Req() req: FastifyRequest, @Body() dto: SimpanRequestDto) {
    return ok(await this.svc.simpan(uid(req), dto));
  }

  @Patch(":id")
  async update(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() dto: SimpanRequestDto,
  ) {
    return ok(await this.svc.simpan(uid(req), dto, id));
  }

  @Delete(":id")
  async remove(@Req() req: FastifyRequest, @Param("id") id: string) {
    return ok(await this.svc.hapus(uid(req), id));
  }

  /**
   * Teks pesan WhatsApp permintaan ini.
   *
   * `tandai=1` menandainya sudah dikirim. Dipisah dari pengambilan teksnya
   * supaya layar bisa memperlihatkan pratinjau tanpa mengunci permintaannya --
   * melihat bukan mengirim.
   */
  @Get(":id/wa")
  async wa(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Query("tandai") tandai?: string,
  ) {
    return ok(await this.svc.wa(uid(req), id, tandai === "1"));
  }
}
