import { Controller, Get, UseGuards } from "@nestjs/common";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, AdminOnly } from "../auth/jwt-auth.guard.js";
import { TIKTOK_API_CATALOG, TIKTOK_API_STATS } from "./tiktok-api-catalog.js";

/** Katalog SEMUA endpoint TikTok Shop OpenAPI + tanda mana yang dipakai AutoToko. */
@Controller("admin/tiktok-apis")
@UseGuards(JwtAuthGuard)
@AdminOnly()
export class TiktokApisController {
  @Get()
  list(): ApiResponse<{ catalog: typeof TIKTOK_API_CATALOG; stats: typeof TIKTOK_API_STATS }> {
    return { success: true, data: { catalog: TIKTOK_API_CATALOG, stats: TIKTOK_API_STATS } };
  }
}
