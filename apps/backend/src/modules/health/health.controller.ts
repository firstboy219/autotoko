import { Controller, Get } from "@nestjs/common";
import type { ApiResponse } from "@autotoko/shared";

@Controller("health")
export class HealthController {
  @Get()
  check(): ApiResponse<{ status: string; uptime: number; ts: string }> {
    return {
      success: true,
      data: {
        status: "ok",
        uptime: process.uptime(),
        ts: new Date().toISOString(),
      },
    };
  }
}
