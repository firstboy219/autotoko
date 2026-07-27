import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, PortalOnly, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { PayoutPortalAuthService } from "./portal-auth.service.js";
import { PortalDataService } from "./portal-data.service.js";
import { PortalEmailStartDto, PortalEmailVerifyDto } from "./portal.dto.js";

function principal(req: FastifyRequest) {
  const p = (req as FastifyRequest & { user: JwtPayload }).user;
  return { userId: p.sub, type: p.principalType!, id: p.principalId! };
}

const ok = <T>(data: T): ApiResponse<T> => ({ success: true, data });

/**
 * Sub-seller/Sub-sub-seller portal (MAPPING_DAN_SELFSERVICE_TOKO.md,
 * FLOW_PENCAIRAN_V2_FINAL.md Bagian 5). Auth endpoints are public (they ARE
 * the login flow); everything else requires a portal token (@PortalOnly) and
 * is scoped to that principal alone — never the tenant's full data.
 */
@Controller("payout/portal")
export class PayoutPortalController {
  constructor(
    private readonly auth: PayoutPortalAuthService,
    private readonly data: PortalDataService,
  ) {}

  @Post("auth/start")
  async authStart(@Body() dto: PortalEmailStartDto) {
    return ok(await this.auth.start(dto.email));
  }

  @Post("auth/verify")
  async authVerify(@Body() dto: PortalEmailVerifyDto) {
    return ok(await this.auth.verify(dto.email, dto.code));
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @PortalOnly()
  async me(@Req() req: FastifyRequest) {
    const p = principal(req);
    return ok(await this.data.getMe(p.userId, p.type, p.id));
  }

  @Get("shops")
  @UseGuards(JwtAuthGuard)
  @PortalOnly()
  async shops(@Req() req: FastifyRequest) {
    const p = principal(req);
    return ok(await this.data.listMyShops(p.userId, p.type, p.id));
  }

  @Get("history")
  @UseGuards(JwtAuthGuard)
  @PortalOnly()
  async history(@Req() req: FastifyRequest) {
    const p = principal(req);
    return ok(await this.data.listMyHistory(p.userId, p.type, p.id));
  }
}
