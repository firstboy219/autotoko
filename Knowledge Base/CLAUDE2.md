# AUTOTOKO — CLAUDE CODE PROJECT CONTEXT

> **Baca file ini terlebih dahulu sebelum menulis satu baris code pun.**
> File ini adalah sumber kebenaran tunggal (single source of truth) untuk semua keputusan arsitektur, business logic, dan constraint teknis proyek AutoToko.

---

## 🎯 APA ITU AUTOTOKO?

Platform SaaS multi-tenant yang membantu pemilik toko online Indonesia menjalankan operasional marketplace secara **autopilot** di Shopee dan TikTok Shop.

**User AutoToko** = pemilik toko online (seller) yang ingin mengelola Shopee + TikTok Shop dalam satu dashboard dengan banyak proses otomatis.

**Kamus istilah wajib dipahami:**
- `User` = pemilik toko online (member platform)
- `Toko` = akun seller di marketplace yang di-connect
- `Master Produk` = produk di DB AutoToko sebagai pusat kontrol
- `Postingan` = product listing di marketplace (1 master produk bisa punya BANYAK postingan, sengaja diduplikasi untuk marketing)
- `SKU` = penghubung antara master produk dan postingan. Jika SKU sama = produk yang sama
- `Admin` = pengelola platform AutoToko (bukan user)

---

## 🏗️ TECH STACK (JANGAN DIGANTI TANPA KONFIRMASI)

```
Backend  : Node.js + NestJS (TypeScript)
Frontend : Next.js 14 (App Router) + Shadcn/UI + Tailwind CSS + Zustand
DB Utama : PostgreSQL
Cache    : Redis
Queue    : Bull (Redis-based)
Storage  : MinIO (S3-compatible, self-hosted)
Otomasi  : n8n (self-hosted) — semua integrasi marketplace lewat sini
AI       : Claude API (Anthropic) — claude-sonnet-4-6
Payment  : Midtrans
Email    : SendGrid (SEMUA notifikasi keluar)
Infra    : Docker + Docker Compose → Nginx → Let's Encrypt
```

**Project Structure:**
```
autotoko/
├── apps/
│   ├── backend/          # NestJS API
│   ├── frontend/         # Next.js 14
│   └── mobile/           # React Native (Phase 2)
├── packages/
│   ├── database/         # Prisma schema + migrations
│   ├── shared/           # Types, constants, utils
│   └── ui/               # Shared UI components
├── infra/
│   ├── docker-compose.yml
│   ├── nginx/
│   └── n8n/              # n8n workflow exports
├── CLAUDE.md             # File ini
└── .env.example
```

---

## ⚠️ KEPUTUSAN ARSITEKTUR YANG SUDAH FINAL (JANGAN DIUBAH)

### 1. WhatsApp = RECEIVE ONLY
- AutoToko **TIDAK** pernah mengirim pesan WA keluar
- WA hanya dipakai untuk menerima pesan login dari user
- **SEMUA notifikasi keluar = Email via SendGrid**

### 2. Login via WhatsApp — Mekanisme Khusus
Bukan OTP biasa. Alurnya:
```
1. Frontend generate kode: "AutoToko-9823X7" → simpan di Redis TTL 5 menit
2. Frontend buka: wa.me/{WA_AUTOTOKO_NUMBER}?text=AutoToko-9823X7%20{callback_url}
3. User kirim pesan dari WA mereka ke nomor AutoToko
4. n8n webhook terima pesan masuk → ekstrak kode + nomor WA pengirim
5. n8n call: POST /auth/wa-login/verify { code, wa_number }
6. Backend validasi → buat/temukan user → issue JWT
7. Frontend polling GET /auth/wa-login/status?code=xxx tiap 2 detik
8. Status verified → simpan JWT → redirect ke /dashboard
```
- **Identitas user = nomor WA mereka** (no password)
- Kode format: `AutoToko-[6 char random UPPERCASE alphanumeric]`
- Redis key: `wa_login:{code}` TTL 300 detik

