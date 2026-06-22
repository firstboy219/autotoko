# AutoToko — Gap Analysis: PRD vs Implementasi

> Audit date: 19 Juni 2026 | Berdasarkan pembacaan **seluruh source code** + PRD lengkap (2538 baris)

---

## Estimasi Keseluruhan: **~40-45% dari scope PRD**

```
Auth            ████████░░  80%
Shop OAuth      █████████░  90%
Billing/Wallet  ████████░░  85%
Admin CMS       ███████░░░  75%
Products        ███████░░░  70%
Orders          █████░░░░░  50%
Marketplace API ███░░░░░░░  30%
Security        ███░░░░░░░  30%
Analytics       ░░░░░░░░░░   5%
AI Features     ░░░░░░░░░░   0%
Notifications   ░░░░░░░░░░   0%
Marketing       ░░░░░░░░░░   0%
BOM/Restock     ░░░░░░░░░░   0%
Mobile App      ░░░░░░░░░░   0%
```

---

## ✅ Yang Sudah Dikerjakan (Detail)

### 1. Auth (PRD §3) — 80%

| Fitur | Status | File |
|---|---|---|
| WA Login (receive-only flow) | ✅ Done | [auth.service.ts](file:///Users/mm/projects/autotoko/apps/backend/src/modules/auth/auth.service.ts) |
| Email OTP (generate + verify) | ✅ Done | [auth.service.ts](file:///Users/mm/projects/autotoko/apps/backend/src/modules/auth/auth.service.ts) |
| Dev Login (user/user) | ✅ Done | [auth.service.ts](file:///Users/mm/projects/autotoko/apps/backend/src/modules/auth/auth.service.ts) |
| JWT Guard + `@AdminOnly()` | ✅ Done | [jwt-auth.guard.ts](file:///Users/mm/projects/autotoko/apps/backend/src/modules/auth/jwt-auth.guard.ts) |
| Login UI (WA + Email + Dev tabs) | ✅ Done | [Login.tsx](file:///Users/mm/projects/autotoko/apps/web/src/pages/Login.tsx) |
| DB: `users`, `wa_login_sessions`, `email_otp_sessions` | ✅ Done | [users.ts](file:///Users/mm/projects/autotoko/apps/backend/src/database/schema/users.ts) |
| **Email actually SENDING (nodemailer/Gmail)** | ❌ Missing | Service exists tapi tidak ada kode kirim email |
| **Redis session cache (PRD: TTL 5m)** | ❌ Missing | Hanya pakai DB |

### 2. Shop Connection / OAuth (PRD §5) — 90%

| Fitur | Status | File |
|---|---|---|
| TikTok OAuth flow | ✅ Done | [tiktok.adapter.ts](file:///Users/mm/projects/autotoko/apps/backend/src/marketplace/adapters/tiktok.adapter.ts) |
| Shopee OAuth flow | ✅ Done | [shopee.adapter.ts](file:///Users/mm/projects/autotoko/apps/backend/src/marketplace/adapters/shopee.adapter.ts) |
| Token refresh cron (hourly) | ✅ Done | [token-refresh.task.ts](file:///Users/mm/projects/autotoko/apps/backend/src/modules/shops/token-refresh.task.ts) |
| Encrypted token storage (AES-256-GCM) | ✅ Done | [crypto.service.ts](file:///Users/mm/projects/autotoko/apps/backend/src/common/crypto/crypto.service.ts) |
| TikTok + Shopee request signers | ✅ Done | [tiktok.signer.ts](file:///Users/mm/projects/autotoko/apps/backend/src/marketplace/signing/tiktok.signer.ts), [shopee.signer.ts](file:///Users/mm/projects/autotoko/apps/backend/src/marketplace/signing/shopee.signer.ts) |
| Marketplace factory | ✅ Done | [marketplace.service.ts](file:///Users/mm/projects/autotoko/apps/backend/src/marketplace/marketplace.service.ts) |
| Frontend: connect buttons + shop cards | ✅ Done | [Toko.tsx](file:///Users/mm/projects/autotoko/apps/web/src/pages/Toko.tsx) |
| **Shop disconnect/deactivate** | ❌ Missing | |

### 3. Products (PRD §6) — 70%

| Fitur | Status | File |
|---|---|---|
| Master Product CRUD (create/list/get/update/delete) | ✅ Done | [products.service.ts](file:///Users/mm/projects/autotoko/apps/backend/src/modules/products/products.service.ts) |
| Posting CRUD (create/delete) | ✅ Done | [products.controller.ts](file:///Users/mm/projects/autotoko/apps/backend/src/modules/products/products.controller.ts) |
| SKU auto-matching (orphan linking) | ✅ Done | [products.service.ts](file:///Users/mm/projects/autotoko/apps/backend/src/modules/products/products.service.ts) |
| Frontend: list + search + detail + posting mgmt | ✅ Done | [Produk.tsx](file:///Users/mm/projects/autotoko/apps/web/src/pages/Produk.tsx) |
| DB: `master_products`, `product_postings`, `master_product_variants`, `bom_items` | ✅ Done | [products.ts](file:///Users/mm/projects/autotoko/apps/backend/src/database/schema/products.ts) |
| **Sync products FROM marketplace API** | ❌ Missing | |
| **Push stock updates TO marketplace** | ❌ Missing | |
| **Variant management** | ❌ Missing | Schema ada, service belum |
| **BOM/restock management** | ❌ Missing | Schema ada, service belum |
| **Image upload** | ❌ Missing | |
| **Health Score calculation** | ❌ Missing | |

### 4. Orders (PRD §8) — 50%

| Fitur | Status | File |
|---|---|---|
| Order list + detail + summary (read-only) | ✅ Done | [orders.service.ts](file:///Users/mm/projects/autotoko/apps/backend/src/modules/orders/orders.service.ts) |
| Webhook ingestion (TikTok + Shopee) | ✅ Done | [webhooks.service.ts](file:///Users/mm/projects/autotoko/apps/backend/src/modules/webhooks/webhooks.service.ts) |
| Per-transaction fee on new order | ✅ Done | [webhooks.service.ts](file:///Users/mm/projects/autotoko/apps/backend/src/modules/webhooks/webhooks.service.ts) |
| Idempotent webhook event tracking | ✅ Done | [webhooks.service.ts](file:///Users/mm/projects/autotoko/apps/backend/src/modules/webhooks/webhooks.service.ts) |
| Frontend: orders + filters + pagination + detail modal | ✅ Done | [Orders.tsx](file:///Users/mm/projects/autotoko/apps/web/src/pages/Orders.tsx) |
| **Order approve/cancel actions** | ❌ Missing | |
| **AWB generation / shipping label** | ❌ Missing | |
| **Fulfillment flow (ship, tracking)** | ❌ Missing | |
| **Native webhook signature verification** | ❌ Missing | Hanya query param secret |

### 5. Billing/Wallet (PRD §4) — 85%

| Fitur | Status | File |
|---|---|---|
| Wallet balance + transactions | ✅ Done | [wallet.service.ts](file:///Users/mm/projects/autotoko/apps/backend/src/modules/billing/wallet.service.ts) |
| Top-up via Midtrans Snap | ✅ Done | [midtrans.service.ts](file:///Users/mm/projects/autotoko/apps/backend/src/modules/billing/midtrans.service.ts) |
| Midtrans webhook (SHA512 sig verify) | ✅ Done | [midtrans.service.ts](file:///Users/mm/projects/autotoko/apps/backend/src/modules/billing/midtrans.service.ts) |
| Atomic deduct (row-lock) | ✅ Done | [wallet.service.ts](file:///Users/mm/projects/autotoko/apps/backend/src/modules/billing/wallet.service.ts) |
| Frontend: balance card + top-up + history | ✅ Done | [Wallet.tsx](file:///Users/mm/projects/autotoko/apps/web/src/pages/Wallet.tsx) |
| **Setup fee on first shop connection** | ❌ Missing | |
| **Monthly subscription billing (cron)** | ❌ Missing | |
| **Low-balance notifications** | ❌ Missing | |

### 6. Admin CMS (PRD §7) — 75%

| Fitur | Status | File |
|---|---|---|
| Settings CRUD (encrypted key-value) | ✅ Done | [admin-settings.service.ts](file:///Users/mm/projects/autotoko/apps/backend/src/modules/admin-settings/admin-settings.service.ts) |
| Settings UI (TikTok, Shopee, Midtrans, AI, etc) | ✅ Done | [Settings.tsx](file:///Users/mm/projects/autotoko/apps/admin/src/pages/Settings.tsx) |
| Pricing plans (freemium/starter/pro) | ✅ Done | [pricing.service.ts](file:///Users/mm/projects/autotoko/apps/backend/src/modules/admin-settings/pricing.service.ts) |
| Pricing UI | ✅ Done | [Pricing.tsx](file:///Users/mm/projects/autotoko/apps/admin/src/pages/Pricing.tsx) |
| AI config resolver | ✅ Done | [admin-settings.service.ts](file:///Users/mm/projects/autotoko/apps/backend/src/modules/admin-settings/admin-settings.service.ts) |
| **User management (list/suspend/activate)** | ❌ Missing | |
| **Admin analytics dashboard** | ❌ Missing | |
| **Branding/white-label UI** | ❌ Missing | Types ada di shared |
| **Notification templates** | ❌ Missing | |

---

## ❌ Yang Belum Dikerjakan Sama Sekali

### 7. Marketplace Adapter (Business Operations) — 30%

Interface `MarketplaceAdapter` sudah **fully defined** di [marketplace.ts](file:///Users/mm/projects/autotoko/packages/shared/src/marketplace.ts) tapi hanya auth port yang terimplementasi:

| Method | TikTok | Shopee |
|---|---|---|
| `getAuthUrl()` | ✅ | ✅ |
| `exchangeToken()` | ✅ | ✅ |
| `refreshToken()` | ✅ | ✅ |
| `getOrders()` | ❌ | ❌ |
| `approveOrder()` | ❌ | ❌ |
| `cancelOrder()` | ❌ | ❌ |
| `getProducts()` | ❌ | ❌ |
| `createProduct()` | ❌ | ❌ |
| `updateProduct()` | ❌ | ❌ |
| `updateStock()` | ❌ | ❌ |
| `shipOrder()` | ❌ | ❌ |
| `getTrackingNumber()` | ❌ | ❌ |
| `sendMessage()` | ❌ | ❌ |
| `getSettlements()` | ❌ | ❌ |

### 8. AI Features (PRD §8.2, §8.10, §8.12) — 0%
- ❌ AI Chat Autopilot (auto-reply buyer messages)
- ❌ AI Review Auto-Reply
- ❌ AI Trend Analysis
- ❌ AI Product Description Generation
- ❌ No AI module/service exists at all
- DB schema ready: `chat_logs`, `review_logs` tables exist

### 9. Notifications (PRD §3.3) — 0%
- ❌ Email sending (SendGrid/Gmail SMTP integration)
- ❌ In-app notifications
- ❌ Notification preferences
- DB schema ready: `notifications` table exists

### 10. Marketing / Affiliates (PRD §8.12) — 0%
- ❌ Affiliate management
- ❌ Affiliate invitation flow
- ❌ Commission tracking
- DB schema ready: `affiliates` table exists

### 11. BOM / Restock Automation (PRD §8.6) — 0%
- ❌ Bill of Materials management
- ❌ Stock threshold alerts
- ❌ Auto-restock triggers
- DB schema ready: `bom_items` table exists

### 12. Analytics (PRD §8 various) — 5%
- ✅ Basic order summary (total, revenue, fee)
- ❌ Profit calculator
- ❌ Revenue per shop/product
- ❌ Conversion rate tracking
- ❌ Trend analysis dashboard

### 13. n8n Workflows (PRD §12) — 10%
- ✅ WA login receiver (documented + patched)
- ❌ Order processing workflows
- ❌ Product sync workflows
- ❌ Stock sync workflows
- ❌ Chat automation workflows
- ❌ Notification workflows

### 14. Mobile App (PRD §13) — 0%
- ❌ React Native app (not started)

### 15. Security (PRD §14) — 30%
- ✅ JWT auth + guards
- ✅ AES-256-GCM encryption
- ⚠️ DEV_LOGIN masih enabled di server
- ❌ Rate limiting (no middleware)
- ❌ Postgres RLS (multi-tenant isolation)
- ❌ CORS proper config (hardcoded `origin: true`)
- ❌ Request logging/audit trail
- ❌ Webhook signature verification (native marketplace)

### 16. Infrastructure — 40%

| PRD Requirement | Actual Status |
|---|---|
| NestJS + Fastify | ✅ Done |
| PostgreSQL + Drizzle | ✅ Done |
| Nginx + Let's Encrypt | ✅ Done |
| pm2 process management | ✅ Done |
| Docker Compose (dev) | ✅ Done |
| Redis | ❌ Not deployed |
| BullMQ queues | ❌ Not implemented |
| MinIO/S3 file storage | ❌ Not implemented |
| WebSocket (real-time) | ❌ Not implemented |
| Grafana + Prometheus | ❌ Not implemented |
| Winston + Loki logging | ❌ Not implemented |
| GitHub Actions CI/CD | ❌ Not implemented |

---

## 📊 Database Schema vs Service Layer

Schema yang ada **tapi belum punya service code**:

| Table | Schema | Service | Controller | Frontend |
|---|---|---|---|---|
| `affiliates` | ✅ | ❌ | ❌ | ❌ |
| `chat_logs` | ✅ | ❌ | ❌ | ❌ |
| `review_logs` | ✅ | ❌ | ❌ | ❌ |
| `notifications` | ✅ | ❌ | ❌ | ❌ |
| `bom_items` | ✅ | ❌ | ❌ | ❌ |
| `master_product_variants` | ✅ | ❌ | ❌ | ❌ |

---

## 🔧 Tech Stack Deviations dari PRD

| PRD Bilang | Yang Dipakai | Alasan |
|---|---|---|
| Next.js 14 (SSR) | Vite + React SPA | User pilih SPA (lebih ringan) |
| Shadcn/UI | Plain Tailwind | Tidak pakai component library |
| Express | Fastify | User request |
| Recharts | CSS-only bars | Minimal dependency |
| Redis | Tidak dipakai | Belum deploy |
| Bull queues | Tidak dipakai | Belum implement |
| Docker Swarm | pm2 bare metal | Simpler for single server |

---

## 🌐 Frontend Page Inventory

### Web App (`apps/web`)

| Page | Route | Status |
|---|---|---|
| Login | `/login` | ✅ WA + Email + Dev tabs |
| Dashboard | `/` | ✅ Stats + chart + recent orders |
| Toko Saya | `/toko` | ✅ Shop list + connect |
| Master Produk | `/produk` | ✅ Full CRUD + postings |
| Orders | `/orders` | ✅ List + filters + detail |
| Wallet | `/wallet` | ✅ Balance + top-up + history |
| Analytics | `/analytics` | ❌ Missing |
| Chat | `/chat` | ❌ Missing |
| Affiliates | `/affiliates` | ❌ Missing |
| Settings/Profile | `/settings` | ❌ Missing |
| BOM | `/bom` | ❌ Missing |

### Admin CMS (`apps/admin`)

| Page | Route | Status |
|---|---|---|
| Login | `/login` | ✅ |
| Settings | `/settings` | ✅ |
| Pricing | `/pricing` | ✅ |
| Users | `/users` | ❌ Missing |
| Dashboard | `/dashboard` | ❌ Missing |
| Branding | `/branding` | ❌ Missing |

---

## ⚠️ Uncommitted Work (8 files)

Dari session Claude Code sebelumnya yang terputus, ada **8 file belum di-commit**:

**Modified:** `App.tsx` (admin), `vite.config.ts` (admin), `admin-settings.module.ts`
**Untracked:** `Layout.tsx`, `api.ts`, `auth.ts`, `useFetch.ts`, `Login.tsx`, `Settings.tsx`, `Pricing.tsx` (admin), `pricing.service.ts`, `pricing.controller.ts` (backend)

> [!WARNING]
> File-file ini berisi Admin CMS + Pricing yang sudah code-complete tapi belum di-commit ke git.
