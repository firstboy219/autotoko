import { existsSync, readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, sql } from "drizzle-orm";
import postgres from "postgres";
import {
  users,
  wallets,
  walletTransactions,
  platformInvoices,
  shops,
  masterProducts,
  productPostings,
  bomItems,
  orders,
  affiliates,
  chatLogs,
  reviewLogs,
  notifications,
  autopilotActivity,
  pricingConfig,
} from "../database/schema/index.js";

/**
 * Idempotent demo-data seeder for the TikTok App Review account
 * (demo@autotoko.id). Safe to run repeatedly:
 *   node dist/scripts/seed-demo.js   (run from the app root)
 *
 * Paints a coherent picture of a coffee/tea seller running on AutoToko autopilot,
 * so a reviewer immediately understands what the platform does: connected shop,
 * master products, orders (with AI auto-approve activity), BOM auto-restock
 * alerts, affiliate management, AI buyer/affiliate chat, AI review replies,
 * wallet/billing, and notifications.
 *
 * Runs inside a SET app.bypass transaction so it works under Postgres RLS.
 */
const DEMO_USER_ID = "00000000-0000-0000-0000-0000000000de";
const DEMO_SHOP_ID = "7494387970839184847";
const now = () => new Date();
const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);

function loadEnv(): void {
  if (process.env.DATABASE_URL) return;
  const path = process.env.ENV_FILE ?? "./.env";
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2]!.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]!] === undefined) process.env[m[1]!] = v;
  }
}

