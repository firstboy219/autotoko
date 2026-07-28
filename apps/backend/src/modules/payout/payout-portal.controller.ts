import { BadRequestException, Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ApiResponse, Marketplace } from "@autotoko/shared";
import { JwtAuthGuard, PortalOnly, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { ShopsService } from "../shops/shops.service.js";
import { PayoutPortalAuthService } from "./portal-auth.service.js";
import { PortalDataService } from "./portal-data.service.js";
import { PortalEmailStartDto, PortalEmailVerifyDto } from "./portal.dto.js";

const SUPPORTED: Marketplace[] = ["tiktok", "shopee"];
function assertMarketplace(mp: string): Marketplace {
  if (!SUPPORTED.includes(mp as Marketplace)) {
    throw new BadRequestException(`Unsupported marketplace: ${mp}`);
  }
  return mp as Marketplace;
}

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
    private readonly shopsService: ShopsService,
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

  /**
   * "Tambah Toko" (MAPPING_DAN_SELFSERVICE_TOKO.md 2.1) — reuses the EXACT
   * same OAuth mechanism as the Seller's own connect flow (getConnectUrl),
   * just with this principal's identity embedded in the signed state so the
   * callback can auto-assign ownership without trusting any client input.
   */
  @Get("shops/connect/:marketplace")
  @UseGuards(JwtAuthGuard)
  @PortalOnly()
  async connectShop(@Req() req: FastifyRequest, @Param("marketplace") marketplace: string) {
    const p = principal(req);
    const mp = assertMarketplace(marketplace);
    return ok(await this.shopsService.getConnectUrl(p.userId, mp, { principal: { type: p.type, id: p.id } }));
  }
}
