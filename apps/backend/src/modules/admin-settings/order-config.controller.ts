import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, AdminOnly } from "../auth/jwt-auth.guard.js";
import { AdminSettingsService } from "./admin-settings.service.js";
import { DEFAULT_STATUS_MAP } from "../marketplace-sync/peta-tiktok.js";

const INTERNAL = [
  "masuk", "approved", "produksi", "packing", "siap_kirim", "dikirim", "selesai", "retur", "dibatalkan",
] as const;

/**
 * Konfigurasi Order yang non-rahasia & bisa dilihat/diedit di Admin CMS:
 * pemetaan status marketplace -> internal (order_status_mapping) + catatan
 * aturan operasional (operational_rules). Dibaca marketplace-sync sbg override
 * atas DEFAULT_STATUS_MAP.
 */
@Controller("admin/order-config")
@UseGuards(JwtAuthGuard)
@AdminOnly()
export class OrderConfigController {
  constructor(private readonly settings: AdminSettingsService) {}

  @Get()
  async get(): Promise<ApiResponse<unknown>> {
    let override: Record<string, string> = {};
    try {
      const raw = await this.settings.get("order_status_mapping");
      if (raw) { const p = JSON.parse(raw); if (p && typeof p === "object") override = p; }
    } catch { override = {}; }
    const rules = (await this.settings.get("operational_rules")) ?? "";
    return {
      success: true,
      data: {
        defaults: DEFAULT_STATUS_MAP,
        override,
        effective: { ...DEFAULT_STATUS_MAP, ...override },
        rules,
        internalStatuses: INTERNAL,
      },
    };
  }

  @Put()
  async put(
    @Body() body: { mapping?: Record<string, string>; rules?: string },
  ): Promise<ApiResponse<unknown>> {
    if (body.mapping !== undefined) {
      // Simpan hanya entri VALID & yang BEDA dari default (override minimal),
      // supaya perubahan default kode di masa depan tetap mengalir.
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(body.mapping)) {
        const key = String(k).toUpperCase();
        if ((INTERNAL as readonly string[]).includes(v) && (DEFAULT_STATUS_MAP as Record<string, string>)[key] !== v) {
          clean[key] = v;
        }
      }
      await this.settings.set("order_status_mapping", JSON.stringify(clean), "Pemetaan status marketplace->internal (Order)");
    }
    if (body.rules !== undefined) {
      await this.settings.set("operational_rules", String(body.rules).slice(0, 20000), "Aturan operasional & knowledge (Order)");
    }
    return { success: true, data: { ok: true } };
  }
}
