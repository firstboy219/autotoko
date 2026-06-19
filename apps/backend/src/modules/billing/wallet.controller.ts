import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { WalletService } from "./wallet.service.js";
import { TopUpDto } from "./dto/wallet.dto.js";

function uid(req: FastifyRequest): string {
  return (req as FastifyRequest & { user: JwtPayload }).user.sub;
}

@Controller("wallet")
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async get(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.wallet.getWallet(uid(req)) };
  }

  @Post("topup")
  @UseGuards(JwtAuthGuard)
  async topup(
    @Req() req: FastifyRequest,
    @Body() dto: TopUpDto,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.wallet.topUp(uid(req), dto.amount) };
  }

  // Midtrans server-to-server notification (no JWT; signature-verified).
  @Post("midtrans/notification")
  async notification(@Body() payload: any): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.wallet.handleNotification(payload) };
  }
}
