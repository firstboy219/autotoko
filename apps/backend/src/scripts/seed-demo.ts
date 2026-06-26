import { existsSync, readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import {
  users,
  wallets,
  walletTransactions,
  shops,
  masterProducts,
  productPostings,
  bomItems,
  orders,
} from "../database/schema/index.js";

/**
 * Idempotent demo-data seeder for the TikTok App Review account
 * (demo@autotoko.id). Safe to run repeatedly.
 *   node dist/scripts/seed-demo.js   (run from the app root)
 *
 * Mirrors the demo user id used by AuthService.demoLogin.
 */
const DEMO_USER_ID = "00000000-0000-0000-0000-0000000000de";
const DEMO_SHOP_ID = "7494387970839184847";

function loadEnv(): void {
  if (process.env.DATABASE_URL) return;
  const path = process.env.ENV_FILE ?? "./.env";
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2]!.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[m[1]!] === undefined) process.env[m[1]!] = v;
  }
}

async function main() {
  loadEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  // 1) USER ------------------------------------------------------------------
  await db
    .insert(users)
    .values({
      id: DEMO_USER_ID,
      email: "demo@autotoko.id",
      whatsapp: "+6281234567890",
      fullName: "Demo AutoToko",
      planType: "pro",
    })
    .onConflictDoNothing();

  // 2) WALLET (balance 450000) ----------------------------------------------
  await db
    .insert(wallets)
    .values({ userId: DEMO_USER_ID, balance: "450000" })
    .onConflictDoNothing();
  await db.update(wallets).set({ balance: "450000" }).where(eq(wallets.userId, DEMO_USER_ID));
  const [wallet] = await db
    .select({ id: wallets.id })
    .from(wallets)
    .where(eq(wallets.userId, DEMO_USER_ID))
    .limit(1);

  // 3) SHOP ------------------------------------------------------------------
  let [shop] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(and(eq(shops.userId, DEMO_USER_ID), eq(shops.shopId, DEMO_SHOP_ID)))
    .limit(1);
  if (!shop) {
    const expire = new Date(Date.now() + 90 * 86400000);
    [shop] = await db
      .insert(shops)
      .values({
        userId: DEMO_USER_ID,
        marketplace: "tiktok",
        shopId: DEMO_SHOP_ID,
        shopName: "Toko Demo AutoToko",
        sellerRegion: "ID",
        accessToken: "DEMO_TOKEN_REVIEW",
        refreshToken: "DEMO_REFRESH_REVIEW",
        accessTokenExpireAt: expire,
        refreshTokenExpireAt: expire,
        shopStatus: "active",
        connectedAt: new Date(),
      })
      .returning({ id: shops.id });
  }
  const shopId = shop!.id;

  // 4) MASTER PRODUCTS -------------------------------------------------------
  const products = [
    { sku: "KOPI-ARABIKA-200", name: "Kopi Arabika Premium 200gr", price: "65000" },
    { sku: "TEH-HIJAU-100", name: "Teh Hijau Organik 100gr", price: "38000" },
    { sku: "KOPI-ROBUSTA-500", name: "Kopi Robusta 500gr", price: "72000" },
  ];
  for (const p of products) {
    await db
      .insert(masterProducts)
      .values({
        userId: DEMO_USER_ID,
        sku: p.sku,
        name: p.name,
        description: `${p.name} — produk demo AutoToko.`,
        basePrice: p.price,
        weightGram: 250,
        status: "active",
        images: [],
      })
      .onConflictDoNothing();
  }
  const masters = await db
    .select({ id: masterProducts.id, sku: masterProducts.sku, name: masterProducts.name, price: masterProducts.basePrice })
    .from(masterProducts)
    .where(eq(masterProducts.userId, DEMO_USER_ID));
  const bySku = new Map(masters.map((m) => [m.sku, m]));

  // 5) POSTINGS (link master ↔ demo shop) -----------------------------------
  for (const m of masters) {
    const [existing] = await db
      .select({ id: productPostings.id })
      .from(productPostings)
      .where(and(eq(productPostings.masterProductId, m.id), eq(productPostings.shopId, shopId)))
      .limit(1);
    if (!existing) {
      await db.insert(productPostings).values({
        masterProductId: m.id,
        shopId,
        marketplaceItemId: `ITEM-${m.sku}`,
        marketplaceSku: m.sku,
        title: m.name,
        price: m.price,
        stock: 100,
        status: "active",
        sold7d: 12,
        views7d: 340,
        gmv7d: "780000",
        reviewScore: "4.80",
        reviewCount: 23,
      });
    }
  }

  // 6) BOM ITEMS (one low-stock) --------------------------------------------
  const arabika = bySku.get("KOPI-ARABIKA-200");
  const teh = bySku.get("TEH-HIJAU-100");
  const robusta = bySku.get("KOPI-ROBUSTA-500");
  const boms = [
    { master: arabika, name: "Biji Kopi Arabika", qty: "0.2", stock: "3.2", min: "5.0", unit: "kg" }, // LOW
    { master: teh, name: "Daun Teh Hijau", qty: "0.1", stock: "8.5", min: "3.0", unit: "kg" },
    { master: robusta, name: "Kemasan Kraft 200gr", qty: "1", stock: "450", min: "100", unit: "pcs" },
  ];
  for (const b of boms) {
    if (!b.master) continue;
    const [existing] = await db
      .select({ id: bomItems.id })
      .from(bomItems)
      .where(and(eq(bomItems.masterProductId, b.master.id), eq(bomItems.materialName, b.name)))
      .limit(1);
    if (!existing) {
      await db.insert(bomItems).values({
        masterProductId: b.master.id,
        materialName: b.name,
        quantity: b.qty,
        unit: b.unit,
        currentStock: b.stock,
        minimumThreshold: b.min,
        restockMethod: "wa_owner",
        supplierName: "Supplier Demo",
      });
    }
  }

  // 7) ORDERS (varied statuses; a few dated today) --------------------------
  const buyers = ["Andi", "Budi", "Citra", "Dewi", "Eka", "Fajar", "Gita", "Hadi", "Indah"];
  const statuses = [
    "masuk", "masuk", "approved", "produksi", "packing", "dikirim", "selesai", "selesai", "approved",
  ] as const;
  const items = [
    [{ product_name: "Kopi Arabika Premium 200gr", seller_sku: "KOPI-ARABIKA-200", quantity: 2 }],
    [{ product_name: "Teh Hijau Organik 100gr", seller_sku: "TEH-HIJAU-100", quantity: 1 }],
    [{ product_name: "Kopi Robusta 500gr", seller_sku: "KOPI-ROBUSTA-500", quantity: 3 }],
  ];
  for (let i = 0; i < 9; i++) {
    const orderNo = `DEMO-${String(i + 1).padStart(4, "0")}`;
    const it = items[i % items.length]!;
    const total = it.reduce(
      (s, x) => s + (bySku.get(x.seller_sku)?.price ? Number(bySku.get(x.seller_sku)!.price) : 50000) * x.quantity,
      0,
    );
    // First 3 orders dated today (for today_orders/today_revenue); rest spread back.
    const created = i < 3 ? new Date(Date.now() - i * 3600_000) : new Date(Date.now() - i * 86400_000);
    await db
      .insert(orders)
      .values({
        userId: DEMO_USER_ID,
        shopId,
        marketplace: "tiktok",
        marketplaceOrderId: orderNo,
        status: "AWAITING_SHIPMENT",
        fulfillmentStatus: statuses[i]!,
        buyerName: buyers[i]!,
        totalAmount: String(total),
        platformFee: "200",
        feeDeducted: true,
        items: it,
        createdAt: created,
        createdAtMarketplace: created,
      })
      .onConflictDoNothing();
  }

  // 8) WALLET TRANSACTIONS (history) — only if none yet ----------------------
  if (wallet) {
    const existingTx = await db
      .select({ id: walletTransactions.id })
      .from(walletTransactions)
      .where(eq(walletTransactions.walletId, wallet.id))
      .limit(1);
    if (existingTx.length === 0) {
      let bal = 0;
      const topupAfter = bal + 500000;
      await db.insert(walletTransactions).values({
        walletId: wallet.id,
        type: "topup",
        amount: "500000",
        balanceBefore: String(bal),
        balanceAfter: String(topupAfter),
        referenceId: "DEMO-TOPUP-1",
        description: "Top-up saldo (demo)",
      });
      bal = topupAfter;
      for (let i = 1; i <= 5; i++) {
        const after = bal - 200;
        await db.insert(walletTransactions).values({
          walletId: wallet.id,
          type: "deduct_transaction",
          amount: "200",
          balanceBefore: String(bal),
          balanceAfter: String(after),
          referenceId: `DEMO-${String(i).padStart(4, "0")}`,
          description: "Biaya per-transaksi (demo)",
        });
        bal = after;
      }
    }
  }

  const counts = {
    masters: masters.length,
    orders: (await db.select({ id: orders.id }).from(orders).where(eq(orders.userId, DEMO_USER_ID))).length,
  };
  console.log("✅ Demo seed complete:", JSON.stringify(counts));
  await client.end();
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