### 3. Shopee API = SELLER-SIDE ONLY
- Shopee Open Platform punya 447 API di 29 module — **semua untuk seller, ZERO untuk buyer**
- **TIDAK ADA** API untuk: place order, add to cart, checkout sebagai buyer
- **TIDAK ADA** API untuk withdrawal saldo seller
- Implikasi: "auto-restock via Shopee" = Email notif + deep link ke produk supplier (bukan call API)
- Shopee access_token expire **4 JAM** — refresh setiap 3 jam via n8n scheduler

### 4. TikTok Shop OAuth — Authorize URL
- Authorize URL format: `https://services.tiktokshop.com/open/authorize?service_id={SERVICE_ID}`
- Setelah seller authorize → redirect ke `/auth/tiktok/callback?code={auth_code}&state={state}`
- auth_code expire **30 menit**, single-use
- Tukar auth_code → access_token via: `GET https://auth.tiktok-shops.com/api/v2/token/get`
- TikTok access_token expire **7 hari**, refresh_token expire **1 tahun**
- Token endpoint untuk refresh: `https://auth.tiktok-shops.com/api/v2/token/refresh`

### 5. n8n = Semua Integrasi Eksternal
NestJS backend TIDAK langsung call Shopee/TikTok API. Semua integrasi marketplace lewat n8n:
- NestJS trigger n8n via webhook dengan shared secret (`X-Internal-Token`)
- n8n panggil NestJS internal API untuk operasi database
- Ini untuk isolasi, error handling, dan retry mechanism yang lebih baik

### 6. Multi-Tenant — Isolasi Data
- Setiap user punya `tenant_id` (= `user_id`)
- Semua query WAJIB include `WHERE user_id = $current_user_id`
- Row Level Security (RLS) PostgreSQL sebagai safety net
- Token marketplace di-enkripsi AES-256 sebelum disimpan di DB

---

## 📦 DATABASE SCHEMA (KEY TABLES)

Gunakan **Prisma ORM**. Berikut tabel-tabel inti:

