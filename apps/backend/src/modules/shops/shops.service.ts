import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Logger,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "node:crypto";
import { and, asc, eq, lt, sql } from "drizzle-orm";
import type { ConnectResult, Marketplace } from "@autotoko/shared";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  shopCategories,
  shops,
  subSellers,
  subSubSellers,
  payoutMutations,
} from "../../database/schema/index.js";
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
  // Present only when connecting a pre-existing "manual first" placeholder
  // shop (added via addManualShop before any real marketplace link existed) —
  // the callback UPDATES this exact row instead of insert/match-by-shopId.
  placeholderShopId?: string;
}

export interface ShopCategoryInput {
  name: string;
  color?: string | null;
  sortOrder?: number;
}

/** Hex only, and short enough that a stray paste cannot become a style. */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

@Injectable()
export class ShopsService {
  // ---------------------------------------------------------------- categories

  async listCategories(userId: string) {
    // A LEFT JOIN with GROUP BY rather than a correlated subquery built from
    // an sql`` template. The template version returned 0 for every category
    // while the identical SQL run by hand returned the right number:
    // interpolating a table object does not correlate the way it reads like it
    // does. Drizzle's own join machinery leaves nothing to interpret.
    return this.db
      .select({
        id: shopCategories.id,
        name: shopCategories.name,
        color: shopCategories.color,
        sortOrder: shopCategories.sortOrder,
        // count(shops.id), not count(*): with a LEFT JOIN, count(*) counts the
        // null row too and every empty category would report 1.
        shopCount: sql<number>`count(${shops.id})::int`,
      })
      .from(shopCategories)
      .leftJoin(shops, eq(shops.categoryId, shopCategories.id))
      .where(eq(shopCategories.userId, userId))
      .groupBy(shopCategories.id, shopCategories.name, shopCategories.color, shopCategories.sortOrder)
      .orderBy(asc(shopCategories.sortOrder), asc(shopCategories.name));
  }

