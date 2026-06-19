import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  BadRequestException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ApiResponse, Marketplace } from "@autotoko/shared";
import { JwtAuthGuard, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { ShopsService } from "./shops.service.js";

const SUPPORTED: Marketplace[] = ["tiktok", "shopee"];

function assertMarketplace(mp: string): Marketplace {
  if (!SUPPORTED.includes(mp as Marketplace)) {
    throw new BadRequestException(`Unsupported marketplace: ${mp}`);
  }
  return mp as Marketplace;
}

@Controller("shops")
export class ShopsController {
  constructor(
    private readonly shops: ShopsService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async list(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    const user = (req as FastifyRequest & { user: JwtPayload }).user;
    return { success: true, data: await this.shops.listShops(user.sub) };
  }

  @Get("connect/:marketplace")
  @UseGuards(JwtAuthGuard)
  async connect(
    @Param("marketplace") marketplace: string,
    @Req() req: FastifyRequest,
  ): Promise<ApiResponse<{ authUrl: string }>> {
    const user = (req as FastifyRequest & { user: JwtPayload }).user;
    const mp = assertMarketplace(marketplace);
    return { success: true, data: await this.shops.getConnectUrl(user.sub, mp) };
  }

  // OAuth redirect target — no bearer token (comes from the marketplace).
  // Identity is carried in the signed `state`.
  @Get("callback/:marketplace")
  async callback(
    @Param("marketplace") marketplace: string,
    @Query("state") state: string,
    @Query("code") code: string,
    @Query("shop_id") shopId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const mp = assertMarketplace(marketplace);
    const appUrl = this.config.get<string>("APP_URL", "http://localhost:5173");
    try {
      const r = await this.shops.handleCallback(mp, { state, code, shopId });
      void reply
        .code(302)
        .redirect(`${appUrl}/toko?connected=${mp}&shop=${encodeURIComponent(r.shopId)}`);
    } catch (e) {
      void reply
        .code(302)
        .redirect(`${appUrl}/toko?error=${encodeURIComponent((e as Error).message)}`);
    }
  }
}
