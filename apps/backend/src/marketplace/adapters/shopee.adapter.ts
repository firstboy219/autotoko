import { Injectable, BadGatewayException, Logger } from "@nestjs/common";
import type { ConnectResult, MarketplaceAuthPort } from "@autotoko/shared";
import { AdminSettingsService } from "../../modules/admin-settings/admin-settings.service.js";
import { signShopee, unixNow } from "../signing/shopee.signer.js";

// Indonesia → Global (SG) host (PRD Bagian 10.1).
const SHOPEE_BASE = "https://partner.shopeemobile.com";

interface ShopeeCreds {
  partnerId: string;
  partnerKey: string;
  redirectUrl: string;
}

@Injectable()
export class ShopeeAdapter implements MarketplaceAuthPort {
  readonly marketplace = "shopee" as const;
  private readonly logger = new Logger(ShopeeAdapter.name);

  constructor(private readonly settings: AdminSettingsService) {}

  private async creds(): Promise<ShopeeCreds> {
    const partnerId = await this.settings.get("shopee_partner_id");
    const partnerKey = await this.settings.get("shopee_partner_key");
    const redirectUrl = await this.settings.get("shopee_redirect_url");
    if (!partnerId || !partnerKey || !redirectUrl) {
      throw new BadGatewayException("Shopee credentials not configured in Admin CMS");
    }
    return { partnerId, partnerKey, redirectUrl };
  }

  async getAuthUrl(state: string): Promise<string> {
    const { partnerId, partnerKey, redirectUrl } = await this.creds();
    const path = "/api/v2/shop/auth_partner";
    const timestamp = unixNow();
    const sign = signShopee({ partnerId, partnerKey, path, timestamp });
    // state rides along on our redirect; Shopee appends &code=&shop_id=
    const redirect = `${redirectUrl}${redirectUrl.includes("?") ? "&" : "?"}state=${encodeURIComponent(state)}`;
    const qs = new URLSearchParams({
      partner_id: partnerId,
      timestamp: String(timestamp),
      sign,
      redirect,
    }).toString();
    return `${SHOPEE_BASE}${path}?${qs}`;
  }

  async exchangeToken(code: string, shopId?: string): Promise<ConnectResult> {
    if (!shopId) throw new BadGatewayException("Shopee callback missing shop_id");
    const { partnerId, partnerKey } = await this.creds();
    const path = "/api/v2/auth/token/get";
    const data = await this.postToken(partnerId, partnerKey, path, {
      code,
      shop_id: Number(shopId),
      partner_id: Number(partnerId),
    });
    return this.toResult(data, shopId);
  }

  async refreshToken(refreshToken: string, shopId?: string): Promise<ConnectResult> {
    if (!shopId) throw new BadGatewayException("Shopee refresh missing shop_id");
    const { partnerId, partnerKey } = await this.creds();
    const path = "/api/v2/auth/access_token/get";
    const data = await this.postToken(partnerId, partnerKey, path, {
      refresh_token: refreshToken,
      shop_id: Number(shopId),
      partner_id: Number(partnerId),
    });
    return this.toResult(data, shopId);
  }

  private async postToken(
    partnerId: string,
    partnerKey: string,
    path: string,
    body: Record<string, unknown>,
  ) {
    const timestamp = unixNow();
    const sign = signShopee({ partnerId, partnerKey, path, timestamp });
    const qs = new URLSearchParams({
      partner_id: partnerId,
      timestamp: String(timestamp),
      sign,
    }).toString();
    const res = await fetch(`${SHOPEE_BASE}${path}?${qs}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as {
      error?: string;
      message?: string;
      access_token?: string;
      refresh_token?: string;
      expire_in?: number;
      refresh_token_expire_in?: number;
    };
    if (json.error || !json.access_token) {
      throw new BadGatewayException(`Shopee token error: ${json.error ?? json.message ?? "unknown"}`);
    }
    return json;
  }

  private toResult(
    data: Awaited<ReturnType<ShopeeAdapter["postToken"]>>,
    shopId: string,
  ): ConnectResult {
    const now = unixNow();
    // Shopee returns relative seconds (access ~4h, refresh ~30d) → absolute.
    return {
      accessToken: data.access_token!,
      refreshToken: data.refresh_token ?? "",
      accessTokenExpireAt: now + (data.expire_in ?? 14400),
      refreshTokenExpireAt: now + (data.refresh_token_expire_in ?? 2592000),
      shopId,
      merchantId: undefined,
      sellerRegion: "ID",
    };
  }
}