```prisma
model User {
  id              String    @id @default(uuid())
  wa_number       String?   @unique  // null jika login via email
  email           String?   @unique  // null jika login via WA
  name            String
  plan            String    @default("freemium") // freemium|starter|pro
  is_active       Boolean   @default(true)
  created_at      DateTime  @default(now())
  shops           Shop[]
  master_products MasterProduct[]
  wallet          Wallet?
}

model WaLoginSession {
  code            String    @id  // "AutoToko-9823X7"
  wa_number       String?
  status          String    @default("pending") // pending|verified|expired
  callback_token  String    @unique
  created_at      DateTime  @default(now())
  verified_at     DateTime?
}

model Shop {
  id              String    @id @default(uuid())
  user_id         String
  marketplace     String    // shopee|tiktok
  shop_id         String    // ID dari marketplace
  shop_name       String
  access_token    String    // AES-256 encrypted
  refresh_token   String    // AES-256 encrypted
  token_expires_at DateTime
  is_active       Boolean   @default(true)
  user            User      @relation(fields: [user_id], references: [id])
  orders          Order[]
  postings        Posting[]
}

model MasterProduct {
  id              String    @id @default(uuid())
  user_id         String
  name            String
  sku             String    // PENGHUBUNG ke posting di marketplace
  base_price      Decimal
  stock           Int       @default(0)
  description     String?
  created_at      DateTime  @default(now())
  user            User      @relation(fields: [user_id], references: [id])
  postings        Posting[]
  bom_items       BomItem[]
  
  @@unique([user_id, sku])
}

model Posting {
  id              String    @id @default(uuid())
  user_id         String
  shop_id         String
  master_product_id String
  marketplace_item_id String  // item_id (Shopee) atau product_id (TikTok)
  title           String
  price           Decimal
  stock           Int       @default(0)
  is_active       Boolean   @default(true)
  last_synced_at  DateTime?
  shop            Shop      @relation(fields: [shop_id], references: [id])
  master_product  MasterProduct @relation(fields: [master_product_id], references: [id])
}

model Order {
  id              String    @id @default(uuid())
  user_id         String
  shop_id         String
  marketplace_order_id String
  buyer_name      String?
  buyer_phone     String?
  total_amount    Decimal
  status          String    // masuk|approved|produksi|packing|siap_kirim|dikirim|selesai|retur
  is_auto_approved Boolean  @default(false)
  raw_data        Json      // raw webhook payload
  created_at      DateTime  @default(now())
  shop            Shop      @relation(fields: [shop_id], references: [id])
  
  @@unique([shop_id, marketplace_order_id])
}

model BomItem {
  id                  String  @id @default(uuid())
  user_id             String
  master_product_id   String
  material_name       String
  qty_per_unit        Decimal  // qty bahan per 1 produk terjual
  unit                String   // pcs|meter|gram|kg|ml|lembar
  current_stock       Decimal  @default(0)
  min_stock           Decimal  // threshold trigger restock
  restock_method      String   @default("email_owner") // email_owner|wa_supplier|supplier_api
  supplier_shopee_url String?
  supplier_wa_number  String?
  supplier_api_url    String?
  supplier_api_key    String?  // encrypted
  restock_qty         Decimal?
  payment_method      String?  // QRIS|COD|transfer|shopeepay
  shipping_address    String?
  receiver_name       String?
  receiver_phone      String?
  notes_for_supplier  String?
  master_product      MasterProduct @relation(fields: [master_product_id], references: [id])
}

model Wallet {
  id              String    @id @default(uuid())
  user_id         String    @unique
  balance         Decimal   @default(0)
  user            User      @relation(fields: [user_id], references: [id])
  transactions    WalletTransaction[]
}

model WalletTransaction {
  id              String    @id @default(uuid())
  wallet_id       String
  type            String    // topup|subscription|per_order_fee|refund
  amount          Decimal
  description     String
  reference_id    String?
  created_at      DateTime  @default(now())
  wallet          Wallet    @relation(fields: [wallet_id], references: [id])
}

model AdminSetting {
  key             String    @id
  value           String    // encrypted untuk credentials
  description     String?
  updated_at      DateTime  @updatedAt
}
```

---

## 🔌 API ENDPOINTS (NESTJS BACKEND)

### Auth
```
POST /auth/wa-login/initiate    → generate kode WA, return {code, wa_url, callback_token}
GET  /auth/wa-login/status      → polling status login, return {status: pending|verified|expired}
POST /auth/wa-login/verify      → dipanggil oleh n8n saat WA masuk (internal)
POST /auth/email-login/request  → kirim OTP email via SendGrid
POST /auth/email-login/verify   → verifikasi OTP email
POST /auth/refresh              → refresh JWT token
POST /auth/logout
```

### OAuth Marketplace
```
GET  /auth/shopee/connect       → generate Shopee OAuth URL → redirect
GET  /auth/shopee/callback      → terima code dari Shopee → get access_token → simpan
GET  /auth/tiktok/connect       → generate TikTok authorize URL → redirect
GET  /auth/tiktok/callback      → terima code dari TikTok → get access_token → simpan
```

### Toko
```
GET    /shops                   → list semua toko user
POST   /shops                   → tambah toko (via OAuth above)
DELETE /shops/:id               → disconnect toko
GET    /shops/:id/balance       → lihat balance toko (view only)
PATCH  /shops/:id/settings      → update settings toko (threshold balance notif, dll)
```

### Master Produk
```
GET    /products                → list master produk + jumlah postingan per toko
POST   /products                → buat master produk baru
PATCH  /products/:id            → update master produk
DELETE /products/:id            → hapus master produk
GET    /products/:id/postings   → list semua postingan dari master produk ini
POST   /products/:id/postings   → tambah postingan ke marketplace tertentu
DELETE /products/:id/postings/:postingId  → hapus postingan
POST   /products/:id/postings/:postingId/duplicate  → duplikasi postingan
```

### Orders
```
GET    /orders                  → list orders (filter by status, shop, date)
GET    /orders/:id              → detail order
POST   /orders/:id/approve      → manual approve order
POST   /orders/:id/reject       → reject order
PATCH  /orders/:id/status       → update status (produksi, packing, dll)
```

