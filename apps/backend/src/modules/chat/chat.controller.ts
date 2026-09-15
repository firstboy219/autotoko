import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { IsString, MaxLength, MinLength } from "class-validator";
import type { FastifyRequest } from "fastify";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { ChatService } from "./chat.service.js";

function uid(req: FastifyRequest): string {
  return (req as FastifyRequest & { user: JwtPayload }).user.sub;
}

class ReplyDto {
  @IsString() @MinLength(1) @MaxLength(4000)
  text!: string;
}

@Controller("chat")
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

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
}
