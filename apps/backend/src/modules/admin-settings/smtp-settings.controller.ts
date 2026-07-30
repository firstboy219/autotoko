import { Body, Controller, Delete, Get, Post, Put, Req, UseGuards } from "@nestjs/common";
import { IsEmail, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import type { FastifyRequest } from "fastify";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, AdminOnly, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { MailService } from "../../common/mail/mail.service.js";

export class SaveSmtpDto {
  @IsString() @MaxLength(255) host!: string;
  @IsInt() @Min(1) @Max(65535) port!: number;
  @IsString() @MaxLength(255) user!: string;
  @IsOptional() @IsString() @MaxLength(255) from?: string;
  /** Blank keeps the stored password — the UI never round-trips the secret. */
  @IsOptional() @IsString() @MaxLength(255) pass?: string;
}

export class TestSmtpDto {
  @IsOptional() @IsEmail() to?: string;
}

const ok = <T>(data: T): ApiResponse<T> => ({ success: true, data });

@Controller("admin/smtp")
@UseGuards(JwtAuthGuard)
@AdminOnly()
export class SmtpSettingsController {
  constructor(private readonly mail: MailService) {}

  @Get()
  async describe() {
    return ok(await this.mail.describe());
  }

  @Put()
  async save(@Req() req: FastifyRequest, @Body() dto: SaveSmtpDto) {
    const user = (req as FastifyRequest & { user?: JwtPayload }).user;
    await this.mail.saveConfig(dto, user?.sub);
    return ok(await this.mail.describe());
  }

  /** Verifies the credentials, and sends a probe message when `to` is given. */
  @Post("test")
  async test(@Body() dto: TestSmtpDto) {
    return ok(await this.mail.testConnection(dto.to));
  }

  @Delete()
  async clear() {
    await this.mail.clearConfig();
    return ok(await this.mail.describe());
  }
}