### BOM
```
GET    /bom                     → list semua bahan baku user
POST   /bom                     → tambah bahan baku
PATCH  /bom/:id                 → update bahan (termasuk config restock)
DELETE /bom/:id                 → hapus bahan
GET    /bom/mappings            → list mapping produk × bahan
POST   /bom/mappings            → tambah mapping
DELETE /bom/mappings/:id        → hapus mapping
POST   /bom/:id/trigger-restock → manual trigger restock
```

### Wallet
```
GET    /wallet                  → lihat saldo dan riwayat transaksi
POST   /wallet/topup            → initiate top-up via Midtrans
POST   /wallet/topup/callback   → Midtrans callback (webhook)
```

### Webhooks (dari marketplace)
```
POST   /webhooks/shopee         → terima webhook Shopee
POST   /webhooks/tiktok         → terima webhook TikTok
```

### Admin (prefix /admin — IP whitelist)
```
GET    /admin/users             → list semua user
GET    /admin/settings          → lihat semua admin settings (credentials tersembunyi)
PATCH  /admin/settings          → update settings (Shopee keys, TikTok keys, dll)
GET    /admin/stats             → statistik platform
```

---

## 🔐 ENVIRONMENT VARIABLES (.env.example)

```env
# App
NODE_ENV=development
APP_URL=http://localhost:3000
ADMIN_URL=http://localhost:3001
BACKEND_URL=http://localhost:4000

# Database
DATABASE_URL=postgresql://autotoko:password@localhost:5432/autotoko_db
REDIS_URL=redis://:password@localhost:6379

# Auth
JWT_SECRET=ganti-dengan-random-string-64-char
JWT_EXPIRES_IN=1h
REFRESH_TOKEN_SECRET=ganti-dengan-random-string-64-char-berbeda
REFRESH_TOKEN_EXPIRES_IN=30d

# Encryption (untuk token marketplace)
ENCRYPTION_KEY=ganti-dengan-random-hex-64-char   # 32 bytes = 64 hex chars

# TikTok Shop
TIKTOK_APP_KEY=
TIKTOK_APP_SECRET=
TIKTOK_REDIRECT_URL=http://localhost:3000/auth/tiktok/callback

# TikTok Auth Endpoints
TIKTOK_AUTH_BASE_URL=https://services.tiktokshop.com
TIKTOK_TOKEN_URL=https://auth.tiktok-shops.com/api/v2/token/get
TIKTOK_REFRESH_TOKEN_URL=https://auth.tiktok-shops.com/api/v2/token/refresh
TIKTOK_API_BASE_URL=https://open-api.tiktokglobalshop.com

# Shopee
SHOPEE_PARTNER_ID=
SHOPEE_PARTNER_KEY=
SHOPEE_REDIRECT_URL=http://localhost:3000/auth/shopee/callback
SHOPEE_API_BASE_URL=https://partner.shopeemobile.com

# WhatsApp (RECEIVE ONLY — hanya untuk login mechanism, TIDAK kirim notif)
WA_AUTOTOKO_NUMBER=628xxxxxxxxx
WA_WEBHOOK_SECRET=

# SendGrid (SEMUA notifikasi keluar via email)
SENDGRID_API_KEY=
SENDGRID_FROM_EMAIL=noreply@autotoko.id
SENDGRID_FROM_NAME=AutoToko

# Anthropic (AI features)
ANTHROPIC_API_KEY=

# Midtrans
MIDTRANS_CLIENT_KEY=
MIDTRANS_SERVER_KEY=
MIDTRANS_IS_PRODUCTION=false

# n8n (internal communication)
N8N_BASE_URL=http://localhost:5678
N8N_INTERNAL_TOKEN=ganti-dengan-random-string  # shared secret NestJS ↔ n8n

# MinIO
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=
MINIO_SECRET_KEY=
MINIO_BUCKET=autotoko

# Revo Print
REVO_PRINT_API_URL=https://api.revoprint.id/v2
REVO_PRINT_API_KEY=

# Internal
INTERNAL_API_TOKEN=ganti-dengan-random-string  # untuk webhook keamanan internal
```

