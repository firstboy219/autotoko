import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { JwtAuthGuard, TenantOwnerOnly, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { StaffService } from "./staff.service.js";

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

function uid(req: FastifyRequest): string {
  return (req as FastifyRequest & { user?: JwtPayload }).user?.sub ?? "";
}

/**
 * Akun karyawan, dikelola pemiliknya sendiri.
 *
 * Seluruh controller ini hanya untuk pemilik. Penjagaannya ada dua lapis dan
 * itu disengaja: prefix "staff" terdaftar OWNER_ONLY di peta izin guard, dan
 * TenantOwnerOnly menolak token portal sub-seller. Karyawan yang bisa membuat
 * karyawan lain -- atau menaikkan izinnya sendiri -- membuat seluruh lapisan
 * izin ini tidak ada artinya.
 */
@Controller("staff")
@UseGuards(JwtAuthGuard)
@TenantOwnerOnly()
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  /** Daftar izin yang bisa diberikan, beserta keterangannya. */
  @Get("permissions")
  permissions(): ApiResponse<unknown> {
    return { success: true, data: this.staff.permissionCatalogue() };
  }

  @Get()
  async list(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.staff.list(uid(req)) };
  }

  @Post()
  async create(
    @Req() req: FastifyRequest,
    @Body() body: { name?: string; email?: string; password?: string; permissions?: unknown },
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.staff.create(uid(req), body ?? {}) };
  }

  @Patch(":id")
  async update(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body()
    body: {
      name?: string;
      email?: string;
      password?: string;
      permissions?: unknown;
      isActive?: boolean;
    },
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.staff.update(uid(req), id, body ?? {}) };
  }

  @Delete(":id")
  async remove(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.staff.remove(uid(req), id) };
  }
}
