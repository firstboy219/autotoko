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
import { shops, subSellers, subSubSellers } from "../../database/schema/index.js";
import { CryptoService } from "../../common/crypto/crypto.service.js";
import { MarketplaceService } from "../../marketplace/marketplace.service.js";

type PrincipalType = "sub_seller" | "sub_sub_seller";

interface StatePayload {
  sub: string; // userId (tenant)
  mp: Marketplace;
  // Present only for a self-service connect initiated from the sub-seller/
  // sub-sub-seller portal (MAPPING_DAN_SELFSERVICE_TOKO.md) — reuses this
  // EXACT same OAuth flow, just carries who's connecting in the signed state.
  principalType?: PrincipalType;
  principalId?: string;
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

  /**
   * Build the marketplace authorize URL; `state` is a short-lived signed JWT.
   * `principal` is set only for a self-service connect from the portal — the
   * backend (not the request) decides ownership at callback time from this
   * signed value, so a sub-seller can never claim a shop on someone else's behalf.
   */
  async getConnectUrl(
    userId: string,
    mp: Marketplace,
    principal?: { type: PrincipalType; id: string },
  ): Promise<{ authUrl: string }> {
    const adapter = this.marketplace.getAuthAdapter(mp);
    const state = this.jwt.sign(
      {
        sub: userId,
        mp,
        ...(principal ? { principalType: principal.type, principalId: principal.id } : {}),
      } satisfies StatePayload,
      { expiresIn: "10m" },
    );
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
    // The marketplace-side authorization always completes here (auth_code is
    // single-use and short-lived) — a quota rejection below only affects
    // whether WE persist the shop, per MAPPING_DAN_SELFSERVICE_TOKO.md 2.2
    // ("proses OAuth tetap boleh jalan sampai selesai... sistem tolak
    // penyimpanan toko baru tersebut").
    const result = await adapter.exchangeToken(params.code, params.shopId);

    if (payload.principalType && payload.principalId) {
      await this.assertQuotaAvailable(payload.sub, payload.principalType, payload.principalId);
    }

    await this.saveShop(payload.sub, mp, result);

    if (payload.principalType && payload.principalId) {
      await this.assignSelfServiceOwnership(
        payload.sub,
        mp,
        result.shopId,
        payload.principalType,
        payload.principalId,
      );
    }

    return { shopId: result.shopId, shopName: result.shopName };
  }

  /**
   * Manual token exchange. Use when an authorization was started outside our
   * normal flow (e.g. a sandbox shop authorised from Partner Center), so no
   * AutoToko `state` JWT exists. Caller must be trusted (the controller guards
   * this with JwtAuthGuard + AdminOnly).
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

  /**
   * Enforced BEFORE saveShop() persists anything, so an over-quota self-service
   * connect never creates a shop row at all (MAPPING_DAN_SELFSERVICE_TOKO.md 2.2).
   * null kuota = unlimited.
   */
  private async assertQuotaAvailable(
    userId: string,
    type: PrincipalType,
    id: string,
  ): Promise<void> {
    if (type === "sub_seller") {
      const [row] = await this.db
        .select({ kuota: subSellers.kuotaTokoMaksimal })
        .from(subSellers)
        .where(and(eq(subSellers.id, id), eq(subSellers.userId, userId)))
        .limit(1);
      if (!row) throw new NotFoundException("Sub-seller not found");
      if (row.kuota == null) return;
      const owned = await this.db
        .select({ id: shops.id })
        .from(shops)
        .where(and(eq(shops.userId, userId), eq(shops.subSellerId, id)));
      if (owned.length >= row.kuota) {
        throw new BadRequestException(
          "Kuota toko Anda sudah penuh, hubungi Seller untuk menambah kuota",
        );
      }
      return;
    }
    const [row] = await this.db
      .select({ kuota: subSubSellers.kuotaTokoMaksimal })
      .from(subSubSellers)
      .where(and(eq(subSubSellers.id, id), eq(subSubSellers.userId, userId)))
      .limit(1);
    if (!row) throw new NotFoundException("Sub-sub-seller not found");
    if (row.kuota == null) return;
    const owned = await this.db
      .select({ id: shops.id })
      .from(shops)
      .where(and(eq(shops.userId, userId), eq(shops.subSubSellerId, id)));
    if (owned.length >= row.kuota) {
      throw new BadRequestException(
        "Kuota toko Anda sudah penuh, hubungi Seller untuk menambah kuota",
      );
    }
  }

  /**
   * Self-assigns the newly-connected shop to whichever principal initiated the
   * OAuth flow — taken from the signed state (never client input), so a
   * sub-seller/sub-sub-seller can only ever claim a shop as their own.
   */
  private async assignSelfServiceOwnership(
    userId: string,
    mp: Marketplace,
    shopId: string,
    type: PrincipalType,
    id: string,
  ): Promise<void> {
    await this.db
      .update(shops)
      .set({
        subSellerId: type === "sub_seller" ? id : null,
        subSubSellerId: type === "sub_sub_seller" ? id : null,
        addedByType: type,
        addedById: id,
      })
      .where(and(eq(shops.userId, userId), eq(shops.marketplace, mp), eq(shops.shopId, shopId)));
  }

  /** Refresh tokens nearing expiry (PRD Bagian 5.5): Shopee 4h, TikTok 7d. */
  async refreshExpiring(): Promise<{ refreshed: number; failed: number }> {
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
