import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, AdminOnly } from "../auth/jwt-auth.guard.js";
import { AdminSettingsService } from "./admin-settings.service.js";
import {
  parseStatusConfig,
  DEFAULT_STATUS_CONFIG,
  MP_STATUSES,
  MP_STATUS_LABEL,
  type StatusRow,
} from "../marketplace-sync/status-config.js";

const KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * Konfigurasi status order (Admin CMS), format Internal -> TikTok: daftar tahap
 * internal (terurut) yang bisa di-rename, diatur padanan marketplace-nya,
 * diurutkan, dan ditambah. Dibaca marketplace-sync (mapping) & /orders/status-meta
 * (label/flow) sebagai sumber tunggal.
 */
@Controller("admin/order-config")
@UseGuards(JwtAuthGuard)
@AdminOnly()
export class OrderConfigController {
  constructor(private readonly settings: AdminSettingsService) {}

  @Get()
  async get(): Promise<ApiResponse<unknown>> {
    const config = parseStatusConfig(await this.settings.get("order_status_config"));
    const rules = (await this.settings.get("operational_rules")) ?? "";
    return {
      success: true,
      data: {
        config,
        defaults: DEFAULT_STATUS_CONFIG,
        marketplaceOptions: MP_STATUSES,
        mpLabel: MP_STATUS_LABEL,
        rules,
      },
    };
  }

  @Put()
  async put(
    @Body() body: { config?: StatusRow[]; rules?: string },
  ): Promise<ApiResponse<unknown>> {
    if (Array.isArray(body.config)) {
      const seen = new Set<string>();
      const clean: StatusRow[] = [];
      for (const r of body.config) {
        const key = String(r?.key ?? "").trim().toLowerCase();
        if (!KEY_RE.test(key) || seen.has(key)) continue;
        seen.add(key);
        clean.push({
          key,
          label: String(r?.label ?? key).slice(0, 64) || key,
          marketplace: MP_STATUSES.includes(String(r?.marketplace)) ? String(r.marketplace) : "",
          kind: r?.kind === "side" ? "side" : "flow",
        });
      }
      if (clean.length) {
        await this.settings.set("order_status_config", JSON.stringify(clean), "Konfigurasi status order (Internal->TikTok)");
      }
    }
    if (body.rules !== undefined) {
      await this.settings.set("operational_rules", String(body.rules).slice(0, 20000), "Aturan operasional & knowledge (Order)");
    }
    return { success: true, data: { ok: true } };
  }
}