---

## 📋 PHASE 1 MVP — YANG HARUS DIBUILD SEKARANG

Fokus hanya pada ini, **jangan keluar dari scope**:

### ✅ Infrastructure & Setup
- [ ] `docker-compose.yml` dengan semua services (NestJS, NextJS, PostgreSQL, Redis, n8n, MinIO, Nginx)
- [ ] Prisma schema + seed data untuk development
- [ ] NestJS project structure dengan modules: auth, shops, products, orders, bom, wallet, webhooks, admin
- [ ] Next.js 14 dengan App Router + Shadcn/UI setup

### ✅ Authentication
- [ ] Login via WA (receive-only mechanism) — polling setiap 2 detik
- [ ] Login via Email OTP (SendGrid)
- [ ] JWT + Refresh Token
- [ ] Middleware auth guard untuk semua protected routes
- [ ] n8n workflow: `autotoko-wa-login-receiver`

### ✅ Admin CMS
- [ ] Halaman admin untuk manage `admin_settings` (Shopee keys, TikTok keys, dll)
- [ ] Credentials disimpan encrypted AES-256 di DB
- [ ] IP whitelist untuk admin routes

### ✅ Connect Toko (OAuth)
- [ ] Shopee OAuth flow: `/auth/shopee/connect` → redirect → callback → simpan token
- [ ] TikTok Shop OAuth flow: generate authorize URL → redirect → callback → simpan token
- [ ] Token disimpan encrypted di DB
- [ ] n8n workflow: `shopee-token-refresh` (cron setiap 3 jam — Shopee expire 4 jam!)
- [ ] n8n workflow: `tiktok-token-refresh` (cron harian — TikTok expire 7 hari)

### ✅ Webhook Receiver
- [ ] `POST /webhooks/shopee` — verifikasi signature Shopee + forward ke n8n
- [ ] `POST /webhooks/tiktok` — verifikasi signature TikTok + forward ke n8n
- [ ] Simpan raw webhook ke tabel `webhook_events` untuk audit

### ✅ Order Management
- [ ] Sync order dari Shopee & TikTok (via n8n pull + webhook push)
- [ ] API: GET /orders dengan filter (status, shop, date range, search)
- [ ] API: PATCH /orders/:id/status
- [ ] Kanban board UI (Next.js) dengan 9 kolom status
- [ ] n8n workflow: `auto-approve-order` (validasi stok BOM → approve → update status)

### ✅ Master Produk
- [ ] CRUD master produk
- [ ] Link postingan via SKU matching
- [ ] Tampilkan toko-toko yang terhubung ke tiap produk
- [ ] Duplicate postingan antar toko

### ✅ Dashboard
- [ ] Stats: total order hari ini, revenue, auto-processed %, postingan aktif
- [ ] Revenue chart (7 hari)
- [ ] Recent orders
- [ ] Alert cards (stok kritis, wallet rendah, token expire)
- [ ] WebSocket untuk real-time update

### ✅ Wallet & Billing
- [ ] Tabel wallet + transaksi
- [ ] Top-up via Midtrans (payment gateway)
- [ ] Deduct per-order fee (Rp 200/order) saat order approved
- [ ] Deduct subscription fee (Rp 299.000/bulan) di awal bulan
- [ ] Alert email via SendGrid saat saldo < 3 hari runway

### ✅ BOM Basic
- [ ] CRUD bahan baku
- [ ] Mapping produk × bahan
- [ ] Auto-deduct stok bahan saat order masuk (berdasarkan BOM mapping)
- [ ] Alert email saat stok bahan < minimum threshold

### ✅ Email Notifications (SendGrid)
- [ ] Template: OTP login, welcome, daily-report, low-wallet-alert, restock-alert, token-expire-alert, product-suspended, topup-confirmation

---

## 🔑 ATURAN CODING WAJIB

