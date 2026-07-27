import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  subSellers,
  subSubSellers,
  shops,
  payoutDisbursements,
  payoutMutations,
} from "../../database/schema/index.js";

export type PrincipalType = "sub_seller" | "sub_sub_seller";

/**
 * Read-only data for the Sub-seller/Sub-sub-seller portal (Bagian 5,
 * FLOW_PENCAIRAN_V2_FINAL.md — "toko miliknya saja... tanpa lihat Bagian
 * Seller"). Every query here is scoped by BOTH userId (tenant) AND the
 * specific principal id — never returns another entity's shops, amounts, or
 * the seller's own share.
 */
@Injectable()
export class PortalDataService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async getMe(userId: string, type: PrincipalType, id: string) {
    if (type === "sub_seller") {
      const [row] = await this.db
        .select({ id: subSellers.id, name: subSellers.name, contact: subSellers.contact })
        .from(subSellers)
        .where(and(eq(subSellers.id, id), eq(subSellers.userId, userId)))
        .limit(1);
      if (!row) throw new NotFoundException("Sub-seller not found");
      return { ...row, type };
    }
    const [row] = await this.db
      .select({ id: subSubSellers.id, name: subSubSellers.name, contact: subSubSellers.contact })
      .from(subSubSellers)
      .where(and(eq(subSubSellers.id, id), eq(subSubSellers.userId, userId)))
      .limit(1);
    if (!row) throw new NotFoundException("Sub-sub-seller not found");
    return { ...row, type };
  }

  /** Shops this principal is directly connected/assigned to (not shops under them via a child entity). */
  async listMyShops(userId: string, type: PrincipalType, id: string) {
    const ownerCol = type === "sub_seller" ? shops.subSellerId : shops.subSubSellerId;
    return this.db
      .select({
        id: shops.id,
        marketplace: shops.marketplace,
        shopName: shops.shopName,
        shopId: shops.shopId,
      })
      .from(shops)
      .where(and(eq(shops.userId, userId), eq(ownerCol, id)));
  }

  /**
   * Disbursements ADDRESSED TO this principal specifically — their actual
   * money-received history. For a sub-seller this naturally includes their
   * residual cut from Skenario C shops connected via a sub-sub-seller under
   * them too, since disbursements are generated per recipient regardless of
   * which scenario the shop is. Never includes sedekah or the seller's share.
   */
  async listMyHistory(userId: string, type: PrincipalType, id: string) {
    const recipientCol =
      type === "sub_seller"
        ? payoutDisbursements.recipientSubSellerId
        : payoutDisbursements.recipientSubSubSellerId;

    const rows = await this.db
      .select({
        id: payoutDisbursements.id,
        expectedAmount: payoutDisbursements.expectedAmount,
        validationStatus: payoutDisbursements.validationStatus,
        payoutDate: payoutMutations.payoutDate,
        shopName: shops.shopName,
        marketplace: shops.marketplace,
      })
      .from(payoutDisbursements)
      .innerJoin(payoutMutations, eq(payoutDisbursements.payoutMutationId, payoutMutations.id))
      .innerJoin(shops, eq(payoutMutations.shopId, shops.id))
      .where(and(eq(payoutDisbursements.userId, userId), eq(recipientCol, id)))
      .orderBy(desc(payoutMutations.payoutDate));

    return rows;
  }
}
