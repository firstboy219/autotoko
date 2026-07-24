import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  subSellers,
  subSubSellers,
  shops,
  payoutSettings,
} from "../../database/schema/index.js";
import type {
  CreateSubSellerDto,
  UpdateSubSellerDto,
  CreateSubSubSellerDto,
  UpdateSubSubSellerDto,
  AssignShopDto,
  UpdatePayoutSettingsDto,
} from "./dto.js";

const rate = (r: number) => r.toFixed(4); // number -> numeric(5,4) string

@Injectable()
export class PayoutSellersService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  // --- Sub-sellers ---

  async listSubSellers(userId: string) {
    return this.db
      .select()
      .from(subSellers)
      .where(eq(subSellers.userId, userId))
      .orderBy(desc(subSellers.createdAt));
  }

  async createSubSeller(userId: string, dto: CreateSubSellerDto) {
    const [row] = await this.db
      .insert(subSellers)
      .values({
        userId,
        name: dto.name,
        contact: dto.contact ?? null,
        loginEmail: dto.loginEmail ?? null,
        bankAccount: dto.bankAccount ?? null,
        ...(dto.defaultRate != null ? { defaultRate: rate(dto.defaultRate) } : {}),
      })
      .returning();
    return row;
  }

  async updateSubSeller(userId: string, id: string, dto: UpdateSubSellerDto) {
    await this.getSubSellerOrThrow(userId, id);
    const [row] = await this.db
      .update(subSellers)
      .set({
        ...(dto.name != null ? { name: dto.name } : {}),
        ...(dto.contact != null ? { contact: dto.contact } : {}),
        ...(dto.loginEmail != null ? { loginEmail: dto.loginEmail } : {}),
        ...(dto.bankAccount != null ? { bankAccount: dto.bankAccount } : {}),
        ...(dto.defaultRate != null ? { defaultRate: rate(dto.defaultRate) } : {}),
        ...(dto.status != null ? { status: dto.status } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(subSellers.id, id), eq(subSellers.userId, userId)))
      .returning();
    return row;
  }

  private async getSubSellerOrThrow(userId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(subSellers)
      .where(and(eq(subSellers.id, id), eq(subSellers.userId, userId)))
      .limit(1);
    if (!row) throw new NotFoundException("Sub-seller not found");
    return row;
  }

  // --- Sub-sub-sellers ---

  async listSubSubSellers(userId: string, subSellerId?: string) {
    const where = subSellerId
      ? and(eq(subSubSellers.userId, userId), eq(subSubSellers.subSellerId, subSellerId))
      : eq(subSubSellers.userId, userId);
    return this.db
      .select()
      .from(subSubSellers)
      .where(where)
      .orderBy(desc(subSubSellers.createdAt));
  }

  async createSubSubSeller(userId: string, dto: CreateSubSubSellerDto) {
    // The parent sub-seller must exist within the same tenant (hierarchy rule).
    await this.getSubSellerOrThrow(userId, dto.subSellerId);
    const [row] = await this.db
      .insert(subSubSellers)
      .values({
        userId,
        subSellerId: dto.subSellerId,
        name: dto.name,
        contact: dto.contact ?? null,
        loginEmail: dto.loginEmail ?? null,
        bankAccount: dto.bankAccount ?? null,
        ...(dto.defaultRate != null ? { defaultRate: rate(dto.defaultRate) } : {}),
      })
      .returning();
    return row;
  }

  async updateSubSubSeller(userId: string, id: string, dto: UpdateSubSubSellerDto) {
    const [existing] = await this.db
      .select()
      .from(subSubSellers)
      .where(and(eq(subSubSellers.id, id), eq(subSubSellers.userId, userId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Sub-sub-seller not found");
    const [row] = await this.db
      .update(subSubSellers)
      .set({
        ...(dto.name != null ? { name: dto.name } : {}),
        ...(dto.contact != null ? { contact: dto.contact } : {}),
        ...(dto.loginEmail != null ? { loginEmail: dto.loginEmail } : {}),
        ...(dto.bankAccount != null ? { bankAccount: dto.bankAccount } : {}),
        ...(dto.defaultRate != null ? { defaultRate: rate(dto.defaultRate) } : {}),
        ...(dto.status != null ? { status: dto.status } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(subSubSellers.id, id), eq(subSubSellers.userId, userId)))
      .returning();
    return row;
  }

  // --- Shop assignment (requirement 5.3) ---

  async assignShop(userId: string, shopId: string, dto: AssignShopDto) {
    const [shop] = await this.db
      .select()
      .from(shops)
      .where(and(eq(shops.id, shopId), eq(shops.userId, userId)))
      .limit(1);
    if (!shop) throw new NotFoundException("Shop not found");

    const subSellerId = dto.subSellerId ?? null;
    const subSubSellerId = dto.subSubSellerId ?? null;

    // Business rule: sub_sub_seller_id must be null when sub_seller_id is null.
    if (subSubSellerId && !subSellerId) {
      throw new BadRequestException(
        "subSubSellerId requires subSellerId (invalid hierarchy)",
      );
    }
    // Referenced entities must belong to this tenant, and the sub-sub-seller must
    // sit under the given sub-seller.
    if (subSellerId) await this.getSubSellerOrThrow(userId, subSellerId);
    if (subSubSellerId) {
      const [ss] = await this.db
        .select()
        .from(subSubSellers)
        .where(and(eq(subSubSellers.id, subSubSellerId), eq(subSubSellers.userId, userId)))
        .limit(1);
      if (!ss) throw new NotFoundException("Sub-sub-seller not found");
      if (ss.subSellerId !== subSellerId) {
        throw new BadRequestException(
          "Sub-sub-seller does not belong to the given sub-seller",
        );
      }
    }

    const [row] = await this.db
      .update(shops)
      .set({
        subSellerId,
        subSubSellerId,
        rateOverrideSubSeller:
          dto.rateOverrideSubSeller != null ? rate(dto.rateOverrideSubSeller) : null,
        rateOverrideSubSubSeller:
          dto.rateOverrideSubSubSeller != null ? rate(dto.rateOverrideSubSubSeller) : null,
      })
      .where(and(eq(shops.id, shopId), eq(shops.userId, userId)))
      .returning();
    return row;
  }

  // --- Payout settings (requirement 5.4) — one row per tenant, lazily created ---

  async getSettings(userId: string) {
    const [row] = await this.db
      .select()
      .from(payoutSettings)
      .where(eq(payoutSettings.userId, userId))
      .limit(1);
    if (row) return row;
    const [created] = await this.db
      .insert(payoutSettings)
      .values({ userId })
      .returning();
    return created;
  }

  async updateSettings(userId: string, dto: UpdatePayoutSettingsDto) {
    await this.getSettings(userId); // ensure the row exists
    const [row] = await this.db
      .update(payoutSettings)
      .set({
        ...(dto.sedekahRate != null ? { sedekahRate: rate(dto.sedekahRate) } : {}),
        ...(dto.sedekahBasis != null ? { sedekahBasis: dto.sedekahBasis } : {}),
        ...(dto.sedekahBankAccount != null
          ? { sedekahBankAccount: dto.sedekahBankAccount }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(payoutSettings.userId, userId))
      .returning();
    return row;
  }
}
