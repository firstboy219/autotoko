import {
  Inject,
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { and, eq, lt } from "drizzle-orm";
import type { ConnectResult, Marketplace } from "@autotoko/shared";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { shops } from "../../database/schema/index.js";
import { CryptoService } from "../../common/crypto/crypto.service.js";
import { MarketplaceService } from "../../marketplace/marketplace.service.js";

interface StatePayload {
  sub: string; // userId
  mp: Marketplace;
}

@Injectable()
export class ShopsService {
  private readonly logger = new Logger(ShopsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly marketplace: MarketplaceService,
    private readonly crypto: CryptoService,
    private readonly jwt: JwtService,
  ) {}

  /** Build the marketplace authorize URL; `state` is a short-lived signed JWT. */
  async getConnectUrl(userId: string, mp: Marketplace): Promise<{ authUrl: string }> {
    const adapter = this.marketplace.getAuthAdapter(mp);
    const state = this.jwt.sign({ sub: userId, mp } satisfies StatePayload, {
      expiresIn: "10m",
    });
    return { authUrl: await adapter.getAuthUrl(state) };
  }

  /** OAuth redirect lands here; exchange code → tokens → persist (encrypted). */
  async handleCallback(
    mp: Marketplace,
    params: { state?: string; code?: string; shopId?: string },
  ): Promise<{ shopId: string; shopName?: string }> {
    if (!params.state) throw new BadRequestException("Missing state");
    if (!params.code) throw new BadRequestException("Missing auth code");

    let payload: StatePayload;
    try {
      payload = this.jwt.verify<StatePayload>(params.state);
    } catch {
      throw new BadRequestException("Invalid or expired state");
    }
    if (payload.mp !== mp) throw new BadRequestException("State marketplace mismatch");

    const adapter = this.marketplace.getAuthAdapter(mp);
    const result = await adapter.exchangeToken(params.code, params.shopId);
    await this.saveShop(payload.sub, mp, result);
    return { shopId: result.shopId, shopName: result.shopName };
  }

  /**
   * Exchange an auth_code → tokens → persist, WITHOUT the signed-state step.
   * For admin/sandbox connections started outside our normal flow (e.g. a
   * sandbox shop authorised from Partner Center). Caller must be trusted (the
   * controller guards this with JwtAuthGuard + AdminOnly).
   */
  async connectManual(
    userId: string,
    mp: Marketplace,
    code: string,
    shopId?: string,
  ): Promise<{ shopId: string; shopName?: string }> {
    const adapter = this.marketplace.getAuthAdapter(mp);
    const result = await adapter.exchangeToken(code, shopId);
    await this.saveShop(userId, mp, result);
    this.logger.log(`Manual connect ${mp} shop ${result.shopId} for user ${userId}`);
    return { shopId: result.shopId, shopName: result.shopName };
  }

  async listShops(userId: string) {
    const rows = await this.db.select().from(shops).where(eq(shops.userId, userId));
    return rows.map((s) => ({
      id: s.id,
      marketplace: s.marketplace,
      shopId: s.shopId,
      shopName: s.shopName,
      sellerRegion: s.sellerRegion,
      shopStatus: s.shopStatus,
      accessTokenExpireAt: s.accessTokenExpireAt,
      connectedAt: s.connectedAt,
      lastSyncAt: s.lastSyncAt,
    }));
  }

  private async saveShop(userId: string, mp: Marketplace, r: ConnectResult): Promise<void> {
    const values = {
      userId,
      marketplace: mp,
      shopId: r.shopId,
      shopName: r.shopName,
      shopCipher: r.shopCipher,
      openId: r.openId,
      merchantId: r.merchantId,
      sellerRegion: r.sellerRegion,
      accessToken: this.crypto.encrypt(r.accessToken),
      accessTokenExpireAt: new Date(r.accessTokenExpireAt * 1000),
      refreshToken: r.refreshToken ? this.crypto.encrypt(r.refreshToken) : null,
      refreshTokenExpireAt: new Date(r.refreshTokenExpireAt * 1000),
      shopStatus: "active" as const,
      connectedAt: new Date(),
    };

    const [existing] = await this.db
      .select({ id: shops.id })
      .from(shops)
      .where(and(eq(shops.userId, userId), eq(shops.marketplace, mp), eq(shops.shopId, r.shopId)))
      .limit(1);

    if (existing) {
      await this.db.update(shops).set(values).where(eq(shops.id, existing.id));
      this.logger.log(`Reconnected ${mp} shop ${r.shopId}`);
    } else {
      await this.db.insert(shops).values(values);
      this.logger.log(`Connected new ${mp} shop ${r.shopId}`);
    }
  }

  /** Refresh tokens nearing expiry (PRD Bagian 5.5): Shopee 4h, TikTok 7d. */
  async refreshExpiring(): Promise<{ refreshed: number; failed: number }> {
    // Shopee: refresh within 1h of expiry; TikTok: within 24h. Use the wider
    // window and let each row decide.
    const threshold = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const candidates = await this.db
      .select()
      .from(shops)
      .where(and(eq(shops.shopStatus, "active"), lt(shops.accessTokenExpireAt, threshold)));

    let refreshed = 0;
    let failed = 0;
    for (const shop of candidates) {
      const isShopee = shop.marketplace === "shopee";
      const within = isShopee ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
      if (!shop.accessTokenExpireAt) continue;
      if (shop.accessTokenExpireAt.getTime() > Date.now() + within) continue;
      try {
        await this.refreshShop(shop);
        refreshed++;
      } catch (e) {
        failed++;
        this.logger.warn(`Token refresh failed for shop ${shop.id}: ${(e as Error).message}`);
      }
    }
    if (refreshed || failed) {
      this.logger.log(`Token refresh: ${refreshed} ok, ${failed} failed`);
    }
    return { refreshed, failed };
  }

  /** Manually refresh a single shop's token (user-triggered from Toko page). */
  async refreshOne(userId: string, shopId: string): Promise<{ accessTokenExpireAt: Date | null }> {
    const [shop] = await this.db
      .select()
      .from(shops)
      .where(and(eq(shops.id, shopId), eq(shops.userId, userId)))
      .limit(1);
    if (!shop) throw new NotFoundException("Toko tidak ditemukan");
    await this.refreshShop(shop);
    const [updated] = await this.db
      .select({ exp: shops.accessTokenExpireAt })
      .from(shops)
      .where(eq(shops.id, shopId))
      .limit(1);
    return { accessTokenExpireAt: updated?.exp ?? null };
  }

  /** Disconnect a shop (mark disconnected; keeps orders/history intact). */
  async disconnect(userId: string, shopId: string): Promise<{ id: string; shopStatus: string }> {
    const [shop] = await this.db
      .select({ id: shops.id })
      .from(shops)
      .where(and(eq(shops.id, shopId), eq(shops.userId, userId)))
      .limit(1);
    if (!shop) throw new NotFoundException("Toko tidak ditemukan");
    await this.db
      .update(shops)
      .set({ shopStatus: "disconnected", accessToken: null, refreshToken: null })
      .where(eq(shops.id, shopId));
    this.logger.log(`Shop ${shopId} disconnected by user ${userId}`);
    return { id: shopId, shopStatus: "disconnected" };
  }

  private async refreshShop(shop: typeof shops.$inferSelect): Promise<void> {
    if (!shop.refreshToken) throw new Error("No refresh token stored");
    const adapter = this.marketplace.getAuthAdapter(shop.marketplace);
    const refresh = this.crypto.decrypt(shop.refreshToken);
    const r = await adapter.refreshToken(refresh, shop.shopId);
    await this.db
      .update(shops)
      .set({
        accessToken: this.crypto.encrypt(r.accessToken),
        accessTokenExpireAt: new Date(r.accessTokenExpireAt * 1000),
        refreshToken: r.refreshToken ? this.crypto.encrypt(r.refreshToken) : shop.refreshToken,
        refreshTokenExpireAt: new Date(r.refreshTokenExpireAt * 1000),
      })
      .where(eq(shops.id, shop.id));
  }
}
