import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type { Marketplace } from "@autotoko/shared";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  shops,
  orders,
  webhookEvents,
  users,
  pricingConfig,
} from "../../database/schema/index.js";
import { WalletService } from "../billing/wallet.service.js";

interface OrderEvent {
  marketplace: Marketplace;
  eventType: string;
  eventId: string;
  mpShopId: string;
  orderId: string;
  status: string;
  buyerName?: string;
  totalAmount?: string;
  items?: unknown;
  payload: unknown;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly wallet: WalletService,
  ) {}

  /** TikTok Order Status webhook (PRD Bagian 8.1). */
  async handleTikTok(payload: any): Promise<unknown> {
    const data = payload?.data ?? {};
    const mpShopId = String(payload?.shop_id ?? data.shop_id ?? "");
    const orderId = String(data.order_id ?? "");
    const status = String(data.order_status ?? payload?.type ?? "");
    return this.ingest({
      marketplace: "tiktok",
      eventType: String(payload?.type ?? "ORDER_STATUS"),
      eventId: `tiktok:${payload?.type ?? "evt"}:${orderId}:${status}:${payload?.timestamp ?? ""}`,
      mpShopId,
      orderId,
      status,
      buyerName: data.buyer_name,
      totalAmount: data.payment?.total_amount ? String(data.payment.total_amount) : undefined,
      items: data.line_items,
      payload,
    });
  }

  /** Shopee push (code 3 = ORDER_STATUS). Push only signals change → store + upsert. */
  async handleShopee(payload: any): Promise<unknown> {
    const data = payload?.data ?? {};
    const mpShopId = String(payload?.shop_id ?? "");
    const orderId = String(data.ordersn ?? data.order_sn ?? "");
    const status = String(data.status ?? "");
    return this.ingest({
      marketplace: "shopee",
      eventType: `code_${payload?.code ?? "?"}`,
      eventId: `shopee:${orderId}:${status}:${payload?.timestamp ?? ""}`,
      mpShopId,
      orderId,
      status,
      payload,
    });
  }

  private async ingest(e: OrderEvent): Promise<unknown> {
    const [shop] = await this.db
      .select()
      .from(shops)
      .where(and(eq(shops.marketplace, e.marketplace), eq(shops.shopId, e.mpShopId)))
      .limit(1);

    // Idempotent record (unique marketplace+event_id) — PRD Bagian 8 webhook rules.
    const inserted = await this.db
      .insert(webhookEvents)
      .values({
        marketplace: e.marketplace,
        eventType: e.eventType,
        eventId: e.eventId,
        shopId: shop?.id,
        payload: e.payload as object,
      })
      .onConflictDoNothing({ target: [webhookEvents.marketplace, webhookEvents.eventId] })
      .returning({ id: webhookEvents.id });

    if (inserted.length === 0) {
      return { duplicate: true };
    }
    const eventRowId = inserted[0]!.id;

    let result: Record<string, unknown> = { recorded: true };
    let errorMessage: string | undefined;
    try {
      if (!shop) {
        result = { skipped: "shop_not_connected", mpShopId: e.mpShopId };
      } else if (e.orderId) {
        result = await this.upsertOrder(shop, e);
      }
    } catch (err) {
      errorMessage = (err as Error).message;
      this.logger.error(`Webhook processing failed: ${errorMessage}`);
    }

    await this.db
      .update(webhookEvents)
      .set({ processed: !errorMessage, processedAt: new Date(), errorMessage })
      .where(eq(webhookEvents.id, eventRowId));

    return { ...result, error: errorMessage };
  }

  private async upsertOrder(shop: typeof shops.$inferSelect, e: OrderEvent) {
    const [existing] = await this.db
      .select()
      .from(orders)
      .where(
        and(eq(orders.marketplace, e.marketplace), eq(orders.marketplaceOrderId, e.orderId)),
      )
      .limit(1);

    if (existing) {
      await this.db
        .update(orders)
        .set({ status: e.status, updatedAt: new Date() })
        .where(eq(orders.id, existing.id));
      return { order: existing.id, action: "updated", status: e.status };
    }

    const [order] = await this.db
      .insert(orders)
      .values({
        userId: shop.userId,
        shopId: shop.id,
        marketplace: e.marketplace,
        marketplaceOrderId: e.orderId,
        status: e.status,
        buyerName: e.buyerName,
        totalAmount: e.totalAmount,
        items: e.items as object,
      })
      .returning();

    const billing = await this.chargeTransactionFee(shop.userId, order!.id);
    return { order: order!.id, action: "created", billing };
  }

  /** Per-transaction billing (PRD Bagian 4.3): deduct fee on new order. */
  private async chargeTransactionFee(userId: string, orderId: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return { charged: false, reason: "user_not_found" };

    const [pricing] = await this.db
      .select()
      .from(pricingConfig)
      .where(eq(pricingConfig.planType, user.planType))
      .limit(1);
    const fee = Number(pricing?.perTransactionFee ?? 0);
    if (!pricing || fee <= 0) return { charged: false, reason: "no_fee" };

    try {
      await this.wallet.deduct(userId, "deduct_transaction", fee, orderId, "Per-transaction fee");
      await this.db
        .update(orders)
        .set({ feeDeducted: true, platformFee: fee.toFixed(2) })
        .where(eq(orders.id, orderId));
      return { charged: true, fee };
    } catch (err) {
      // Insufficient balance → flag, don't block the order (PRD Bagian 4.3).
      this.logger.warn(`Fee charge failed for order ${orderId}: ${(err as Error).message}`);
      return { charged: false, reason: "insufficient_balance", fee };
    }
  }
}
