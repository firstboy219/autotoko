import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ApiResponse } from "@autotoko/shared";
import { AuthService } from "./auth.service.js";
import { LoginDto, WaVerifyDto } from "./dto/auth.dto.js";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  // Admin login (ADMIN_USERNAME/ADMIN_PASSWORD). Dev creds only outside prod.
  @Post("login")
  async login(@Body() dto: LoginDto): Promise<ApiResponse<{ accessToken: string }>> {
    return { success: true, data: await this.auth.login(dto.username, dto.password) };
  }

  @Post("wa-login/start")
  async waStart(): Promise<ApiResponse<Awaited<ReturnType<AuthService["waStart"]>>>> {
    return { success: true, data: await this.auth.waStart() };
  }

  // Called by the shared n8n workflow. Protected by a webhook secret header.
  @Post("wa-login/verify")
  async waVerify(
    @Body() dto: WaVerifyDto,
    @Headers("x-webhook-secret") secret?: string,
  ): Promise<ApiResponse<{ ok: true }>> {
    const expected = this.config.get<string>("WA_WEBHOOK_SECRET");
    if (!expected || secret !== expected) {
      throw new UnauthorizedException("Invalid webhook secret");
    }
    return { success: true, data: await this.auth.waVerify(dto.code, dto.wa_number) };
  }

  @Get("wa-login/status")
  async waStatus(
    @Query("token") token: string,
  ): Promise<ApiResponse<Awaited<ReturnType<AuthService["waStatus"]>>>> {
    return { success: true, data: await this.auth.waStatus(token) };
  }
}
