import { Controller, Get, Inject, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { TenantService } from "../../database/tenant.service.js";
import { staffAccounts, users } from "../../database/schema/index.js";
import { JwtAuthGuard, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { STAFF_PERMISSION_KEYS } from "./permissions.js";

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

/**
 * "Saya ini siapa, dan boleh apa saja."
 *
 * Dibutuhkan karena token karyawan memakai sub milik PEMILIK -- tanpa endpoint
 * ini, layar tidak punya cara mengetahui bahwa yang sedang masuk adalah
 * karyawan, dan akan menampilkan seluruh menu lalu membiarkan tiap ketukan
 * berakhir dengan 403. Menyembunyikan yang tidak boleh dibuka bukan sekadar
 * kerapian: menu yang selalu menolak terbaca sebagai aplikasi yang rusak.
 *
 * Izinnya dibaca dari baris karyawan, bukan dari token, supaya jawabannya
 * selalu yang terbaru -- sama seperti yang dipakai guard untuk memutuskan.
 */
@Controller("me")
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly tenant: TenantService,
  ) {}

  @Get()
  async me(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    const payload = (req as FastifyRequest & { user?: JwtPayload }).user;
    const ownerId = payload?.sub ?? "";

    const pemilik = await this.tenant.runBypass(async () => {
      const [u] = await this.db
        .select({ id: users.id, email: users.email, fullName: users.fullName })
        .from(users)
        .where(eq(users.id, ownerId))
        .limit(1);
      return u ?? null;
    });

    if (!payload?.staffId) {
      return {
        success: true,
        data: {
          kind: "owner",
          name: pemilik?.fullName ?? null,
          email: pemilik?.email ?? null,
          ownerName: pemilik?.fullName ?? null,
          // Pemilik boleh semuanya. Dikirim penuh, bukan null, supaya layar
          // cukup punya satu cara memeriksa: "apakah kunci ini ada di daftar".
          permissions: [...STAFF_PERMISSION_KEYS],
          isOwner: true,
        },
      };
    }

    const staf = await this.tenant.runBypass(async () => {
      const [s] = await this.db
        .select({
          name: staffAccounts.name,
          email: staffAccounts.email,
          permissions: staffAccounts.permissions,
        })
        .from(staffAccounts)
        .where(eq(staffAccounts.id, payload.staffId!))
        .limit(1);
      return s ?? null;
    });

    return {
      success: true,
      data: {
        kind: "staff",
        name: staf?.name ?? null,
        email: staf?.email ?? null,
        ownerName: pemilik?.fullName ?? null,
        permissions: Array.isArray(staf?.permissions) ? staf!.permissions : [],
        isOwner: false,
      },
    };
  }
}
