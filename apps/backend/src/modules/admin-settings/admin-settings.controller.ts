import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ApiResponse } from "@autotoko/shared";
import {
  JwtAuthGuard,
  AdminOnly,
  type JwtPayload,
} from "../auth/jwt-auth.guard.js";
import { AdminSettingsService, type SettingMeta } from "./admin-settings.service.js";
import { SetSettingDto } from "./dto/admin-settings.dto.js";

@Controller("admin/settings")
@UseGuards(JwtAuthGuard)
@AdminOnly()
export class AdminSettingsController {
  constructor(private readonly settings: AdminSettingsService) {}

  @Get()
  async list(): Promise<ApiResponse<SettingMeta[]>> {
    return { success: true, data: await this.settings.list() };
  }

  @Put(":key")
  async set(
    @Param("key") key: string,
    @Body() dto: SetSettingDto,
    @Req() req: FastifyRequest,
  ): Promise<ApiResponse<{ key: string }>> {
    const user = (req as FastifyRequest & { user?: JwtPayload }).user;
    await this.settings.set(key, dto.value, dto.description, user?.sub);
    return { success: true, data: { key } };
  }
}