### Security
```typescript
// WAJIB: Setiap query harus include user_id
// ❌ SALAH:
const orders = await this.orderRepo.findAll();

// ✅ BENAR:
const orders = await this.orderRepo.findAll({ where: { user_id: currentUser.id } });

// WAJIB: Token marketplace selalu encrypted
// Simpan:
const encrypted = this.cryptoService.encrypt(access_token); // AES-256
// Baca:
const token = this.cryptoService.decrypt(shop.access_token);
```

### n8n Communication
```typescript
// NestJS memanggil n8n workflow via webhook
await this.n8nService.trigger('auto-approve-order', {
  order_id: order.id,
  user_id: order.user_id,
  shop_id: order.shop_id,
});

// n8n memanggil NestJS internal API
// Semua internal endpoints dilindungi header: X-Internal-Token
```

### Shopee API Signature
```typescript
// WAJIB untuk semua Shopee API call
const signature = (partner_id, api_path, timestamp, access_token, shop_id) => {
  const base = `${partner_id}${api_path}${timestamp}${access_token}${shop_id}`;
  return crypto.createHmac('sha256', partner_key).update(base).digest('hex');
};
```

### TikTok API Signature
```typescript
// Sort params alphabetically, then HMAC-SHA256
const tiktokSign = (params, app_secret) => {
  const sorted = Object.keys(params).sort().map(k => `${k}${params[k]}`).join('');
  const base = `${app_secret}${sorted}${app_secret}`;
  return crypto.createHmac('sha256', app_secret).update(base).digest('hex');
};
```

### Error Handling
```typescript
// Semua marketplace API errors harus di-handle gracefully
// Jangan expose raw error ke frontend
// Log lengkap di server, response singkat ke client
```

### TypeScript Strict
- Aktifkan `strict: true` di tsconfig
- Tidak ada `any` kecuali untuk raw webhook payload
- Semua response dari marketplace API di-type dengan interface

---

## 📐 FOLDER STRUCTURE DETAIL (BACKEND)

```
apps/backend/src/
├── main.ts
├── app.module.ts
├── config/                     # ConfigModule, env validation
├── common/
│   ├── decorators/             # @CurrentUser, @Roles, dll
│   ├── guards/                 # JwtAuthGuard, InternalTokenGuard
│   ├── interceptors/           # LoggingInterceptor, TransformInterceptor
│   ├── filters/                # AllExceptionsFilter
│   └── utils/                  # crypto.util.ts, shopee-sign.util.ts, tiktok-sign.util.ts
├── modules/
│   ├── auth/                   # WA login, Email OTP, JWT, refresh token
│   ├── users/                  # User CRUD
│   ├── shops/                  # Connect toko, token management
│   ├── products/               # Master produk + postingan
│   ├── orders/                 # Order management
│   ├── bom/                    # Bill of Materials
│   ├── wallet/                 # Billing, top-up, deduction
│   ├── webhooks/               # Shopee & TikTok webhook receiver
│   ├── n8n/                    # n8n trigger service
│   ├── email/                  # SendGrid email service
│   ├── crypto/                 # AES-256 encrypt/decrypt
│   ├── redis/                  # Redis service
│   └── admin/                  # Admin panel APIs
└── prisma/
    ├── schema.prisma
    ├── migrations/
    └── seed.ts
```

---

## 📐 FOLDER STRUCTURE DETAIL (FRONTEND)

