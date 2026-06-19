import { Injectable, BadGatewayException, Logger } from "@nestjs/common";
import type { ConnectResult, MarketplaceAuthPort } from "@autotoko/shared";
import { AdminSettingsService } from "../../modules/admin-settings/admin-settings.service.js";
import { signTikTok, unixNow } from "../signing/tiktok.signer.js";

const TIKTOK_BASE = "https://open-api.tiktokglobalshop.com";
const VERSION = "202309";

interface TikTokCreds {
  appKey: string;
  appSecret: string;
  authUrl: string;
}

@Injectable()
export class TikTokAdapter implements MarketplaceAuthPort {
  readonly marketplace = "tiktok" as const;
  private readonly logger = new Logger(TikTokAdapter.name);

  constructor(private readonly settings: AdminSettingsService) {}

  private async creds(): Promise<TikTokCreds> {
    const appKey = await this.settings.get("tiktok_app_key");
    const appSecret = await this.settings.get("tiktok_app_secret");
    // Partner Center gives a fixed authorize link per app; admin pastes it here.
    const authUrl =
      (await this.settings.get("tiktok_auth_url")) ??
      "https://services.tiktokshop.com/open/authorize";
    if (!appKey || !appSecret) {
      throw new BadGatewayException("TikTok credentials not configured in Admin CMS");
    }
    return { appKey, appSecret, authUrl };
  }

  async getAuthUrl(state: string): Promise<string> {
    const { authUrl } = await this.creds();
    const sep = authUrl.includes("?") ? "&" : "?";
    return `${authUrl}${sep}state=${encodeURIComponent(state)}`;
  }

  async exchangeToken(code: string): Promise<ConnectResult> {
    const { appKey, appSecret } = await this.creds();
    const token = await this.fetchToken({
      app_key: appKey,
      app_secret: appSecret,
      auth_code: code,
      grant_type: "authorized_code",
    });
    const shop = await this.getFirstAuthorizedShop(appKey, appSecret, token.access_token);
    return this.toResult(token, shop);
  }

  async refreshToken(refreshToken: string): Promise<ConnectResult> {
    const { appKey, appSecret } = await this.creds();
    const token = await this.fetchToken({
      app_key: appKey,
      app_secret: appSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
    // Refresh keeps the same shop; cipher/id are persisted already.
    return this.toResult(token, undefined);
  }

  private async fetchToken(query: Record<string, string>) {
    const qs = new URLSearchParams(query).toString();
    const url = `${TIKTOK_BASE}/authorization/${VERSION}/token?${qs}`;
    const res = await fetch(url, { method: "GET" });
    const json = (await res.json()) as { code: number; message?: string; data?: any };
    if (json.code !== 0 || !json.data) {
      throw new BadGatewayException(`TikTok token error: ${json.message ?? json.code}`);
    }
    return json.data as {
      access_token: string;
      access_token_expire_in: number;
      refresh_token: string;
      refresh_token_expire_in: number;
      open_id?: string;
      seller_name?: string;
      seller_base_region?: string;
    };
  }

  private async getFirstAuthorizedShop(
    appKey: string,
    appSecret: string,
    accessToken: string,
  ) {
    const path = `/authorization/${VERSION}/shops`;
    const timestamp = unixNow();
    const query: Record<string, string | number> = { app_key: appKey, timestamp };
    const sign = signTikTok({ appSecret, path, query });
    const qs = new URLSearchParams({ app_key: appKey, timestamp: String(timestamp), sign }).toString();
    const res = await fetch(`${TIKTOK_BASE}${path}?${qs}`, {
      headers: { "x-tts-access-token": accessToken },
    });
    const json = (await res.json()) as { code: number; message?: string; data?: any };
    if (json.code !== 0) {
      throw new BadGatewayException(`TikTok get-shops error: ${json.message ?? json.code}`);
    }
    const shop = json.data?.shops?.[0];
    if (!shop) throw new BadGatewayException("No authorized TikTok shop returned");
    return shop as { id: string; name?: string; region?: string; cipher?: string };
  }

  private toResult(
    token: Awaited<ReturnType<TikTokAdapter["fetchToken"]>>,
    shop: { id: string; name?: string; region?: string; cipher?: string } | undefined,
  ): ConnectResult {
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      accessTokenExpireAt: token.access_token_expire_in,
      refreshTokenExpireAt: token.refresh_token_expire_in,
      shopId: shop?.id ?? "",
      shopCipher: shop?.cipher,
      shopName: shop?.name,
      sellerRegion: shop?.region ?? token.seller_base_region,
      openId: token.open_id,
    };
  }
}
