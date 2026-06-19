import { Injectable, BadGatewayException, Logger } from "@nestjs/common";
import type { ConnectResult, MarketplaceAuthPort } from "@autotoko/shared";
import { AdminSettingsService } from "../../modules/admin-settings/admin-settings.service.js";
import { signTikTok, unixNow } from "../signing/tiktok.signer.js";

const TIKTOK_BASE = "https://open-api.tiktokglobalshop.com";
// Auth/token service host — separate from the business open-api host.
// Token exchange/refresh: GET {AUTH_BASE}/api/v2/token/{get|refresh} (per CLAUDE2.md §4).
const TIKTOK_AUTH_BASE = "https://auth.tiktok-shops.com";
const DEFAULT_AUTHORIZE_URL = "https://services.tiktokshop.com/open/authorize";
const VERSION = "202309";

interface TikTokCreds {
  appKey: string;
  appSecret: string;
  authUrl: string;
  serviceId?: string;
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
    const authUrl = (await this.settings.get("tiktok_auth_url")) ?? DEFAULT_AUTHORIZE_URL;
    // TikTok Shop authorize URL is keyed by service_id (NOT app_key) — CLAUDE2.md §4.
    const serviceId = (await this.settings.get("tiktok_service_id")) ?? undefined;
    if (!appKey || !appSecret) {
      throw new BadGatewayException("TikTok credentials not configured in Admin CMS");
    }
    return { appKey, appSecret, authUrl, serviceId };
  }

  /**
   * Build the seller authorize URL:
   *   https://services.tiktokshop.com/open/authorize?service_id={SERVICE_ID}&state={state}
   * service_id comes from Admin CMS (`tiktok_service_id`); if the admin pasted a
   * full authorize URL that already carries service_id, we keep it.
   */
  async getAuthUrl(state: string): Promise<string> {
    const { authUrl, serviceId } = await this.creds();
    const url = new URL(authUrl);
    if (serviceId && !url.searchParams.has("service_id")) {
      url.searchParams.set("service_id", serviceId);
    }
    // service_id is MANDATORY. Without it TikTok rejects with "This service does
    // not exist". Fail loudly instead of redirecting the seller to a broken URL.
    // NOTE: service_id (App ID, Partner Center → App Detail) is DIFFERENT from
    // app_key (used only for token exchange).
    if (!url.searchParams.has("service_id")) {
      const msg =
        "TikTok `tiktok_service_id` is not configured in Admin CMS — the authorize " +
        "URL requires service_id (App ID from Partner Center → App Detail, which is " +
        "different from App Key).";
      this.logger.error(msg);
      throw new BadGatewayException(msg);
    }
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeToken(code: string): Promise<ConnectResult> {
    const { appKey, appSecret } = await this.creds();
    // auth_code expires in 30 min, single-use (CLAUDE2.md §4).
    const token = await this.fetchToken("get", {
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
    const token = await this.fetchToken("refresh", {
      app_key: appKey,
      app_secret: appSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
    // Refresh keeps the same shop; cipher/id are persisted already.
    return this.toResult(token, undefined);
  }

  private async fetchToken(endpoint: "get" | "refresh", query: Record<string, string>) {
    const qs = new URLSearchParams(query).toString();
    const url = `${TIKTOK_AUTH_BASE}/api/v2/token/${endpoint}?${qs}`;
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