  async createCategory(userId: string, input: ShopCategoryInput) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException("Nama kategori tidak boleh kosong.");
    if (input.color && !HEX_RE.test(input.color)) {
      throw new BadRequestException("Warna harus format hex, contoh #0E6E55.");
    }
    try {
      const [row] = await this.db
        .insert(shopCategories)
        .values({
          userId,
          name,
          color: input.color ?? null,
          sortOrder: input.sortOrder ?? 0,
        })
        .returning();
      return row;
    } catch (e) {
      // 23505 = the (user, name) unique index. Reaching it means the owner
      // already has this category, which is worth saying plainly rather than
      // surfacing as a 500.
      if ((e as { code?: string }).code === "23505") {
        throw new ConflictException(`Kategori "${name}" sudah ada.`);
      }
      throw e;
    }
  }

  async updateCategory(userId: string, id: string, input: Partial<ShopCategoryInput>) {
    const set: Record<string, unknown> = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException("Nama kategori tidak boleh kosong.");
      set.name = name;
    }
    if (input.color !== undefined) {
      if (input.color && !HEX_RE.test(input.color)) {
        throw new BadRequestException("Warna harus format hex, contoh #0E6E55.");
      }
      set.color = input.color || null;
    }
    if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
    if (!Object.keys(set).length) throw new BadRequestException("Tidak ada perubahan.");

    try {
      const [row] = await this.db
        .update(shopCategories)
        .set(set)
        .where(and(eq(shopCategories.userId, userId), eq(shopCategories.id, id)))
        .returning();
      if (!row) throw new NotFoundException("Kategori tidak ditemukan.");
      return row;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") {
        throw new ConflictException("Sudah ada kategori dengan nama itu.");
      }
      throw e;
    }
  }

  /**
   * Removing a category leaves its shops alone — they simply become
   * ungrouped. Deleting shops along with a bookkeeping label would be a
   * catastrophic reading of "delete category".
   */
  async deleteCategory(userId: string, id: string) {
    const [row] = await this.db
      .delete(shopCategories)
      .where(and(eq(shopCategories.userId, userId), eq(shopCategories.id, id)))
      .returning();
    if (!row) throw new NotFoundException("Kategori tidak ditemukan.");
    return { ok: true as const, name: row.name };
  }

  /** Assign or clear a shop's category. null clears it. */
  async setShopCategory(userId: string, shopId: string, categoryId: string | null) {
    if (categoryId) {
      const [cat] = await this.db
        .select({ id: shopCategories.id })
        .from(shopCategories)
        .where(and(eq(shopCategories.userId, userId), eq(shopCategories.id, categoryId)))
        .limit(1);
      // Without this a caller could point a shop at another tenant's category.
      if (!cat) throw new NotFoundException("Kategori tidak ditemukan.");
    }
    const [row] = await this.db
      .update(shops)
      .set({ categoryId })
      .where(and(eq(shops.userId, userId), eq(shops.id, shopId)))
      .returning({ id: shops.id, categoryId: shops.categoryId });
    if (!row) throw new NotFoundException("Toko tidak ditemukan.");
    return row;
  }

  private readonly logger = new Logger(ShopsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly marketplace: MarketplaceService,
    private readonly crypto: CryptoService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Build the marketplace authorize URL; `state` is a short-lived signed JWT.
   * `principal` is set only for a self-service connect from the portal, and
   * `placeholderShopId` only when finishing a "manual first" placeholder — the
   * backend (not the request) decides what happens at callback time from this
   * signed value, so a sub-seller can never claim a shop on someone else's
   * behalf, and a placeholder can only ever be completed by its own owner.
   */
  async getConnectUrl(
    userId: string,
    mp: Marketplace,
    opts?: { principal?: { type: PrincipalType; id: string }; placeholderShopId?: string },
  ): Promise<{ authUrl: string }> {
    if (opts?.placeholderShopId) {
      const [placeholder] = await this.db
        .select({ id: shops.id, connectedAt: shops.connectedAt })
        .from(shops)
        .where(and(eq(shops.id, opts.placeholderShopId), eq(shops.userId, userId)))
        .limit(1);
      if (!placeholder) throw new NotFoundException("Toko tidak ditemukan");
      if (placeholder.connectedAt) {
        throw new BadRequestException("Toko ini sudah terhubung");
      }
    }
    const adapter = this.marketplace.getAuthAdapter(mp);
    const state = this.jwt.sign(
      {
        sub: userId,
        mp,
        ...(opts?.principal
          ? { principalType: opts.principal.type, principalId: opts.principal.id }
          : {}),
        ...(opts?.placeholderShopId ? { placeholderShopId: opts.placeholderShopId } : {}),
      } satisfies StatePayload,
      { expiresIn: "10m" },
    );
    return { authUrl: await adapter.getAuthUrl(state) };
  }

  /**
   * "Tambah Toko Manual First" — a placeholder shop the Seller creates before
   * it's really connected to the marketplace (e.g. planning payout hierarchy
   * ahead of time). Identified by connectedAt IS NULL; shopId is a synthetic
   * "manual-<uuid>" so it can never collide with a real marketplace shop id.
   * Finished later via getConnectUrl's placeholderShopId option, which UPDATES
   * this same row (never creates a duplicate).
   */
  async addManualShop(userId: string, mp: Marketplace, shopName: string) {
    const [row] = await this.db
      .insert(shops)
      .values({
        userId,
        marketplace: mp,
        shopId: `manual-${randomUUID()}`,
        shopName,
        shopStatus: "active",
      })
      .returning();
    return row;
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

    if (payload.placeholderShopId) {
      await this.updatePlaceholderShop(payload.placeholderShopId, payload.sub, mp, result);
    } else {
      await this.saveShop(payload.sub, mp, result);
    }

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
    // Joined rather than resolved in the page: the category's name and colour
    // are needed on every row, and fetching them separately would make the
    // grouping flicker into place after the list has already drawn.
    const rows = await this.db
      .select({
        shop: shops,
        categoryName: shopCategories.name,
        categoryColor: shopCategories.color,
      })
      .from(shops)
      .leftJoin(shopCategories, eq(shops.categoryId, shopCategories.id))
      .where(eq(shops.userId, userId));

    return rows.map(({ shop: s, categoryName, categoryColor }) => ({
      id: s.id,
      marketplace: s.marketplace,
      shopId: s.shopId,
      shopName: s.shopName,
      displayName: s.displayName,
      sellerRegion: s.sellerRegion,
      shopStatus: s.shopStatus,
      accessTokenExpireAt: s.accessTokenExpireAt,
      connectedAt: s.connectedAt,
      lastSyncAt: s.lastSyncAt,
      categoryId: s.categoryId,
      categoryName,
      categoryColor,
    }));
  }


  /**
   * Edits the seller-facing details of a shop.
   *
   * `displayName` is a label owned by the seller and is stored separately from
   * shopName, which saveShop() rewrites from the marketplace on every
   * reconnect. Passing an empty string clears the override and reverts to the
   * marketplace name.
   *
   * `marketplace` is only editable while the shop is still a placeholder — once
   * connected it is bound to the OAuth tokens, so changing it would leave the
   * row describing one marketplace while holding another's credentials.
   */
  async updateShop(
    userId: string,
    id: string,
    dto: { displayName?: string | null; marketplace?: Marketplace },
  ) {
    const [shop] = await this.db
      .select()
      .from(shops)
      .where(and(eq(shops.id, id), eq(shops.userId, userId)))
      .limit(1);
    if (!shop) throw new NotFoundException("Toko tidak ditemukan");

    const set: Record<string, unknown> = {};

    if (dto.displayName !== undefined) {
      const trimmed = dto.displayName?.trim() ?? "";
      set.displayName = trimmed === "" ? null : trimmed;
    }

    if (dto.marketplace !== undefined && dto.marketplace !== shop.marketplace) {
      if (shop.connectedAt) {
        throw new BadRequestException(
          "Marketplace tidak bisa diubah untuk toko yang sudah terhubung — putuskan koneksi dulu.",
        );
      }
      set.marketplace = dto.marketplace;
    }

    if (Object.keys(set).length) {
      await this.db.update(shops).set(set).where(and(eq(shops.id, id), eq(shops.userId, userId)));
      this.logger.log(`Shop ${id} updated by user ${userId}`);
    }

    const [updated] = await this.db
      .select()
      .from(shops)
      .where(eq(shops.id, id))
      .limit(1);
    return {
      id: updated!.id,
      marketplace: updated!.marketplace,
      shopId: updated!.shopId,
      shopName: updated!.shopName,
      displayName: updated!.displayName,
      sellerRegion: updated!.sellerRegion,
      shopStatus: updated!.shopStatus,
      accessTokenExpireAt: updated!.accessTokenExpireAt,
      connectedAt: updated!.connectedAt,
      lastSyncAt: updated!.lastSyncAt,
    };
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
   * Fills in a "manual first" placeholder with the real marketplace connection,
   * updating that SAME row (by id) rather than insert-or-match-by-shopId, so
   * completing it never creates a duplicate and never loses the row's id
   * (already possibly assigned to a sub-seller / referenced elsewhere).
   */
  private async updatePlaceholderShop(
    placeholderId: string,
    userId: string,
    mp: Marketplace,
    r: ConnectResult,
  ): Promise<void> {
    await this.db
      .update(shops)
      .set({
        marketplace: mp,
        shopId: r.shopId,
        ...(r.shopName ? { shopName: r.shopName } : {}), // keep the user's chosen name if the marketplace doesn't supply one
        shopCipher: r.shopCipher,
        openId: r.openId,
        merchantId: r.merchantId,
        sellerRegion: r.sellerRegion,
        accessToken: this.crypto.encrypt(r.accessToken),
        accessTokenExpireAt: new Date(r.accessTokenExpireAt * 1000),
        refreshToken: r.refreshToken ? this.crypto.encrypt(r.refreshToken) : null,
        refreshTokenExpireAt: new Date(r.refreshTokenExpireAt * 1000),
        shopStatus: "active",
        connectedAt: new Date(),
      })
      .where(and(eq(shops.id, placeholderId), eq(shops.userId, userId)));
    this.logger.log(`Placeholder shop ${placeholderId} completed as ${mp} shop ${r.shopId}`);
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

  /**
   * Disconnect a shop (mark disconnected; keeps orders/history intact). A
   * "manual first" placeholder that was never actually connected
   * (connectedAt IS NULL) has no real connection or history to preserve, so
   * this hard-deletes it instead — otherwise it'd sit forever as an inert
   * "disconnected" row nobody can act on.
   */
  async disconnect(userId: string, shopId: string): Promise<{ id: string; shopStatus: string }> {
    const [shop] = await this.db
      .select({ id: shops.id, connectedAt: shops.connectedAt })
      .from(shops)
      .where(and(eq(shops.id, shopId), eq(shops.userId, userId)))
      .limit(1);
    if (!shop) throw new NotFoundException("Toko tidak ditemukan");

    if (!shop.connectedAt) {
      const [used] = await this.db
        .select({ id: payoutMutations.id })
        .from(payoutMutations)
        .where(eq(payoutMutations.shopId, shopId))
        .limit(1);
      if (used) {
        throw new BadRequestException(
          "Toko ini sudah dipakai di riwayat pencairan — tidak bisa dihapus",
        );
      }
      await this.db.delete(shops).where(eq(shops.id, shopId));
      this.logger.log(`Placeholder shop ${shopId} deleted by user ${userId}`);
      return { id: shopId, shopStatus: "deleted" };
    }

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
