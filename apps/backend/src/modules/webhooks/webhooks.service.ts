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
import { EventsGateway } from "../events/events.gateway.js";
import { BomService } from "../bom/bom.service.js";
import { AiService } from "../ai/ai.service.js";
import { AiProviderService } from "../ai/ai-provider.service.js";
import { AutopilotLogService } from "../ai/autopilot-log.service.js";

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
  /**
   * Auth-lifecycle side effect to run during processing (instead of upsertOrder).
   * "disconnect"  -> set shopStatus = "disconnected" (TikTok seller deauthorisation).
   * "auth_expire" -> log a warning that the token needs refreshing (no state change).
   */
  authAction?: "disconnect" | "auth_expire";
}

/**
 * TikTok Shop webhook `type` is a NUMBER (not a string). Map it to a readable
 * label. Types currently subscribed in Partner Center are covered; unknown
 * numeric types fall back to `type_<n>`.
 */
const TIKTOK_EVENT_TYPE_LABELS: Record<number, string> = {
  2: "reverse",
  3: "recipient_address",
  4: "package_update",
  5: "product",
  6: "seller_deauthorisation",
  7: "auth_expire",
  11: "cancellation",
  12: "order_return",
  15: "product",
  16: "product",
  17: "product",
  18: "product",
  27: "inventory",
  64: "aftersales_request",
  65: "rma",
  67: "aftersales_refund",
  68: "inventory",
};

