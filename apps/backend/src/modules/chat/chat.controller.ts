import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import type { FastifyRequest } from "fastify";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { ChatService } from "./chat.service.js";
import { ChatAutomationService } from "./chat-automation.service.js";

function uid(req: FastifyRequest): string {
  return (req as FastifyRequest & { user: JwtPayload }).user.sub;
}

class ReplyDto {
  @IsString() @MinLength(1) @MaxLength(4000)
  text!: string;
}

class UjiDto {
  @IsString() @MinLength(1) @MaxLength(2000) text!: string;
  @IsOptional() @IsString() orderId?: string;
}

class ChatSettingsDto {
  @IsOptional() @IsBoolean() autoReply?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) autoReplyShopIds?: string[] | null;
  @IsOptional() @IsInt() @Min(0) @Max(23) officeStart?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(23) officeEnd?: number | null;
  @IsOptional() @IsString() @MaxLength(1000) fallbackText?: string | null;
}

@Controller("chat")
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService, private readonly auto: ChatAutomationService) {}

  /** Pengaturan otomasi chat (balas otomatis, toko, jam kerja, pesan luar jam). */
  @Get("settings")
  async settings(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.auto.getSettings(uid(req)) };
  }

  @Put("settings")
  async saveSettings(@Req() req: FastifyRequest, @Body() dto: ChatSettingsDto): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.auto.setSettings(uid(req), dto) };
  }

  /** Izin Customer Service per toko + ringkasan antrean/balasan otomatis. */
  @Get("status")
  async status(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: { izin: await this.auto.status(uid(req)), ...(await this.auto.ringkasan(uid(req))) } };
  }

  /** Pratinjau balasan otomatis untuk contoh pesan pembeli (tidak mengirim apa pun). */
  @Post("uji-balasan")
  async uji(@Req() req: FastifyRequest, @Body() dto: UjiDto): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.auto.ujiBalasan(uid(req), dto.text, dto.orderId) };
  }

  /** Jalankan satu putaran sekarang: sinkron + balas otomatis + kirim antrean. */
  @Post("run")
  async run(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.auto.jalankanManual(uid(req)) };
  }

  @Get("conversations")
  async conversations(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.chat.listConversations(uid(req)) };
  }

  @Get("conversations/:id/messages")
  async messages(@Req() req: FastifyRequest, @Param("id") id: string): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.chat.listMessages(uid(req), id) };
  }

  @Post("conversations/:id/reply")
  async reply(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() dto: ReplyDto,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.chat.reply(uid(req), id, dto.text) };
  }

  /** Mulai chat dgn pembeli dari sebuah order. */
  @Post("from-order/:orderId")
  async fromOrder(@Req() req: FastifyRequest, @Param("orderId") orderId: string): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.chat.startFromOrder(uid(req), orderId) };
  }
}
