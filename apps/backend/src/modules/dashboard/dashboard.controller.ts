import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { DashboardService } from "./dashboard.service.js";
import { DashboardV2Service } from "./dashboard-v2.service.js";
import { PendingTasksService } from "./pending-tasks.service.js";
import { ShopInsightsService } from "./shop-insights.service.js";
import { SaranService } from "../ai/saran.service.js";

function uid(req: FastifyRequest): string {
  return (req as FastifyRequest & { user: JwtPayload }).user.sub;
}

@Controller("dashboard")
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly pending: PendingTasksService,
    private readonly insights: ShopInsightsService,
    private readonly v2Service: DashboardV2Service,
    private readonly saran: SaranService,
  ) {}

  /**
   * Saran AI atas seluruh angka Dashboard v2, mengikuti filter yang dipilih.
   *
   * Rentang tanggalnya dihitung dengan rumus yang SAMA persis dengan rute
   * /v2 di bawah. Kalau keduanya berbeda satu hari saja, saran akan berbicara
   * tentang periode yang tidak sedang dilihat siapa pun.
   */
  @Get("v2/saran")
  async saranV2(
    @Req() req: FastifyRequest,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ): Promise<ApiResponse<unknown>> {
    const akhir = to ?? new Date().toISOString().slice(0, 10);
    const awal =
      from ??
      new Date(new Date(akhir + "T00:00:00Z").getTime() - 29 * 86400000)
        .toISOString()
        .slice(0, 10);
    const angka = await this.v2Service.overview(uid(req), awal, akhir);
    return {
      success: true,
      data: await this.saran.dariBrief({
        peran:
          "Kamu penasihat untuk pemilik toko yang sedang membaca dashboard-nya.",
        permintaan:
          `Ini seluruh angka toko untuk periode ${awal} sampai ${akhir}. ` +
          "Katakan apa yang paling perlu diperhatikan pemiliknya minggu ini: " +
          "yang bergerak ke arah salah, yang sedang bekerja dan layak diperbesar, " +
          "dan satu hal yang sedang tidak dilihat siapa pun. Kaitkan dengan " +
          "musim belanja dan tren pasar Indonesia kalau relevan.",
        data: { periode: { awal, akhir }, ...(angka as object) },
        tren: true,
      }),
    };
  }

  /**
   * What is not finished, and what it costs to leave alone.
   *
   * On the dashboard rather than buried in each page: nobody opens a page to
   * find out that nothing is wrong, which is how incomplete data sits until it
   * breaks a number somewhere else.
   */
  @Get("pending-tasks")
  async pendingTasks(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.pending.list(uid(req)) };
  }

  /** Per-shop health, earnings and what is actually selling. */
  @Get("shop-insights")
  async shopInsights(
    @Req() req: FastifyRequest,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("categoryId") categoryId?: string,
  ): Promise<ApiResponse<unknown>> {
    return {
      success: true,
      data: await this.insights.overview(uid(req), {
        from,
        to,
        // "all" is the absence of a filter, sent explicitly so the client does
        // not have to decide between omitting the parameter and sending blank.
        categoryId: categoryId && categoryId !== "all" ? categoryId : null,
      }),
    };
  }

  /**
   * One shop's parcels, newest first.
   *
   * Same range parameters as the insights page it is opened from, so the
   * detail and the row that led to it cannot disagree about the period.
   */
  @Get("shop-insights/:shopId")
  async shopDetail(
    @Req() req: FastifyRequest,
    @Param("shopId") shopId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ): Promise<ApiResponse<unknown>> {
    return {
      success: true,
      data: await this.insights.shopDetail(uid(req), shopId, { from, to }),
    };
  }

  /**
   * Angka untuk Dashboard v2.
   *
   * Rute terpisah, bukan mengubah /summary: dashboard lama masih dipakai dan
   * tidak boleh berubah artinya hanya karena ada yang baru.
   */
  @Get("v2")
  async v2(
    @Req() req: FastifyRequest,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ): Promise<ApiResponse<unknown>> {
    const akhir = to ?? new Date().toISOString().slice(0, 10);
    const awal =
      from ??
      new Date(new Date(akhir + "T00:00:00Z").getTime() - 29 * 86400000)
        .toISOString()
        .slice(0, 10);
    return { success: true, data: await this.v2Service.overview(uid(req), awal, akhir) };
  }

  @Get("summary")
  async summary(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.dashboard.summary(uid(req)) };
  }

  @Get("alerts")
  async alerts(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.dashboard.alerts(uid(req)) };
  }
}
