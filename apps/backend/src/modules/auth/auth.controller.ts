import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import type { FastifyRequest } from "fastify";
import type { ApiResponse } from "@autotoko/shared";
import { AuthService } from "./auth.service.js";
import { EmailOtpService } from "./email-otp.service.js";
import { PasswordAuthService } from "./password.service.js";
import { JwtAuthGuard, type JwtPayload } from "./jwt-auth.guard.js";
import {
  LoginDto,
  WaVerifyDto,
  EmailStartDto,
  EmailVerifyDto,
  PasswordLoginDto,
  SetPasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from "./dto/auth.dto.js";

// Tighter limit on auth: max 30 requests/min per IP (brute-force protection
// without blocking legit retries/OTP).
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly emailOtp: EmailOtpService,
    private readonly passwordAuth: PasswordAuthService,
    private readonly config: ConfigService,
  ) {}

  // Admin login (ADMIN_USERNAME/ADMIN_PASSWORD). Dev creds only outside prod.
  @Post("login")
  async login(@Body() dto: LoginDto): Promise<ApiResponse<{ accessToken: string }>> {
    return { success: true, data: await this.auth.login(dto.username, dto.password) };
  }

  // Passwordless demo login for the TikTok App Review (DEMO_LOGIN_ENABLED=true).
  @Post("demo-login")
  async demoLogin(): Promise<ApiResponse<{ accessToken: string }>> {
    return { success: true, data: await this.auth.demoLogin() };
  }

  @Post("email/start")
  async emailStart(@Body() dto: EmailStartDto): Promise<ApiResponse<{ ok: true }>> {
    return { success: true, data: await this.emailOtp.start(dto.email) };
  }

  @Post("email/verify")
  async emailVerify(
    @Body() dto: EmailVerifyDto,
  ): Promise<ApiResponse<{ accessToken: string }>> {
    return { success: true, data: await this.emailOtp.verify(dto.email, dto.code) };
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

  // --- Email + password (offered alongside the passwordless OTP flows) ---

  @Post("password/login")
  async passwordLogin(
    @Body() dto: PasswordLoginDto,
  ): Promise<ApiResponse<{ accessToken: string }>> {
    return { success: true, data: await this.passwordAuth.login(dto.email, dto.password) };
  }

  /** Sets/changes the caller's own password — session required. */
  @Post("password/set")
  @UseGuards(JwtAuthGuard)
  async setPassword(
    @Req() req: FastifyRequest,
    @Body() dto: SetPasswordDto,
  ): Promise<ApiResponse<{ ok: true }>> {
    const user = (req as FastifyRequest & { user: JwtPayload }).user;
    return {
      success: true,
      data: await this.passwordAuth.setPassword(user.sub, dto.newPassword, dto.currentPassword),
    };
  }

  @Get("password/status")
  @UseGuards(JwtAuthGuard)
  async passwordStatus(
    @Req() req: FastifyRequest,
  ): Promise<ApiResponse<{ hasPassword: boolean }>> {
    const user = (req as FastifyRequest & { user: JwtPayload }).user;
    return { success: true, data: await this.passwordAuth.status(user.sub) };
  }

  /** Always 200, even for unknown addresses — see requestReset(). */
  @Post("password/forgot")
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<ApiResponse<{ ok: true }>> {
    return { success: true, data: await this.passwordAuth.requestReset(dto.email) };
  }

  @Get("password/reset/check")
  async checkReset(
    @Query("token") token: string,
  ): Promise<ApiResponse<{ valid: boolean; reason?: string }>> {
    return { success: true, data: await this.passwordAuth.checkResetToken(token ?? "") };
  }

  @Post("password/reset")
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<ApiResponse<{ ok: true }>> {
    return {
      success: true,
      data: await this.passwordAuth.resetWithToken(dto.token, dto.newPassword),
    };
  }
}