```
apps/frontend/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                # Landing / redirect
│   ├── (auth)/
│   │   ├── login/page.tsx      # Halaman login (WA + Email)
│   │   └── callback/           # OAuth callbacks
│   ├── (dashboard)/
│   │   ├── layout.tsx          # Sidebar + topbar
│   │   ├── dashboard/page.tsx
│   │   ├── toko/page.tsx
│   │   ├── produk/page.tsx
│   │   ├── orders/page.tsx     # Kanban board
│   │   ├── bom/page.tsx
│   │   ├── print-label/page.tsx
│   │   ├── flows/
│   │   │   ├── fulfillment/page.tsx
│   │   │   ├── restock/page.tsx
│   │   │   ├── after-sales/page.tsx
│   │   │   └── marketing/page.tsx
│   │   ├── event/page.tsx
│   │   ├── affiliator/page.tsx
│   │   ├── konten/page.tsx
│   │   ├── iklan/page.tsx
│   │   ├── evaluasi/page.tsx
│   │   ├── laporan/page.tsx
│   │   ├── wallet/page.tsx
│   │   └── settings/page.tsx
│   └── (admin)/
│       └── admin/              # Admin panel (separate layout)
├── components/
│   ├── ui/                     # Shadcn components
│   ├── layout/                 # Sidebar, Topbar, etc
│   ├── kanban/                 # Order kanban board
│   ├── flow/                   # Flow visualization cards
│   └── charts/                 # Dashboard charts
├── lib/
│   ├── api.ts                  # Axios instance + interceptors
│   ├── auth.ts                 # Auth utilities
│   └── utils.ts
└── store/
    ├── auth.store.ts           # Zustand auth state
    ├── order.store.ts
    └── ui.store.ts
```

---

## 🔗 INTEGRASI KUNCI

### Shopee OAuth Flow
```
1. GET /auth/shopee/connect
   → Generate: timestamp, signature, url
   → Redirect ke: https://partner.shopeemobile.com/api/v2/shop/auth_partner
     ?partner_id={ID}&timestamp={ts}&sign={sig}&redirect={SHOPEE_REDIRECT_URL}

2. GET /auth/shopee/callback?code={code}&shop_id={shop_id}
   → POST https://partner.shopeemobile.com/api/v2/auth/token/get
     body: { code, shop_id, partner_id }
   → Simpan access_token (4 jam) + refresh_token (30 hari) encrypted ke DB

3. n8n cron setiap 3 jam:
   → POST https://partner.shopeemobile.com/api/v2/auth/access_token/get
     body: { refresh_token, shop_id, partner_id }
   → Update access_token di DB
```

### TikTok Shop OAuth Flow
```
1. GET /auth/tiktok/connect
   → Redirect ke: https://services.tiktokshop.com/open/authorize
     ?service_id={SERVICE_ID}&state={random_state}

2. GET /auth/tiktok/callback?code={auth_code}&state={state}
   → GET https://auth.tiktok-shops.com/api/v2/token/get
     ?app_key={KEY}&app_secret={SECRET}&auth_code={auth_code}&grant_type=authorized_code
   → Simpan access_token (7 hari) + refresh_token (1 tahun) encrypted ke DB
   → Simpan open_id, shop_id, shop_cipher dari response

3. n8n cron harian:
   → GET https://auth.tiktok-shops.com/api/v2/token/refresh
     ?app_key={KEY}&app_secret={SECRET}&refresh_token={TOKEN}&grant_type=refresh_token
   → Update access_token di DB
```

### Shopee Webhook Verification
```typescript
// Verifikasi signature webhook Shopee
const verifyShopeeWebhook = (payload: string, signature: string): boolean => {
  const base = `${SHOPEE_PARTNER_KEY}|${payload}`;
  const expected = crypto.createHmac('sha256', SHOPEE_PARTNER_KEY)
    .update(base).digest('hex');
  return expected === signature;
};
// Signature ada di header: Authorization
```

### Shopee API Call Pattern
```typescript
// Setiap API call ke Shopee wajib include signature
const shopeeApiCall = async (path: string, shop: Shop, body?: object) => {
  const timestamp = Math.floor(Date.now() / 1000);
  const accessToken = decrypt(shop.access_token);
  const baseStr = `${PARTNER_ID}${path}${timestamp}${accessToken}${shop.shop_id}`;
  const sign = hmacSha256(baseStr, PARTNER_KEY);

  return axios.post(`${SHOPEE_BASE_URL}${path}`, body, {
    params: { partner_id: PARTNER_ID, timestamp, access_token: accessToken, shop_id: shop.shop_id, sign }
  });
};
```