/** TikTok numeric types that carry order-lifecycle info worth upserting. */
const TIKTOK_ORDER_EVENT_TYPES = new Set([2, 4, 11, 12, 64, 65, 67]);

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly wallet: WalletService,
    private readonly events: EventsGateway,
    private readonly bom: BomService,
    private readonly ai: AiService,
    private readonly aiProvider: AiProviderService,
    private readonly autopilotLog: AutopilotLogService,
  ) {}

  /**
   * TikTok Shop webhook (PRD Bagian 8.1).
   *
   * The `type` field is a NUMBER, not a string. There is NO "Order Status
   * Update (type 1)"; order lifecycle is represented by types 4/11/12/64/65/67.
   * We map the numeric type to a readable label, extract a best-effort order id
   * for order-related types, and handle auth-lifecycle types (6/7) as side
   * effects through the shared ingest()/dedup path.
   */
  async handleTikTok(payload: any): Promise<unknown> {
    const data = payload?.data ?? {};
    const rawType = payload?.type;
    const typeNum = Number(rawType);
    const eventType = Number.isFinite(typeNum)
      ? (TIKTOK_EVENT_TYPE_LABELS[typeNum] ?? `type_${typeNum}`)
      : String(rawType ?? "unknown");

    const mpShopId = String(payload?.shop_id ?? data.shop_id ?? "");

    // Best-effort order id — TikTok puts it in several places depending on type.
    const orderId = String(
      data.order_id ?? data.order_sn ?? data.order_list?.[0]?.order_id ?? "",
    );
    // Best-effort status; fall back to the readable event label.
    const status = String(data.order_status ?? data.package_status ?? eventType);

    // Stable + unique dedup id. Prefer the provider's notification id when present.
    const eventId = payload?.tts_notification_id
      ? `tiktok:${String(payload.tts_notification_id)}`
      : `tiktok:${typeNum}:${orderId}:${status}:${payload?.timestamp ?? ""}`;

    let authAction: OrderEvent["authAction"];
    if (typeNum === 6) authAction = "disconnect";
    else if (typeNum === 7) authAction = "auth_expire";

    return this.ingest({
      marketplace: "tiktok",
      eventType,
      eventId,
      mpShopId,
      // Only treat as an order event for order-lifecycle types; otherwise leave
      // orderId blank so ingest() just records the event without upserting.
      orderId: TIKTOK_ORDER_EVENT_TYPES.has(typeNum) ? orderId : "",
      status,
      buyerName: data.buyer_name,
      totalAmount: data.payment?.total_amount ? String(data.payment.total_amount) : undefined,
      items: data.line_items,
      payload,
      authAction,
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
      if (e.authAction) {
        // Auth-lifecycle side effect runs even when no order is involved.
        result = await this.handleAuthLifecycle(shop, e);
      } else if (!shop) {
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

  /**
   * Auth-lifecycle side effects (TikTok types 6 & 7). Operates strictly by
   * marketplace + shopId for multi-tenant safety.
   *
   * - "disconnect" (type 6, seller deauthorisation): mark the shop disconnected.
   * - "auth_expire" (type 7): only log a warning. We deliberately do NOT mutate
   *   shopStatus here — an expired access token is recoverable via refresh, so
   *   flipping the shop to "deactivated" would be surprising/destructive state.
   */
  private async handleAuthLifecycle(
    shop: typeof shops.$inferSelect | undefined,
    e: OrderEvent,
  ): Promise<Record<string, unknown>> {
    if (e.authAction === "auth_expire") {
      this.logger.warn(
        `TikTok auth expired for shop ${e.mpShopId} — access token needs refresh.`,
      );
      return { authAction: "auth_expire", shop: shop?.id, action: "logged" };
    }

    // "disconnect"
    if (!shop) {
      return { authAction: "disconnect", skipped: "shop_not_connected", mpShopId: e.mpShopId };
    }
    await this.db
      .update(shops)
      .set({ shopStatus: "disconnected" })
      .where(and(eq(shops.marketplace, e.marketplace), eq(shops.shopId, e.mpShopId)));
    this.logger.warn(`TikTok shop ${e.mpShopId} deauthorised — marked disconnected.`);
    return { authAction: "disconnect", shop: shop.id, action: "disconnected" };
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
      const [updated] = await this.db
        .update(orders)
        .set({ status: e.status, updatedAt: new Date() })
        .where(eq(orders.id, existing.id))
        .returning();
      this.events.emitOrderUpdate(shop.userId, updated);
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
    // Auto-deduct raw materials (BOM) for the sold items; never blocks the order.
    let bom: { deducted: number } | { error: string } = { deducted: 0 };
    try {
      bom = await this.bom.deductForOrder({
        id: order!.id,
        userId: shop.userId,
        items: e.items,
      });
    } catch (err) {
      bom = { error: (err as Error).message };
      this.logger.warn(`BOM deduct failed for order ${order!.id}: ${(err as Error).message}`);
    }
    // Real-time push to the seller's dashboard.
    this.events.emitNewOrder(shop.userId, order);
    // AI autopilot: auto-approve the order if the owner enabled it (CMS toggle).
    const autopilot = await this.maybeAutoApprove(shop.userId, order!);
    return { order: order!.id, action: "created", billing, bom, autopilot };
  }

  /**
   * Auto Approve autopilot (PRD): when the owner switches the `auto_approve`
   * feature ON in the Admin CMS, let the AI decide whether each new order is
   * safe to approve. On approve → fulfillmentStatus "masuk" → "approved" and a
   * realtime order_update so a human can watch it happen. On reject or any
   * error we leave the order at "masuk" for manual review (fail-safe). Never
   * blocks order ingestion.
   */
  private async maybeAutoApprove(
    userId: string,
    order: typeof orders.$inferSelect,
  ): Promise<Record<string, unknown>> {
    try {
      if (!(await this.aiProvider.isFeatureEnabled("auto_approve"))) {
        return { enabled: false };
      }
      const itemCount = Array.isArray(order.items) ? order.items.length : undefined;
      const verdict = await this.ai.autoApprove({
        total: order.totalAmount ? Number(order.totalAmount) : undefined,
        buyerName: order.buyerName ?? undefined,
        itemCount,
        raw: order.items,
      });
      const provider = (await this.aiProvider.resolveConfig("auto_approve")).provider;
      if (verdict.approve) {
        const [updated] = await this.db
          .update(orders)
          .set({ fulfillmentStatus: "approved", updatedAt: new Date() })
          .where(eq(orders.id, order.id))
          .returning();
        this.events.emitOrderUpdate(userId, updated);
        this.logger.log(`Autopilot approved order ${order.id}: ${verdict.reason}`);
        await this.autopilotLog.record({
          userId,
          feature: "auto_approve",
          action: "auto_approve",
          status: "done",
          provider,
          summary: `Disetujui otomatis: ${verdict.reason}`,
          refType: "order",
          refId: order.id,
        });
        return { enabled: true, approved: true, reason: verdict.reason };
      }
      this.logger.log(`Autopilot held order ${order.id} for review: ${verdict.reason}`);
      await this.autopilotLog.record({
        userId,
        feature: "auto_approve",
        action: "auto_approve",
        status: "held",
        provider,
        summary: `Ditahan untuk review manual: ${verdict.reason}`,
        refType: "order",
        refId: order.id,
      });
      return { enabled: true, approved: false, reason: verdict.reason };
    } catch (err) {
      this.logger.warn(
        `Autopilot auto-approve failed for order ${order.id}: ${(err as Error).message}`,
      );
      await this.autopilotLog.record({
        userId,
        feature: "auto_approve",
        action: "auto_approve",
        status: "error",
        summary: (err as Error).message,
        refType: "order",
        refId: order.id,
      });
      return { enabled: true, error: (err as Error).message };
    }
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
