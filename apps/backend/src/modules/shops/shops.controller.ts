import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  BadRequestException,
} from "@nestjs/common";
import { IsOptional, IsString, IsUUID } from "class-validator";
import { ConfigService } from "@nestjs/config";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ApiResponse, Marketplace } from "@autotoko/shared";
import { JwtAuthGuard, AdminOnly, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { ShopsService } from "./shops.service.js";

const SUPPORTED: Marketplace[] = ["tiktok", "shopee"];

function assertMarketplace(mp: string): Marketplace {
  if (!SUPPORTED.includes(mp as Marketplace)) {
    throw new BadRequestException(`Unsupported marketplace: ${mp}`);
  }
  return mp as Marketplace;
}

function uid(req: FastifyRequest): string {
  return (req as FastifyRequest & { user: JwtPayload }).user.sub;
}

class ManualConnectDto {
  @IsString()
  authCode!: string;

  @IsOptional()
  @IsString()
  shopId?: string;

  // Connect to a specific user; defaults to the authenticated admin's own id.
  @IsOptional()
  @IsUUID()
  userId?: string;
}

@Controller("shops")
export class ShopsController {
  private readonly logger = new Logger(ShopsController.name);

  constructor(
    private readonly shops: ShopsService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async list(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.shops.listShops(uid(req)) };
  }

  @Post(":id/refresh")
  @UseGuards(JwtAuthGuard)
  async refresh(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.shops.refreshOne(uid(req), id) };
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard)
  async disconnect(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.shops.disconnect(uid(req), id) };
  }

  // Requires a valid JWT (401 otherwise) — the connecting user's id is taken
  // from the token, never a fallback. Admins may pass ?userId=<uuid> to generate
  // a connect URL on behalf of a specific user (state.sub bound to that user).
  @Get("connect/:marketplace")
  @UseGuards(JwtAuthGuard)
  async connect(
    @Param("marketplace") marketplace: string,
    @Query("userId") userIdOverride: string | undefined,
    @Req() req: FastifyRequest,
  ): Promise<ApiResponse<{ authUrl: string }>> {
    const mp = assertMarketplace(marketplace);
    const caller = (req as FastifyRequest & { user: JwtPayload }).user;
    let targetUser = caller.sub;
    if (userIdOverride) {
      if (caller.role !== "admin") {
        throw new ForbiddenException("Only admins may connect on behalf of another user");
      }
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userIdOverride)) {
        throw new BadRequestException("Invalid userId");
      }
      targetUser = userIdOverride;
    }
    return { success: true, data: await this.shops.getConnectUrl(targetUser, mp) };
  }

  /**
   * Admin-only manual token exchange. Use when an authorization was started
   * outside our normal flow (e.g. a sandbox shop authorised from Partner Center),
   * so no AutoToko `state` JWT exists. Paste the auth_code from the callback URL.
   * auth_code is single-use and expires ~30 min.
   */
  @Post("connect/:marketplace/manual")
  @UseGuards(JwtAuthGuard)
  @AdminOnly()
  async connectManual(
    @Param("marketplace") marketplace: string,
    @Body() dto: ManualConnectDto,
    @Req() req: FastifyRequest,
  ): Promise<ApiResponse<{ shopId: string; shopName?: string }>> {
    const mp = assertMarketplace(marketplace);
    const targetUser = dto.userId ?? uid(req);
    const r = await this.shops.connectManual(targetUser, mp, dto.authCode, dto.shopId);
    return { success: true, data: r };
  }

  // OAuth redirect target — no bearer token (comes from the marketplace).
  // Identity is carried in the signed `state` for the normal flow.
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
    this.logger.log(
      `OAuth callback ${mp}: code=${code ? code.slice(0, 10) + "…" : "<none>"} ` +
        `state=${state ? state.slice(0, 24) + "…" : "<none>"} shop_id=${shopId ?? "-"}`,
    );

    try {
      const r = await this.shops.handleCallback(mp, { state, code, shopId });
      void reply
        .code(302)
        .redirect(`${appUrl}/toko?connected=${mp}&shop=${encodeURIComponent(r.shopId)}`);
    } catch (e) {
      const msg = (e as Error).message;
      this.logger.warn(`OAuth callback ${mp} could not auto-link: ${msg}`);
      // Do NOT redirect to a protected SPA route — that bounces to /login and
      // looks like "Koneksi Gagal". Render an informative page instead. The
      // auth_code is shown so an admin can finish via the manual endpoint
      // (relevant for sandbox authorisations that carry no AutoToko state).
      void reply
        .code(200)
        .header("content-type", "text/html; charset=utf-8")
        .send(this.renderCallbackError(mp, msg, code, appUrl));
    }
  }

  private renderCallbackError(
    mp: Marketplace,
    message: string,
    code: string | undefined,
    appUrl: string,
  ): string {
    const safe = (s: string) =>
      s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    const codeBlock = code
      ? `<p>Auth code (single-use, ~30 min):</p><code style="display:block;word-break:break-all;background:#f1f5f9;padding:8px;border-radius:6px">${safe(code)}</code>
         <p style="font-size:13px;color:#64748b">Admin dapat menyelesaikan koneksi via <b>POST /api/shops/connect/${mp}/manual</b> dengan body <code>{"authCode":"…"}</code>.</p>`
      : "";
    return `<!doctype html><html lang="id"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>AutoToko — Koneksi ${safe(mp)}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:520px;margin:48px auto;padding:0 16px;color:#0f172a">
<h2>Koneksi ${safe(mp)} belum selesai</h2>
<p style="color:#b45309">${safe(message)}</p>
${codeBlock}
<p><a href="${appUrl}/toko" style="color:#2563eb">← Kembali ke AutoToko</a></p>
</body></html>`;
  }
}
