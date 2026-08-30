import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { JwtAuthGuard, TenantOwnerOnly, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { StatementsService } from "./statements.service.js";

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

/**
 * Rentang tanggal yang benar-benar bisa dipakai, atau 400 yang menyebutkan
 * parameternya.
 *
 * Tanpa ini, from/to yang hilang menempuh seluruh jalur sampai ke drizzle dan
 * meledak sebagai "RangeError: Invalid time value" -- 500 yang tidak
 * memberitahu siapa pun bahwa yang kurang hanyalah dua parameter.
 */
function rentang(from?: string, to?: string): { from: string; to: string } {
  const sah = (v?: string) =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
      && !Number.isNaN(new Date(v + "T00:00:00Z").getTime());
  if (!sah(from) || !sah(to)) {
    throw new BadRequestException(
      'Rentang tanggal wajib diisi: "from" dan "to" dalam bentuk YYYY-MM-DD.',
    );
  }
  if (from! > to!) {
    throw new BadRequestException('"from" tidak boleh lewat dari "to".');
  }
  return { from: from!, to: to! };
}

function uid(req: FastifyRequest): string {
  return (req as FastifyRequest & { user?: JwtPayload }).user?.sub ?? "";
}

/**
 * Laporan marketplace dan rekonsiliasinya dengan catatan manual.
 *
 * Prefiksnya "statements" dan terdaftar di peta izin karyawan sebagai bagian
 * modul pencairan: yang boleh mengaudit uang adalah yang boleh melihat uang.
 */
@Controller("statements")
@UseGuards(JwtAuthGuard)
@TenantOwnerOnly()
export class StatementsController {
  constructor(private readonly statements: StatementsService) {}

  @Get()
  async list(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.statements.list(uid(req)) };
  }

  /**
   * Unggah satu berkas laporan penyelesaian.
   *
   * Dikirim sebagai base64 dan bukan multipart karena itulah cara seluruh
   * unggahan lain di sistem ini bekerja (foto resi, bukti transfer), dan satu
   * cara yang sama di mana-mana lebih mudah dipercaya daripada dua.
   */
  @Post("import")
  async import(
    @Req() req: FastifyRequest,
    @Body() body: { fileBase64?: string; fileName?: string; shopId?: string | null },
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.statements.import(uid(req), body ?? {}) };
  }

  @Delete(":id")
  async remove(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.statements.remove(uid(req), id) };
  }

  /**
   * Pesanan yang dipacking lawan pesanan yang dicairkan.
   *
   * Dipisah dari /reconcile karena menjawab pertanyaan yang berbeda: yang itu
   * soal uang yang masuk ke rekening, yang ini soal pesanan yang menggantung.
   */
  @Get("audit-orders")
  async auditOrders(
    @Req() req: FastifyRequest,
    @Query("from") from: string,
    @Query("to") to: string,
    @Query("shopId") shopId?: string,
  ): Promise<ApiResponse<unknown>> {
    return {
      success: true,
      data: await this.statements.auditOrders(uid(req), {
        ...rentang(from, to),
        shopId,
      }),
    };
  }

  /**
   * Saran persentase biaya marketplace, dari laporan yang sudah diimpor.
   *
   * Tanpa rentang tanggal: yang dicari kebiasaan potongan marketplace, bukan
   * keadaan satu periode, dan mempersempitnya justru mengurangi dasar
   * angkanya.
   */
  @Get("biaya-marketplace")
  async biayaMarketplace(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.statements.biayaMarketplace(uid(req)) };
  }

  /** Manual lawan marketplace, pada satu toko dan satu rentang. */
  @Get("reconcile")
  async reconcile(
    @Req() req: FastifyRequest,
    @Query("from") from: string,
    @Query("to") to: string,
    @Query("shopId") shopId?: string,
  ): Promise<ApiResponse<unknown>> {
    return {
      success: true,
      data: await this.statements.reconcile(uid(req), {
        ...rentang(from, to),
        shopId,
      }),
    };
  }
}
