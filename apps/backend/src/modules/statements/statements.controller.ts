import {
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
      data: await this.statements.reconcile(uid(req), { from, to, shopId }),
    };
  }
}