async function main() {
  loadEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  await db.transaction(async (tx) => {
    // RLS bypass for the whole seed (FORCE RLS is on the tenant tables).
    await tx.execute(sql`select set_config('app.bypass', 'on', true)`);

    // 1) USER + WALLET -------------------------------------------------------
    await tx
      .insert(users)
      .values({
        id: DEMO_USER_ID,
        email: "demo@autotoko.id",
        whatsapp: "+6281234567890",
        fullName: "Demo AutoToko (Kopi Nusantara)",
        planType: "pro",
      })
      .onConflictDoNothing();
    await tx.insert(wallets).values({ userId: DEMO_USER_ID, balance: "450000" }).onConflictDoNothing();
    await tx.update(wallets).set({ balance: "450000" }).where(eq(wallets.userId, DEMO_USER_ID));
    const [wallet] = await tx
      .select({ id: wallets.id })
      .from(wallets)
      .where(eq(wallets.userId, DEMO_USER_ID))
      .limit(1);

    // 1b) PRICING PLANS (global config; for onboarding / Paket page) ---------
    const plans = [
      { planType: "freemium" as const, monthlyFee: "0", setupFee: "0", perTransactionFee: "0", maxShops: 1, maxOrdersPerMonth: 50 },
      { planType: "starter" as const, monthlyFee: "99000", setupFee: "99000", perTransactionFee: "200", maxShops: 3, maxOrdersPerMonth: 500 },
      { planType: "pro" as const, monthlyFee: "299000", setupFee: "199000", perTransactionFee: "100", maxShops: 0, maxOrdersPerMonth: 0 },
    ];
    for (const p of plans) {
      const [exists] = await tx
        .select({ id: pricingConfig.id })
        .from(pricingConfig)
        .where(eq(pricingConfig.planType, p.planType))
        .limit(1);
      if (!exists) await tx.insert(pricingConfig).values({ ...p, isActive: true });
    }

    // 2) SHOP ----------------------------------------------------------------
    let [shop] = await tx
      .select({ id: shops.id })
      .from(shops)
      .where(and(eq(shops.userId, DEMO_USER_ID), eq(shops.shopId, DEMO_SHOP_ID)))
      .limit(1);
    if (!shop) {
      const expire = new Date(Date.now() + 90 * 86400_000);
      [shop] = await tx
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
          connectedAt: daysAgo(20),
        })
        .returning({ id: shops.id });
    }
    const shopId = shop!.id;

    // 3) MASTER PRODUCTS -----------------------------------------------------
    const products = [
      { sku: "KOPI-ARABIKA-200", name: "Kopi Arabika Premium 200gr", price: "65000" },
      { sku: "TEH-HIJAU-100", name: "Teh Hijau Organik 100gr", price: "38000" },
      { sku: "KOPI-ROBUSTA-500", name: "Kopi Robusta 500gr", price: "72000" },
    ];
    for (const p of products) {
      await tx
        .insert(masterProducts)
        .values({
          userId: DEMO_USER_ID,
          sku: p.sku,
          name: p.name,
          description: `${p.name} — biji pilihan, dipanggang segar. Produk demo AutoToko.`,
          basePrice: p.price,
          weightGram: 250,
          status: "active",
          images: [],
        })
        .onConflictDoNothing();
    }
    const masters = await tx
      .select({ id: masterProducts.id, sku: masterProducts.sku, name: masterProducts.name, price: masterProducts.basePrice })
      .from(masterProducts)
      .where(eq(masterProducts.userId, DEMO_USER_ID));
    const bySku = new Map(masters.map((m) => [m.sku, m]));

    // 4) POSTINGS ------------------------------------------------------------
    for (const m of masters) {
      const [exists] = await tx
        .select({ id: productPostings.id })
        .from(productPostings)
        .where(and(eq(productPostings.masterProductId, m.id), eq(productPostings.shopId, shopId)))
        .limit(1);
      if (!exists) {
        await tx.insert(productPostings).values({
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

    // 5) BOM (one low-stock → restock alert) ---------------------------------
    const boms = [
      { sku: "KOPI-ARABIKA-200", name: "Biji Kopi Arabika", qty: "0.2", stock: "3.2", min: "5.0", unit: "kg", supplier: "CV Sumber Tani" },
      { sku: "TEH-HIJAU-100", name: "Daun Teh Hijau", qty: "0.1", stock: "8.5", min: "3.0", unit: "kg", supplier: "Kebun Teh Ciwidey" },
      { sku: "KOPI-ROBUSTA-500", name: "Kemasan Kraft 200gr", qty: "1", stock: "450", min: "100", unit: "pcs", supplier: "Toko Kemasan Jaya" },
    ];
    for (const b of boms) {
      const m = bySku.get(b.sku);
      if (!m) continue;
      const [exists] = await tx
        .select({ id: bomItems.id })
        .from(bomItems)
        .where(and(eq(bomItems.masterProductId, m.id), eq(bomItems.materialName, b.name)))
        .limit(1);
      if (!exists) {
        await tx.insert(bomItems).values({
          masterProductId: m.id,
          materialName: b.name,
          quantity: b.qty,
          unit: b.unit,
          currentStock: b.stock,
          minimumThreshold: b.min,
          restockMethod: "wa_supplier",
          supplierName: b.supplier,
          supplierWaNumber: "+6281200000000",
        });
      }
    }

    // 6) ORDERS (16, spread over 7 days; recent few refreshed to today) ------
    const buyers = ["Andi", "Budi", "Citra", "Dewi", "Eka", "Fajar", "Gita", "Hadi", "Indah", "Joko", "Kirana", "Lina", "Maya", "Nanda", "Oki", "Putri"];
    const statuses = ["masuk", "masuk", "approved", "approved", "produksi", "produksi", "packing", "packing", "siap_kirim", "dikirim", "dikirim", "selesai", "selesai", "selesai", "approved", "masuk"] as const;
    const itemSets = [
      [{ product_name: "Kopi Arabika Premium 200gr", seller_sku: "KOPI-ARABIKA-200", quantity: 2 }],
      [{ product_name: "Teh Hijau Organik 100gr", seller_sku: "TEH-HIJAU-100", quantity: 1 }],
      [{ product_name: "Kopi Robusta 500gr", seller_sku: "KOPI-ROBUSTA-500", quantity: 3 }],
      [
        { product_name: "Kopi Arabika Premium 200gr", seller_sku: "KOPI-ARABIKA-200", quantity: 1 },
        { product_name: "Teh Hijau Organik 100gr", seller_sku: "TEH-HIJAU-100", quantity: 2 },
      ],
    ];
    for (let i = 0; i < 16; i++) {
      const orderNo = `DEMO-${String(i + 1).padStart(4, "0")}`;
      const it = itemSets[i % itemSets.length]!;
      const total = it.reduce((s, x) => s + (Number(bySku.get(x.seller_sku)?.price ?? 50000)) * x.quantity, 0);
      // Spread across the last 7 days; first 4 are "today" (kept fresh below).
      const created = i < 4 ? hoursAgo(i * 2 + 1) : daysAgo((i % 7) + 1);
      await tx
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
    // Keep the 4 newest demo orders dated "today" so the dashboard stays current.
    for (let i = 1; i <= 4; i++) {
      await tx
        .update(orders)
        .set({ createdAt: hoursAgo(i), createdAtMarketplace: hoursAgo(i) })
        .where(and(eq(orders.userId, DEMO_USER_ID), eq(orders.marketplaceOrderId, `DEMO-${String(i).padStart(4, "0")}`)));
    }
    const demoOrders = await tx
      .select({ id: orders.id, no: orders.marketplaceOrderId, buyer: orders.buyerName, total: orders.totalAmount })
      .from(orders)
      .where(eq(orders.userId, DEMO_USER_ID));
    const orderByNo = new Map(demoOrders.map((o) => [o.no, o]));

    // ---- showcase tables: delete demo rows then reinsert fresh (idempotent) ----

    // 7) AUTOPILOT ACTIVITY (AI auto-approve in action) ----------------------
    await tx.delete(autopilotActivity).where(eq(autopilotActivity.userId, DEMO_USER_ID));
    const apFor = (no: string) => orderByNo.get(no);
    const apRows = [
      { no: "DEMO-0003", status: "done", summary: "Disetujui otomatis: stok cukup, alamat valid, tidak ada indikasi fraud." },
      { no: "DEMO-0004", status: "done", summary: "Disetujui otomatis: pembeli reguler, nominal wajar." },
      { no: "DEMO-0015", status: "done", summary: "Disetujui otomatis: order standar 1 item." },
      { no: "DEMO-0001", status: "held", summary: "Ditahan untuk review: alamat kirim berbeda jauh dari riwayat pembeli." },
    ];
    for (let i = 0; i < apRows.length; i++) {
      const r = apRows[i]!;
      const o = apFor(r.no);
      await tx.insert(autopilotActivity).values({
        userId: DEMO_USER_ID,
        feature: "auto_approve",
        action: "auto_approve",
        status: r.status as "done" | "held",
        provider: "anthropic",
        summary: r.summary,
        refType: "order",
        refId: o?.id,
        createdAt: hoursAgo(i * 3 + 1),
      });
    }

    // 8) AFFILIATES (affiliate management) -----------------------------------
    await tx.delete(affiliates).where(eq(affiliates.userId, DEMO_USER_ID));
    await tx.insert(affiliates).values([
      { userId: DEMO_USER_ID, marketplace: "tiktok", creatorId: "@kopiku_id", creatorName: "Kopiku Review", followerCount: 125000, niche: "F&B / Kopi", status: "active", commissionRate: "12.00", totalGmv: "4250000", notes: "Top performer, konten konsisten.", invitedAt: daysAgo(25) },
      { userId: DEMO_USER_ID, marketplace: "tiktok", creatorId: "@ngopiyuk", creatorName: "Ngopi Yuk", followerCount: 48000, niche: "Lifestyle", status: "invited", commissionRate: "10.00", totalGmv: "0", notes: "Diundang via AI, menunggu respons.", invitedAt: daysAgo(3) },
      { userId: DEMO_USER_ID, marketplace: "tiktok", creatorId: "@reviewjajan", creatorName: "Review Jajan", followerCount: 310000, niche: "Food Review", status: "prospect", commissionRate: null, totalGmv: "0", notes: "Kandidat dari pencarian kreator." },
    ]);

    // 9) AI CHAT LOGS (auto chat to buyer / affiliate) -----------------------
    await tx.delete(chatLogs).where(eq(chatLogs.shopId, shopId));
    await tx.insert(chatLogs).values([
      { shopId, orderId: orderByNo.get("DEMO-0002")?.id ?? null, chatType: "buyer", counterpartName: "Dewi", messageIn: "Kak, kopinya masih ready? Bisa kirim hari ini?", messageOut: "Halo Kak Dewi! Ready ya 😊 Kalau order sebelum jam 3 sore, kami kirim hari ini juga. Terima kasih!", aiModel: "claude-opus-4-8", tokensUsed: 320, marketplaceSent: true },
      { shopId, chatType: "buyer", counterpartName: "Fajar", messageIn: "Beda arabika sama robusta apa ya?", messageOut: "Arabika lebih ringan & sedikit asam-buah, cocok diseduh manual. Robusta lebih strong & pahit, mantap buat espresso/kopi susu. Mau direkomendasikan yang mana, Kak?", aiModel: "claude-opus-4-8", tokensUsed: 410, marketplaceSent: true },
      { shopId, chatType: "affiliate", counterpartId: "@ngopiyuk", counterpartName: "Ngopi Yuk", messageIn: "Komisinya berapa kalau aku promoin produk kopinya?", messageOut: "Halo! Senang kamu tertarik 🙌 Komisi 10% per penjualan + bonus untuk video yang tembus 10rb views. Kami kirim sample gratis untuk konten pertama. Gas?", aiModel: "claude-opus-4-8", tokensUsed: 380, marketplaceSent: true },
    ]);

    // 10) AI REVIEW REPLIES (auto reply review) ------------------------------
    await tx.delete(reviewLogs).where(eq(reviewLogs.shopId, shopId));
    await tx.insert(reviewLogs).values([
      { shopId, orderId: orderByNo.get("DEMO-0012")?.id ?? null, marketplaceReviewId: "RV-1001", rating: 5, reviewText: "Kopinya wangi banget, packing rapi!", replyText: "Terima kasih banyak Kak atas reviewnya! 🙏 Senang kopinya cocok. Ditunggu order berikutnya ya!", aiGenerated: true, repliedAt: daysAgo(2) },
      { shopId, orderId: orderByNo.get("DEMO-0013")?.id ?? null, marketplaceReviewId: "RV-1002", rating: 3, reviewText: "Rasanya enak tapi pengiriman agak lama.", replyText: "Terima kasih masukannya, Kak. Mohon maaf untuk pengirimannya 🙏 Kami sedang tingkatkan proses agar lebih cepat. Boleh DM kami untuk kompensasi voucher ya.", aiGenerated: true, repliedAt: daysAgo(1) },
    ]);

    // 11) NOTIFICATIONS (email-channel events) -------------------------------
    await tx.delete(notifications).where(eq(notifications.userId, DEMO_USER_ID));
    await tx.insert(notifications).values([
      { userId: DEMO_USER_ID, type: "low_stock", title: "Stok bahan menipis", message: "Biji Kopi Arabika tersisa 3.2kg (min 5kg). Saatnya restock ke CV Sumber Tani.", channel: "email", sent: true, sentAt: hoursAgo(5) },
      { userId: DEMO_USER_ID, type: "daily_report", title: "Laporan harian AutoToko", message: "Hari ini: 4 order, revenue Rp 268.000. Detail di dashboard.", channel: "email", sent: true, sentAt: hoursAgo(2) },
      { userId: DEMO_USER_ID, type: "autopilot", title: "Autopilot menyetujui order", message: "3 order disetujui otomatis oleh AI, 1 ditahan untuk review.", channel: "in_app", sent: true, sentAt: hoursAgo(1) },
    ]);

    // 12) BILLING INVOICES (wallet top-up history) ---------------------------
    await tx.delete(platformInvoices).where(eq(platformInvoices.userId, DEMO_USER_ID));
    await tx.insert(platformInvoices).values([
      { userId: DEMO_USER_ID, type: "topup", amount: "500000", status: "paid", midtransOrderId: "DEMO-INV-1", paidAt: daysAgo(10) },
      { userId: DEMO_USER_ID, type: "setup_fee", amount: "99000", status: "paid", midtransOrderId: "DEMO-INV-0", paidAt: daysAgo(20) },
    ]);

    // 13) WALLET TRANSACTIONS (history) — only if none yet -------------------
    if (wallet) {
      const existingTx = await tx
        .select({ id: walletTransactions.id })
        .from(walletTransactions)
        .where(eq(walletTransactions.walletId, wallet.id))
        .limit(1);
      if (existingTx.length === 0) {
        let bal = 0;
        const after1 = bal + 500000;
        await tx.insert(walletTransactions).values({ walletId: wallet.id, type: "topup", amount: "500000", balanceBefore: String(bal), balanceAfter: String(after1), referenceId: "DEMO-INV-1", description: "Top-up saldo (demo)" });
        bal = after1;
        for (let i = 1; i <= 5; i++) {
          const after = bal - 200;
          await tx.insert(walletTransactions).values({ walletId: wallet.id, type: "deduct_transaction", amount: "200", balanceBefore: String(bal), balanceAfter: String(after), referenceId: `DEMO-${String(i).padStart(4, "0")}`, description: "Biaya per-transaksi (demo)" });
          bal = after;
        }
      }
    }

    const [orderCount] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(orders)
      .where(eq(orders.userId, DEMO_USER_ID));
    console.log(
      "✅ Demo seed complete:",
      JSON.stringify({ products: masters.length, orders: orderCount?.n ?? 0, affiliates: 3, chat_logs: 3, review_logs: 2, autopilot: 4, notifications: 3 }),
    );
  });

  await client.end();
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
