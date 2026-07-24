#!/usr/bin/env node
/**
 * Simulate a real TikTok Shop order webhook hitting AutoToko, to demonstrate
 * automatic order sync for the TikTok App Review.
 *
 * Flow:
 *   1. Passwordless demo login (demo@autotoko.id) -> JWT.
 *   2. POST a TikTok ORDER webhook to /api/webhooks/tiktok?secret=... with a
 *      real TikTok-format order_id (18 digits, 57/58) + item_id (17 digits, 17).
 *      NOTE: TikTok `type` is NUMERIC. Order-lifecycle types are 2/4/11/12/64/65/67
 *      (there is NO string "ORDER_STATUS_CHANGE"). We use type 4 (package_update)
 *      so the service upserts the order.
 *   3. Re-fetch /api/orders and confirm the order appears with that exact ID.
 *
 * Usage:
 *   API_BASE=https://apitoko.cosger.online \
 *   WEBHOOK_INGEST_SECRET=<server secret> \
 *   [ORDER_ID=578811223344556677] \
 *   node apps/backend/scripts/simulate-webhook.mjs
 */

const API_BASE = (process.env.API_BASE ?? "https://apitoko.cosger.online").replace(/\/$/, "");
const SECRET = process.env.WEBHOOK_INGEST_SECRET;
const SHOP_ID = process.env.SHOP_ID ?? "7494387970839184847";
// Default to a FRESH TikTok-format id (not in the seed) so it visibly appears as a new order.
const ORDER_ID = process.env.ORDER_ID ?? "578811223344556677";
const ITEM_ID = process.env.ITEM_ID ?? "17293847561920384";

if (!SECRET) {
  console.error("✗ WEBHOOK_INGEST_SECRET env var is required (read it from the server .env).");
  process.exit(1);
}

async function jsonFetch(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

async function main() {
  // 1) demo login -> JWT
  const login = await jsonFetch(`${API_BASE}/api/auth/demo-login`, { method: "POST" });
  const token = login.body?.data?.accessToken;
  if (!token) {
    console.error("✗ demo-login failed:", login.status, JSON.stringify(login.body));
    process.exit(1);
  }
  console.log("✓ Logged in as demo@autotoko.id");

  // 2) POST TikTok order webhook
  const payload = {
    type: 4, // package_update — numeric, order-lifecycle (string "ORDER_STATUS_CHANGE" would be ignored)
    shop_id: SHOP_ID,
    timestamp: Math.floor(Date.now() / 1000),
    tts_notification_id: `demo-${ORDER_ID}-${Date.now()}`,
    data: {
      order_id: ORDER_ID,
      order_status: "AWAITING_SHIPMENT",
      package_status: "AWAITING_SHIPMENT",
      create_time: Math.floor(Date.now() / 1000),
      shop_id: SHOP_ID,
      buyer_name: "Hendra Wijaya",
      payment: { total_amount: "130000", currency: "IDR" },
      line_items: [
        {
          item_id: ITEM_ID,
          product_name: "Kopi Arabika Premium 200gr",
          seller_sku: "KOPI-ARABIKA-200",
          quantity: 2,
          sale_price: "65000",
        },
      ],
    },
  };

  const hook = await jsonFetch(
    `${API_BASE}/api/webhooks/tiktok?secret=${encodeURIComponent(SECRET)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (hook.status !== 200 && hook.status !== 201) {
    console.error("✗ webhook rejected:", hook.status, JSON.stringify(hook.body));
    process.exit(1);
  }
  console.log(`✓ TikTok webhook accepted (order ${ORDER_ID}):`, JSON.stringify(hook.body?.data ?? hook.body));

  // 3) confirm the order is now in /api/orders
  await new Promise((r) => setTimeout(r, 600)); // let async processing settle
  const list = await jsonFetch(`${API_BASE}/api/orders`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const rows = Array.isArray(list.body?.data) ? list.body.data : [];
  const found = rows.find((o) => o.marketplaceOrderId === ORDER_ID);
  if (!found) {
    console.error(`✗ order ${ORDER_ID} not found in /api/orders (got ${rows.length} orders).`);
    process.exit(1);
  }
  console.log(
    `✓ Order ${ORDER_ID} synced & visible in dashboard:`,
    JSON.stringify({
      id: found.id,
      marketplace: found.marketplace,
      marketplaceOrderId: found.marketplaceOrderId,
      buyerName: found.buyerName,
      totalAmount: found.totalAmount,
      fulfillmentStatus: found.fulfillmentStatus,
      items: found.items,
    }, null, 2),
  );
  console.log("\n✅ Done — webhook order sync verified end-to-end.");
}

main().catch((e) => {
  console.error("Simulation failed:", e);
  process.exit(1);
});