### TikTok Shop API Call Pattern
```typescript
// Header-based auth untuk TikTok
const tiktokApiCall = async (path: string, shop: Shop, body?: object) => {
  const timestamp = Math.floor(Date.now() / 1000);
  const accessToken = decrypt(shop.access_token);
  // sort params + sign
  const headers = {
    'x-tts-access-token': accessToken,
    'Content-Type': 'application/json',
  };
  return axios.post(`${TIKTOK_API_BASE}${path}`, body, {
    params: { app_key: APP_KEY, timestamp, shop_id: shop.shop_id, shop_cipher: shop.shop_cipher, sign },
    headers
  });
};
```

---

## 🐳 DOCKER COMPOSE (SERVICES YANG DIPERLUKAN)

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: autotoko_db
      POSTGRES_USER: autotoko
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD}

  n8n:
    image: n8nio/n8n:latest
    environment:
      N8N_BASIC_AUTH_ACTIVE: true
      N8N_BASIC_AUTH_USER: admin
      N8N_BASIC_AUTH_PASSWORD: ${N8N_PASSWORD}
      DB_TYPE: postgresdb
      DB_POSTGRESDB_HOST: postgres
    depends_on: [postgres, redis]

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"

  backend:
    build: ./apps/backend
    depends_on: [postgres, redis, n8n]

  frontend:
    build: ./apps/frontend
    depends_on: [backend]

  nginx:
    image: nginx:alpine
    volumes:
      - ./infra/nginx/conf.d:/etc/nginx/conf.d
    ports:
      - "80:80"
      - "443:443"
```

---

## 🚀 CARA MEMULAI (URUTAN TASK)

1. **Buat project structure** sesuai folder structure di atas
2. **Setup docker-compose.yml** dengan semua services
3. **Setup Prisma schema** dengan tabel-tabel di atas, jalankan migration
4. **NestJS: Module Auth** — WA login mechanism + Email OTP
5. **NestJS: Module Shops** — OAuth Shopee + TikTok
6. **NestJS: Module Webhooks** — receiver + signature verification
7. **n8n workflows** — token refresh scheduler + WA login receiver
8. **NestJS: Module Products** — master produk CRUD + posting management
9. **NestJS: Module Orders** — order sync + status management
10. **NestJS: Module Wallet** — billing + Midtrans integration
11. **Next.js: Auth pages** — login WA + Email OTP
12. **Next.js: Dashboard** — dengan WebSocket real-time
13. **Next.js: Orders Kanban** — 9 kolom status
14. **Next.js: Master Produk** — tabel + posting management
15. **Next.js: semua halaman lain** sesuai sidebar

---

## ❌ JANGAN LAKUKAN INI

- ❌ Jangan kirim pesan WA dari AutoToko ke user (WA = receive only)
- ❌ Jangan simpan token marketplace tanpa enkripsi
- ❌ Jangan expose user data antar tenant (selalu filter by user_id)
- ❌ Jangan call Shopee/TikTok API langsung dari NestJS — pakai n8n
- ❌ Jangan buat Shopee buyer API (tidak ada, sudah diverifikasi 447 endpoints)
- ❌ Jangan tambah fitur Phase 2/3 sebelum Phase 1 selesai
- ❌ Jangan hardcode credentials di source code — semua di .env

---

## ✅ CHECKLIST SEBELUM COMMIT

- [ ] Semua query include `user_id` filter
- [ ] Token marketplace encrypted sebelum disimpan
- [ ] Environment variables tidak hardcoded
- [ ] Error handling di semua marketplace API calls
- [ ] Rate limiting di endpoint publik
- [ ] TypeScript strict — tidak ada `any` yang tidak diperlukan
- [ ] Prisma migration dijalankan
- [ ] Tests untuk critical business logic (auth, billing, webhook verification)

---

*Dokumen ini dibuat berdasarkan PRD lengkap AutoToko v1.0 — Juni 2026*
*Untuk detail lebih lengkap (seluruh Shopee API 447 endpoint, TikTok API docs, BOM spec, dll) lihat: AUTOTOKO_PRD_COMPLETE.md*
