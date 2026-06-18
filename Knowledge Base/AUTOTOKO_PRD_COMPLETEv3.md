# AUTOTOKO
## Product Requirements Document (PRD) + Technical Knowledge Base
### Untuk Claude Code — Panduan Lengkap Membangun SaaS

**Versi:** 1.0  
**Tanggal:** Juni 2026  
**Status:** Ready for Development

---

## BAGIAN 1: DEFINISI PRODUK & KONSEP INTI

### 1.1 Apa itu AutoToko?
Platform SaaS yang membantu **pemilik toko online** menjalankan operasional bisnis mereka secara **autopilot** di berbagai marketplace sekaligus.

### 1.2 Kamus Istilah (WAJIB DIPAHAMI)

| Istilah | Definisi |
|---|---|
| **User** | Pemilik toko online yang menjadi member platform ini |
| **Toko** | Akun seller di marketplace (Shopee/TikTok Shop) yang di-connect ke platform |
| **Postingan** | Produk listing yang ada di marketplace. Satu produk yang sama bisa punya BANYAK postingan (sengaja di-duplicate untuk strategi marketing) |
| **Master Produk** | Produk yang ada di database SaaS ini. Berfungsi sebagai PUSAT KONTROL yang menghubungkan semua postingan di berbagai marketplace |
| **SKU** | Nomor unik produk. Menjadi PENGHUBUNG antara master produk dan postingan di marketplace. Jika SKU sama = produk yang sama |
| **Balance/Wallet** | Saldo yang dimiliki user di platform ini, digunakan untuk membayar semua biaya (setup, subscription, per-transaksi) |
| **Admin** | Pengelola platform AutoToko |

### 1.3 Relasi Master Produk ↔ Postingan
```
Master Produk "Baju Batik Motif Parang" (SKU: BBP-001)
    │
    ├── TikTok Shop - Toko A: 7 postingan (listing_id berbeda, SKU: BBP-001)
    │   ├── Postingan 1 (Harga normal)
    │   ├── Postingan 2 (Bundle 2 pcs)
    │   ├── Postingan 3 (Free ongkir campaign)
    │   └── ... dst
    │
    └── Shopee - Toko B: 3 postingan (item_id berbeda, SKU: BBP-001)
        ├── Postingan 1 (Harga normal)
        ├── Postingan 2 (Flash sale)
        └── Postingan 3 (Bundling)
```

**Logic pencocokan:** Ketika sistem menemukan produk di marketplace dengan SKU yang sama dengan master produk → otomatis terhubung dan terhitung dalam dashboard master.

---

## BAGIAN 2: TECH STACK & ARSITEKTUR SISTEM

### 2.1 Tech Stack yang Digunakan

#### Frontend
| Layer | Teknologi |
|---|---|
| Web App | **Next.js 14** (React framework, SSR + App Router) |
| UI Component | **Shadcn/UI + Tailwind CSS** |
| State Management | **Zustand** |
| Charts/Analytics | **Recharts** |
| Mobile App | **React Native** (untuk iOS & Android) — khusus fitur monitor & trigger cepat |

#### Backend
| Layer | Teknologi |
|---|---|
| Runtime | **Node.js + NestJS** (TypeScript, modular, enterprise-grade) |
| API Protocol | **REST API + WebSocket** (untuk real-time dashboard) |
| Auth | **JWT + Refresh Token** |
| Auth Login WA | **WhatsApp (RECEIVE ONLY)** — n8n webhook terima pesan login dari user |
| Notifikasi Outgoing | **SendGrid (Email)** — SEMUA notif keluar via email, BUKAN WA |

#### Database
| Fungsi | Teknologi |
|---|---|
| Database Utama | **PostgreSQL** (relational, multi-tenant) |
| Cache | **Redis** (token cache, rate limit queue, session) |
| Queue System | **Bull (Redis-based)** untuk job queue & webhook processing |
| File Storage | **MinIO** (self-hosted S3-compatible) atau AWS S3 |
| Search | **PostgreSQL Full-text Search** (cukup untuk fase awal) |

#### Automation & Integration
| Fungsi | Teknologi |
|---|---|
| Workflow Automation | **n8n** (self-hosted) — SEMUA logika integrasi dengan marketplace |
| AI Chat | **Claude API (Anthropic)** |
| AI Trend Analysis | **Claude API + Web Search** |
| Cron/Scheduler | **n8n Scheduler** + **Bull Queues** |

#### Infrastructure
| Fungsi | Teknologi |
|---|---|
| Containerization | **Docker + Docker Compose** |
| Orchestration | **Docker Swarm** (fase awal) → Kubernetes (scale) |
| Reverse Proxy | **Nginx** |
| SSL | **Let's Encrypt (Certbot)** |
| Monitoring | **Grafana + Prometheus** |
| Log | **Winston + Loki** |
| CI/CD | **GitHub Actions** |

#### Payment
| Fungsi | Teknologi |
|---|---|
| Payment Gateway | **Midtrans** (Indonesia primary) |
| Backup | **Xendit** |

### 2.2 Arsitektur Sistem

```
┌─────────────────────────────────────────────────────────────┐
│                    USER LAYER                                │
│  Web Browser (Next.js)  │  Mobile App (React Native)        │
└──────────────┬──────────┴──────────────────┬────────────────┘
               │ HTTPS                        │ HTTPS
               ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  NGINX REVERSE PROXY                         │
│              (SSL Termination + Load Balance)                │
└──────────────────────────────┬──────────────────────────────┘
                               │
               ┌───────────────┼──────────────────┐
               ▼               ▼                  ▼
     ┌─────────────┐  ┌──────────────┐  ┌────────────────┐
     │  NestJS API │  │   n8n Server │  │  Admin Panel   │
     │   Backend   │  │ (Automation) │  │  (Next.js CMS) │
     └──────┬──────┘  └──────┬───────┘  └────────────────┘
            │                │
     ┌──────┴──────┐  ┌──────┴────────────────────────┐
     │  PostgreSQL │  │     EXTERNAL INTEGRATIONS       │
     │    Redis    │  │  TikTok Shop API               │
     │    Bull Q   │  │  Shopee Open API               │
     │    MinIO    │  │  WhatsApp API (via n8n)             │
     └─────────────┘  │  Midtrans Payment              │
                      │  Claude AI API                 │
                      │  Revo Print / Label Print API  │
                      └────────────────────────────────┘
```

### 2.3 Peran n8n dalam Sistem

n8n digunakan KHUSUS untuk **semua logika yang melibatkan integrasi pihak eksternal**:

- ✅ Integrasi dengan TikTok Shop API (order, produk, fulfillment)
- ✅ Integrasi dengan Shopee Open API (order, produk, logistik)
- ✅ Webhook processing dari marketplace
- ✅ Scheduled sync (polling periodik)
- ✅ Auto-reply chat via Claude AI
- ✅ Auto-apply event/promo di marketplace
- ✅ Affiliate management automation
- ✅ Print label via Revo Print API
- ✅ Laporan konsolidasi otomatis

NestJS Backend menangani:
- ✅ Auth, user management, billing
- ✅ Master produk CRUD
- ✅ Dashboard data aggregation
- ✅ WebSocket real-time updates
- ✅ Admin panel API

---

## BAGIAN 3: AUTHENTICATION & ONBOARDING USER

### 3.1 Metode Login

**TIDAK ADA password tradisional.** Dua metode login:

#### A. Login via WhatsApp (RECEIVE-ONLY mechanism)

⚠️ **PENTING: WA hanya dipakai untuk MENERIMA pesan dari user, TIDAK pernah mengirim.**

**Mekanisme:**
1. User klik tombol **"Login via WhatsApp"** di halaman login
2. Browser generate kode unik sementara: `AutoToko-9823x79` (random alphanumeric)
3. Browser redirect/open WhatsApp dengan pesan pre-filled:
   ```
   wa.me/{AUTOTOKO_WA_NUMBER}?text=AutoToko-9823x79%20https://autotoko.id/auth/wa-callback?token=abc123
   ```
4. User melihat WhatsApp terbuka dengan pesan siap kirim: **"AutoToko-9823x79 https://autotoko.id/auth/..."**
5. User klik Send / Kirim dari WhatsApp mereka
6. n8n webhook menerima pesan masuk dari user
7. n8n ekstrak: nomor WA pengirim + kode unik dari teks pesan
8. n8n panggil backend: `POST /auth/wa-login/verify { code, wa_number }`
9. Backend validasi kode → buat/temukan user berdasarkan `wa_number` → issue JWT
10. Frontend polling `GET /auth/wa-login/status?code=AutoToko-9823x79` tiap 2 detik
11. Saat status = `verified` → frontend simpan JWT → redirect ke Dashboard

**Identitas user = nomor WhatsApp mereka** (tidak perlu username/password)

#### B. Login via Email OTP

1. User masukkan email
2. SendGrid kirim kode 6-digit ke email user
3. User masukkan kode di halaman login
4. Backend verifikasi kode → issue JWT
5. Redirect ke Dashboard

---

### 3.2 Kode Login WA — Detail Teknis

```
Format kode: AutoToko-[6 karakter random alphanumeric uppercase]
Contoh: AutoToko-9823X7, AutoToko-K4P2RQ

Expire: 5 menit sejak di-generate
Single-use: setelah dipakai, kode langsung invalid
Disimpan di: Redis dengan TTL 300 detik

Tabel wa_login_sessions:
  code          VARCHAR(20) PK
  wa_number     VARCHAR     NULL    -- diisi setelah WA masuk
  status        ENUM('pending','verified','expired')
  callback_token VARCHAR     UNIQUE  -- untuk frontend polling
  created_at    TIMESTAMP
  verified_at   TIMESTAMP   NULL
```

**Kenapa mekanisme ini aman:**
- Kode hanya valid 5 menit
- Single-use (tidak bisa dipakai ulang)
- Nomor WA yang login harus sama yang mengirim pesan
- Tidak ada password yang bisa di-brute force

---

### 3.3 Sistem Notifikasi — EMAIL ONLY (bukan WA)

**WhatsApp AutoToko = RECEIVE ONLY.** Semua notifikasi keluar dikirim via **Email (SendGrid)**.

| Jenis Notifikasi | Channel | Trigger |
|---|---|---|
| OTP Login | Email | User klik login via email |
| Konfirmasi registrasi | Email | User baru berhasil daftar |
| Order masuk (ringkasan harian) | Email | Harian jam 23:55 |
| Alert stok bahan kritis | Email | Stok < minimum |
| Alert saldo wallet rendah | Email | Saldo < threshold |
| Laporan mingguan | Email | Setiap Senin pagi |
| Laporan bulanan | Email | Tanggal 1 tiap bulan |
| Konfirmasi top-up wallet | Email | Setelah payment berhasil |
| Alert produk di-suspend marketplace | Email | Webhook dari marketplace |
| Alert token toko hampir expire | Email | 24 jam sebelum expire |
| Restock notif (deep link) | Email | Stok bahan < minimum |

**Template email menggunakan branding dinamis dari Admin CMS** (nama, logo, warna sesuai config brand AutoToko)

---

### 3.4 Flow Registrasi User

```
1. Pilih metode: Login via WA / Login via Email
2. Verifikasi identitas (WA atau email)
3. Sistem cek: user sudah ada? → login langsung
   User baru? → lanjut onboarding
4. Isi nama lengkap
5. Pilih paket (freemium/starter/pro)
6. Jika bukan freemium → bayar setup fee via Midtrans
7. Connect toko pertama (Shopee/TikTok) via OAuth
8. Dashboard aktif
```

### 3.5 Session Management

- JWT Access Token: expire 1 jam
- Refresh Token: expire 30 hari (disimpan di Redis)
- Re-login diperlukan jika refresh token expired
- WA login sessions disimpan di Redis dengan TTL 5 menit

---

## BAGIAN 4: BISNIS MODEL & PRICING

### 4.1 Struktur Biaya

**Freemium** (Gratis, terbatas)
- Max 1 toko
- Max 50 order/bulan
- Fitur dasar: sync order, basic laporan
- Tidak ada auto-pilot

**Starter** (Berbayar)
- Setup fee awal: Rp X (one-time)
- Subscription: Rp Y / bulan
- Per-transaksi fee: Rp Z / order

**Pro** (Berbayar)
- Setup fee awal: Rp X (one-time)
- Subscription: Rp Y / bulan
- Per-transaksi fee: Rp Z / order (lebih rendah dari Starter)
- Fitur penuh termasuk AI chat, affiliate management, dll

*(Nilai Rp ditentukan oleh Admin via CMS)*

### 4.2 Sistem Balance / Wallet User
- Setiap user punya **wallet/balance** di platform
- User melakukan **top-up** via Midtrans
- Sistem **auto-deduct** dari wallet untuk:
  - Subscription bulanan (auto-deduct di tanggal jatuh tempo)
  - Per-transaksi fee (auto-deduct setiap order selesai)
  - Setup fee awal (saat onboarding)
- Jika **saldo kurang** → otomatis notifikasi Email → jika masih kurang 3 hari → suspend fitur autopilot
- **Low balance threshold** bisa diatur admin

### 4.3 Flow Billing Per-Transaksi
```
Order masuk dari marketplace
    → Webhook diterima
    → Simpan order di DB
    → Cek wallet user
    → Jika cukup: deduct fee + record transaksi billing
    → Jika tidak cukup: flag order, kirim notif ke user
    → Jalankan automation workflow
```

### 4.4 Top-Up Balance
```
User minta top-up (masukkan nominal)
    → Midtrans create payment link
    → User bayar (transfer, QRIS, e-wallet, kartu kredit)
    → Midtrans callback → Backend verify
    → Tambah saldo wallet user
    → Kirim Email konfirmasi via SendGrid
```

---

## BAGIAN 5: FITUR KONEKSI TOKO (MULTI-MARKETPLACE)

### 5.1 Marketplace yang Didukung
- **Shopee** (via Shopee Open API v2)
- **TikTok Shop** (via TikTok Shop Open API v2)
- *Tokopedia, Lazada: roadmap Phase 2*

### 5.2 Setiap User Bisa Punya
- Banyak toko di Shopee (Shopee akun A, B, C, ...)
- Banyak toko di TikTok Shop (TikTok toko 1, 2, 3, ...)
- Semua dikelola dari 1 dashboard Autopilot

### 5.3 Flow Connect Toko — TikTok Shop
```
User klik "Tambah Toko TikTok" 
    → System generate auth URL (OAuth TikTok)
    → User redirect ke halaman TikTok login
    → User login & approve permissions
    → TikTok redirect ke callback URL kita dengan auth_code
    → Backend exchange auth_code → access_token + refresh_token
    → Simpan: shop_id, shop_cipher, access_token (encrypted), refresh_token (encrypted), expire_at
    → Sync awal: pull semua produk & order dari toko
    → Toko muncul di dashboard user
```

### 5.4 Flow Connect Toko — Shopee
```
User klik "Tambah Toko Shopee"
    → System generate auth URL: 
      https://partner.shopeemobile.com/api/v2/shop/auth_partner
      ?partner_id={partner_id}&redirect={redirect_url}&sign={sign}
    → User redirect ke halaman Shopee login
    → User login & approve
    → Shopee redirect ke callback URL kita dengan code + shop_id
    → Backend exchange code → access_token + refresh_token
    → Simpan: shop_id, access_token (encrypted), refresh_token (encrypted)
    → Sync awal: pull semua produk & order
    → Toko muncul di dashboard user
```

### 5.5 Token Management (KRITIS)

**TikTok Shop:**
- access_token expire: 7 hari
- refresh_token expire: 1 tahun
- Auto-refresh: job scheduler cek token expire dalam 24 jam → auto-refresh

**Shopee:**
- access_token expire: 4 JAM (sangat cepat!)
- refresh_token expire: 30 hari
- Auto-refresh: job scheduler cek SETIAP 3 JAM → auto-refresh

**Aturan penting:** Token disimpan terenkripsi (AES-256) di database. Tidak pernah expose ke frontend.

---

## BAGIAN 6: MASTER PRODUK & POSTINGAN

### 6.1 Konsep Master Produk

Master produk adalah **single source of truth** untuk semua data produk.
- Setiap master produk punya minimal 1 SKU utama
- Satu master produk bisa punya **banyak postingan** di berbagai marketplace
- Pencocokan: jika SKU di marketplace == SKU di master produk → otomatis terhubung

### 6.2 Dashboard Master Produk
Tampilkan untuk setiap master produk:
```
Produk: Baju Batik Parang (SKU: BBP-001)
├── Total postingan: 10
├── TikTok Shop Toko A: 7 postingan [aktif: 6, nonaktif: 1]
│   └── Total terjual bulan ini: 145 pcs
├── Shopee Toko B: 3 postingan [aktif: 3, nonaktif: 0]
│   └── Total terjual bulan ini: 67 pcs
├── Total revenue bulan ini: Rp 31.200.000
├── Stok total (semua postingan): 234 pcs
└── Status: Aktif | Review: 4.8⭐ (212 ulasan)
```

### 6.3 Fitur Duplicate Postingan
User bisa duplicate satu postingan untuk:
- Membuat variasi harga (harga normal, bundle, flash sale)
- Campaign berbeda-beda
- Testing A/B harga & judul

Flow:
```
User pilih postingan yang mau di-duplicate
    → System clone data produk di marketplace via API
    → Buat listing baru dengan nama/harga yang bisa diedit
    → Sync ke master produk (karena SKU sama)
    → Postingan baru muncul di daftar postingan master produk
```

---

## BAGIAN 7: ADMIN CMS / CONTROL PANEL

### 7.1 Fitur Admin Panel
Admin panel terpisah dari dashboard user. Hanya bisa diakses admin Autopilot.

**Credential Management:**
- Input & simpan: TikTok App Key, App Secret
- Input & simpan: Shopee Partner ID, Partner Key
- Input & simpan: Midtrans Client Key, Server Key
- Input & simpan: WhatsApp API credentials (endpoint URL, API key — same config as xtracker project in n8n)
- Input & simpan: SendGrid API Key
- Input & simpan: Claude API Key
- Input & simpan: Revo Print API Key
- Input & simpan: n8n Webhook URLs

**User Management:**
- Lihat semua user + status (aktif/suspend/trial)
- Manual suspend/unsuspend
- Manual top-up balance
- Reset OTP
- Lihat history billing

**Pricing Management:**
- Set harga setup fee per paket
- Set harga subscription bulanan per paket
- Set fee per transaksi per paket
- Set batas minimum balance sebelum notifikasi
- Set grace period setelah balance habis

**System Config:**
- Toggle fitur per user/per paket
- Maintenance mode
- Announcement banner
- Low balance threshold

**Analytics Dashboard:**
- Total revenue platform
- Total user aktif
- Total order diproses hari ini
- Error logs & alert

### 7.2 Security Admin Panel
- Akses hanya lewat IP whitelist
- 2FA wajib untuk semua admin
- Semua aksi admin di-log (audit trail)

---

## BAGIAN 8: FITUR OTOMASI — DETAIL SPESIFIKASI

### 8.1 AUTO: Order Approval (6.1)

**Trigger:** Webhook `ORDER_STATUS_CHANGE` / `NEW_ORDER` dari TikTok & Shopee

**Logic di n8n:**
```
Order masuk (status: UNPAID/AWAITING_SHIPMENT)
    → Validasi:
        - Stok tersedia? (cek master produk)
        - Alamat delivery valid?
        - Order tidak flagged fraud?
    → Jika semua OK: auto-approve via API
    → Jika ada masalah: flag manual, notif user via Email
    → Deduct billing fee dari wallet user
    → Update dashboard real-time via WebSocket
```

**TikTok API:** `POST /order/202309/orders/confirm`  
**Shopee API:** `POST /api/v2/order/handle_buyer_cancellation` (untuk auto-handle cancellation)

---

### 8.2 SEMI-AUTO: Chat/Balas Chat ke Pembeli (6.2)

**Sepenuhnya dilakukan oleh AI (Claude API)**

**Flow n8n:**
```
Webhook: pesan baru dari pembeli masuk
    → Ambil konteks: nama pembeli, produk yang dibeli, riwayat chat
    → Kirim ke Claude API dengan system prompt:
        - Peran: CS profesional toko {nama_toko}
        - Gaya bahasa: ramah, sopan, bahasa Indonesia
        - Konteks: info produk, kebijakan toko, status order
        - Prioritas: jawab pertanyaan, jaga kepuasan pelanggan
    → Claude generate balasan
    → Auto-kirim balasan via marketplace chat API
    → Log percakapan di database
```

**TikTok Shop:** Customer Engagement API (chat)  
**Shopee:** `POST /api/v2/message/send_message`

**Aturan tambahan:**
- Jika pembeli menanyakan sesuatu yang AI tidak yakin → flag ke user untuk review manual
- Pesan komplain berat → auto-eskalasi ke Email alert user
- History chat tersimpan di dashboard

---

### 8.3 HUMAN ACTIVITY: Print Resi (6.3)
Fisik harus dilakukan manusia. Namun platform membantu:
- Auto-generate AWB/resi via API marketplace
- Tampilkan list resi yang perlu diprint di dashboard
- Kirim ke Revo Print / printer label otomatis (jika terhubung)

---

### 8.4 HUMAN ACTIVITY: Produksi Barang (6.4)
Tetap manual. Platform membantu dengan:
- Notif WA ke user ketika order memerlukan produksi
- Dashboard "produksi queue" yang menampilkan order yang perlu diproduksi

---

### 8.5 HUMAN ACTIVITY: Packing (6.5)
Tetap manual. Platform membantu dengan:
- Tampilkan checklist packing per order
- Barcode scan validation (future feature)

---

### 8.6 AUTO: Restock Bahan (6.6)

**Konsep: Bill of Materials (BOM)**
Setiap master produk punya mapping bahan baku:
```
Produk A (Baju Batik):
  - Kain batik motif parang: 1.5 meter
  - Benang jahit putih: 10 gram
  - Kancing baju: 5 buah
  - Plastik kemasan: 1 buah
```

---

### ⚠️ TEMUAN KRITIS: Shopee TIDAK Punya Buyer-Side API

**Shopee Open API adalah SELLER-ONLY API.** Tidak ada endpoint resmi untuk:
- Melakukan pembelian / place order sebagai buyer
- Menambah item ke keranjang belanja (add to cart)
- Checkout programatik sebagai pembeli

**Konsekuensi:** Fitur "auto-order ke supplier via Shopee" secara teknis **TIDAK BISA** dilakukan langsung via Shopee API. Semua endpoint Shopee Open API hanya untuk mengelola TOKO (sebagai seller).

---

**Solusi yang Diimplementasikan — 3 Opsi (pilih sesuai kebutuhan user):**

**Opsi A: SEMI-AUTO — WA Notif + Deep Link (RECOMMENDED)**
```
Stok bahan < threshold
    → Sistem hitung qty yang perlu dibeli
    → Sistem ambil link produk supplier dari config BOM
    → Kirim notif Email ke pemilik toko:
        "⚠️ Stok [nama bahan] hampir habis! [XX] [unit] tersisa.
         Silakan beli [QTY] [unit] dari supplier:
         👉 [link_shopee_supplier]
         Total estimasi: Rp [harga × qty]
         Alamat tujuan: [alamat_config]"
    → Pemilik toko klik link → buka Shopee → checkout manual
    → Pemilik toko update stok di AutoToko setelah beli
```

**Opsi B: SEMI-AUTO — WhatsApp Langsung ke Supplier**
```
Stok bahan < threshold
    → Sistem kirim Email otomatis ke nomor supplier:
        "Halo [nama_supplier], kami butuh restock:
         - [nama_bahan]: [qty] [unit]
         - Kirim ke: [alamat_pengiriman]
         - Pembayaran: [metode]
         Mohon konfirmasi dan kirimkan invoice. Terima kasih."
    → Supplier proses pesanan manual
    → Tracking tetap manual dari pemilik toko
```

**Opsi C: OTOMASI via Supplier yang Punya API Sendiri (B2B)**
```
Jika supplier punya sistem pemesanan dengan REST API sendiri:
    → Simpan supplier_api_endpoint + api_key di config BOM
    → n8n call API supplier secara langsung saat stok kritis
    → Order terproses otomatis 100%
    → Ini hanya berlaku untuk supplier yang menyediakan API
```

**Logic Restock di AutoToko (implementasi aktual):**
```
Setiap order masuk untuk Produk A
    → Kalkulasi kebutuhan bahan dari BOM
    → Kurangi stok bahan di database
    → Jika stok bahan < threshold yang ditentukan user:
        → Cek config BOM untuk bahan tersebut:
            - Ada link Shopee supplier? → Opsi A (WA + deep link)
            - Ada nomor WA supplier? → Opsi B (WA ke supplier)
            - Ada supplier API? → Opsi C (call API langsung)
        → Kirim notif Email ke pemilik toko (selalu, apapun opsinya)
        → Catat restock_request di database dengan status 'PENDING'
        → Setelah pemilik konfirmasi beli → update status → update stok
```

**Konfigurasi BOM yang Harus Disimpan (per bahan baku):**
```
bom_items (tambahan field vs schema awal):
  restock_method     ENUM('wa_owner', 'wa_supplier', 'supplier_api')
  supplier_name      VARCHAR         -- nama toko/supplier
  supplier_shopee_url VARCHAR        -- link produk di Shopee (Opsi A)
  supplier_wa_number VARCHAR         -- nomor WA supplier (Opsi B)
  supplier_api_url   VARCHAR         -- endpoint API supplier (Opsi C)
  supplier_api_key   TEXT ENCRYPTED  -- API key supplier (Opsi C)
  restock_qty        DECIMAL         -- berapa qty yang dibeli per restock
  restock_price      DECIMAL         -- harga satuan dari supplier
  payment_method     VARCHAR         -- QRIS / COD / Transfer / dll
  shipping_address   TEXT            -- alamat tujuan pengiriman
  receiver_name      VARCHAR         -- nama penerima
  receiver_phone     VARCHAR         -- telepon penerima
  notes_for_supplier TEXT            -- catatan untuk supplier
```

**Fitur BOM Management di platform:**
- User input mapping bahan per produk
- User set threshold minimum per bahan
- User pilih opsi restock (WA Owner / WA Supplier / Supplier API)
- User input detail supplier (URL Shopee / nomor WA / API endpoint)
- User input detail pengiriman (alamat, penerima, metode bayar)

---

### 8.7 AUTO: Order Print Label ke Revo Print (6.7)

**Flow n8n:**
```
AWB ter-generate untuk order
    → Ambil data: nama pembeli, alamat, berat, kurir, tracking number
    → Format data sesuai template Revo Print
    → Call Revo Print API: POST /print/label
    → Simpan status print di database
    → Notif user: "Label siap diprint: [batch X order]"
```

---

### 8.8 AUTO: Withdrawal Balance Marketplace (6.8)

⚠️ **TikTok Shop & Shopee TIDAK menyediakan API untuk withdrawal.**

**Solusi semi-auto:**
- Platform monitor saldo settlement di dashboard
- Kirim notif Email ke user ketika saldo mencapai threshold tertentu
- Sertakan deep-link langsung ke halaman withdrawal marketplace
- User melakukan withdrawal manual dari notif tersebut
- Platform catat withdrawal di laporan keuangan

---

### 8.9 AUTO: Rekap Laporan (6.9)

**Laporan yang dibuat otomatis (via n8n scheduler):**

1. **Laporan Harian** (setiap jam 23:55):
   - Total order masuk
   - Total revenue
   - Total fee platform
   - Top produk terjual
   - Dikirim via Email

2. **Laporan Mingguan** (setiap Senin pagi):
   - Performance per toko
   - Performance per produk
   - Tren penjualan
   - Dikirim via Email + tersedia di dashboard

3. **Laporan Bulanan** (tanggal 1 tiap bulan):
   - P&L sederhana
   - Settlement rekonsiliasi
   - Rekap affiliate commission
   - Export ke Excel/PDF

**TikTok Finance API:** GET Statements, GET Transactions by Order  
**Shopee Finance API:** `GET /api/v2/payment/get_escrow_detail`

---

### 8.10 AUTO: Reply Review Customer (6.10)

**Flow n8n:**
```
Webhook: review baru masuk dari marketplace
    → Klasifikasi review: positif (4-5 bintang) / negatif (1-3 bintang)
    → Ambil konteks: nama produk, isi review, rating
    → Kirim ke Claude API:
        - Jika positif: generate balasan terima kasih yang warm
        - Jika negatif: generate balasan empati + solusi
    → Auto-publish balasan via API
```

**TikTok:** Customer Service API (review management)  
**Shopee:** `POST /api/v2/shop/reply_comment`

---

### 8.11 AUTO: Apply Event/Program Marketplace (6.11)

**TikTok Shop:**
```
n8n scheduler → cek available campaigns/events
    → Filter: eligible untuk toko kita?
    → Jika ya + match kriteria (produk ada, margin cukup)
    → Auto-apply via TikTok Promotion API
    → Notif user: "Berhasil daftar event: [nama event]"
```

**Shopee:**
```
n8n scheduler → GET /api/v2/shop/get_promotion_list
    → Cek eligibility
    → POST /api/v2/discount/add_discount (auto-join flash sale, dll)
    → Notif user
```

---

### 8.12 AUTO: Affiliate Management (6.12)

**4 sub-aktivitas:**

**a) Cari Affiliator:**
- Filter affiliator berdasarkan: niche/kategori, min follower, min GMV, region
- TikTok: Creator API
- Shopee: Affiliate API

**b) Tandai Affiliator:**
- User bisa tandai creator sebagai "prospek", "diundang", "aktif", "blacklist"
- Simpan di database platform

**c) Undang Affiliator:**
```
User pilih produk + list affiliator yang mau diundang
    → n8n kirim undangan via TikTok Affiliate API / Shopee Affiliate API
    → Catat status undangan di database
    → Follow-up reminder jika tidak ada respons dalam X hari
```

**d) Chat Affiliator yang Diundang:**
- **Sepenuhnya dilakukan AI (Claude API)** — sama seperti chat ke pembeli
- Template opening message ke affiliator (bisa dikustomisasi user)
- AI handle follow-up, negosiasi komisi, konfirmasi konten

---

### 8.13 SEMI-AUTO: Create Video Rutin (6.13)

Platform membantu:
- **AI Script Generator:** berdasarkan produk, target audiens, trending hook
- **Template library:** template video TikTok/Shopee Live
- **Content calendar:** jadwal posting video per minggu
- Eksekusi produksi video tetap manual (human activity)
- Setelah video selesai → user upload → platform bantu optimize caption & hashtag → auto-post

---

### 8.14 AUTO: Aktifkan Iklan (6.14)

**Default: Rp 100.000/hari per toko**

**TikTok Ads:**
```
n8n scheduler (setiap pagi jam 07:00):
    → TikTok Ads API: aktifkan kampanye iklan
    → Set budget: Rp 100.000/hari
    → Monitor ROAS setiap jam
    → Jika ROAS < threshold → pause iklan → notif user
    → Malam jam 23:00 → review performa → laporan
```

**Shopee Ads:**
```
n8n scheduler → Shopee Ads API
    → Aktifkan topads / search ads
    → Set budget harian
    → Monitor konversi
```

**Admin bisa set:** Default budget, ROAS threshold per user/per paket.

---

### 8.15 AUTO: Evaluasi Katalog Produk (6.15)

**Weekly evaluation job (setiap Minggu malam):**
```
Untuk setiap master produk:
    → Hitung: views, conversion rate, GMV, review score, return rate (30 hari)
    → AI (Claude) analisis: apakah produk perlu dioptimasi?
    → Generate skor produk (A/B/C/D)
    → Tampilkan di dashboard "Product Health Score"
    → Kirim weekly summary ke user via Email
```

---

### 8.16 AUTO: Eliminate Produk (6.16)

**Auto-flag produk untuk eliminasi jika:**
- Tidak terjual dalam 60 hari
- Return rate > 20%
- Review score < 3.0
- Margin negatif (setelah fee marketplace)

**Flow:**
```
System flag produk → tampilkan di dashboard "Kandidat Eliminasi"
    → Kirim notif Email ke user: "Ada 3 produk disarankan untuk dinonaktifkan"
    → User review → konfirmasi
    → Platform auto-deactivate semua postingan produk tersebut di semua marketplace
```

**TIDAK auto-delete tanpa konfirmasi user.**

---

### 8.17 AUTO: Optimize Produk (6.17)

**Optimasi yang bisa dilakukan otomatis:**

1. **Judul Produk:** AI generate judul yang lebih SEO-friendly berdasarkan trend pencarian
2. **Deskripsi:** AI rewrite deskripsi yang lebih engaging
3. **Keyword/Tag:** Update keyword berdasarkan trending search
4. **Harga:** Suggest harga berdasarkan kompetitor (monitoring harga)
5. **Foto:** Alert jika foto produk kualitas rendah

**Flow:**
```
n8n weekly job → ambil data performa setiap postingan
    → Claude API analisis + generate optimasi
    → Tampilkan saran di dashboard: "Optimasi Tersedia"
    → User approve → platform update via marketplace API
    → Atau: auto-apply jika user set ke "auto-optimize mode"
```

---

### 8.18 AUTO: Analyze Trend (6.18)

**Daily trend analysis job:**
```
n8n scheduler (setiap pagi):
    → Shopee: ambil trending keywords via API
    → TikTok: monitor trending hashtags & produk
    → Claude API + Web Search: analisis tren pasar
    → Generate "Daily Trend Report":
        - Keyword trending minggu ini
        - Produk kategori yang sedang naik
        - Rekomendasi: produk apa yang bisa dijual
    → Kirim ke dashboard + laporan mingguan via Email
```

---

### 8.19 AUTO: Posting Produk (6.19)

**Flow posting produk baru:**
```
User buat/input master produk di platform
    → Input: nama, SKU, deskripsi, harga, stok, foto, kategori
    → Pilih: toko mana yang mau di-post
    → Platform:
        1. Check listing prerequisites per marketplace
        2. Upload foto ke CDN marketplace
        3. Map kategori master → kategori marketplace
        4. Create product listing via API
        5. Simpan listing_id/item_id → hubungkan ke master produk
        6. Update stok sinkron di semua toko
    → Notif user: "Produk berhasil diposting ke 5 toko"
```

**Fitur duplicate posting:**
```
User pilih postingan yang ada
    → Klik "Duplicate"
    → Edit: judul, harga, atau deskripsi (opsional)
    → Platform buat listing baru di marketplace
    → Auto-link ke master produk yang sama (karena SKU sama)
```

---

## BAGIAN 9: DATABASE SCHEMA LENGKAP

### 9.1 Tabel Utama

```sql
-- USERS
users (
  id UUID PK,
  email VARCHAR UNIQUE,
  whatsapp VARCHAR UNIQUE,
  full_name VARCHAR,
  plan_type ENUM('freemium','starter','pro'),
  plan_started_at TIMESTAMP,
  plan_expired_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  is_suspended BOOLEAN DEFAULT false,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- WALLET / BALANCE
wallets (
  id UUID PK,
  user_id UUID FK → users,
  balance DECIMAL(15,2) DEFAULT 0,
  currency VARCHAR DEFAULT 'IDR',
  updated_at TIMESTAMP
)

wallet_transactions (
  id UUID PK,
  wallet_id UUID FK → wallets,
  type ENUM('topup','deduct_subscription','deduct_transaction','deduct_setup','refund'),
  amount DECIMAL(15,2),
  balance_before DECIMAL(15,2),
  balance_after DECIMAL(15,2),
  reference_id VARCHAR,  -- order_id atau invoice_id
  description TEXT,
  created_at TIMESTAMP
)

-- MARKETPLACE SHOPS (per user)
shops (
  id UUID PK,
  user_id UUID FK → users,
  marketplace ENUM('tiktok','shopee','tokopedia'),
  shop_id VARCHAR,              -- ID dari marketplace
  shop_name VARCHAR,
  shop_cipher VARCHAR,          -- TikTok only
  open_id VARCHAR,              -- TikTok only
  merchant_id VARCHAR,          -- Shopee only
  seller_region VARCHAR,        -- ID, US, UK, etc.
  access_token TEXT ENCRYPTED,
  access_token_expire_at TIMESTAMP,
  refresh_token TEXT ENCRYPTED,
  refresh_token_expire_at TIMESTAMP,
  shop_status ENUM('active','deactivated','suspended','disconnected'),
  last_sync_at TIMESTAMP,
  connected_at TIMESTAMP,
  created_at TIMESTAMP
)

-- MASTER PRODUK
master_products (
  id UUID PK,
  user_id UUID FK → users,
  sku VARCHAR NOT NULL,         -- SKU UTAMA - penghubung ke postingan
  name VARCHAR NOT NULL,
  description TEXT,
  category_id INTEGER,          -- category internal platform
  base_price DECIMAL(15,2),
  weight_gram INTEGER,
  images JSON,                  -- array of image URLs
  status ENUM('active','inactive','draft'),
  health_score ENUM('A','B','C','D'),
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  UNIQUE(user_id, sku)
)

-- MASTER PRODUK VARIANTS / SKU
master_product_variants (
  id UUID PK,
  master_product_id UUID FK → master_products,
  sku VARCHAR NOT NULL,         -- SKU varian (misal: BBP-001-RED-XL)
  variant_name VARCHAR,         -- Red - XL
  price DECIMAL(15,2),
  stock INTEGER DEFAULT 0,
  images JSON,
  created_at TIMESTAMP
)

-- BILL OF MATERIALS (BOM) - untuk restock bahan
bom_items (
  id UUID PK,
  master_product_id UUID FK → master_products,
  material_name VARCHAR,        -- nama bahan baku
  quantity DECIMAL(10,3),       -- jumlah per 1 produk
  unit VARCHAR,                 -- meter, gram, pcs, dll
  current_stock DECIMAL(10,3) DEFAULT 0,
  minimum_threshold DECIMAL(10,3) DEFAULT 0,
  supplier_shop_url VARCHAR,    -- URL toko supplier di Shopee (opsional)
  created_at TIMESTAMP
)

-- POSTINGAN PRODUK (di marketplace)
product_postings (
  id UUID PK,
  master_product_id UUID FK → master_products,
  shop_id UUID FK → shops,
  marketplace_item_id VARCHAR,  -- item_id (Shopee) / product_id (TikTok)
  marketplace_sku VARCHAR,      -- SKU yang digunakan di marketplace
  title VARCHAR,                -- judul postingan (bisa berbeda dari master)
  price DECIMAL(15,2),
  stock INTEGER,
  status ENUM('active','inactive','deleted','under_review','banned'),
  views_7d INTEGER DEFAULT 0,
  sold_7d INTEGER DEFAULT 0,
  gmv_7d DECIMAL(15,2) DEFAULT 0,
  review_score DECIMAL(3,2),
  review_count INTEGER DEFAULT 0,
  last_synced_at TIMESTAMP,
  created_at TIMESTAMP
)

-- ORDERS
orders (
  id UUID PK,
  user_id UUID FK → users,
  shop_id UUID FK → shops,
  marketplace_order_id VARCHAR NOT NULL,
  marketplace ENUM('tiktok','shopee'),
  status VARCHAR,               -- UNPAID, AWAITING_SHIPMENT, etc.
  buyer_name VARCHAR,
  buyer_phone VARCHAR,
  shipping_address JSON,
  shipping_courier VARCHAR,
  tracking_number VARCHAR,
  payment_method VARCHAR,
  subtotal DECIMAL(15,2),
  shipping_fee DECIMAL(15,2),
  marketplace_fee DECIMAL(15,2),
  total_amount DECIMAL(15,2),
  platform_fee DECIMAL(15,2),  -- fee yang kita charge ke user
  fee_deducted BOOLEAN DEFAULT false,
  awb_generated BOOLEAN DEFAULT false,
  label_printed BOOLEAN DEFAULT false,
  items JSON,                   -- array of order items
  created_at_marketplace TIMESTAMP,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  UNIQUE(marketplace, marketplace_order_id)
)

-- WEBHOOK EVENTS (idempotency)
webhook_events (
  id UUID PK,
  marketplace ENUM('tiktok','shopee'),
  event_type VARCHAR,
  event_id VARCHAR,             -- ID unik event dari marketplace
  shop_id UUID FK → shops,
  payload JSON,
  processed BOOLEAN DEFAULT false,
  processed_at TIMESTAMP,
  error_message TEXT,
  created_at TIMESTAMP,
  UNIQUE(marketplace, event_id)
)

-- PLATFORM BILLING
platform_invoices (
  id UUID PK,
  user_id UUID FK → users,
  type ENUM('setup_fee','subscription','topup'),
  amount DECIMAL(15,2),
  status ENUM('pending','paid','failed','cancelled'),
  midtrans_order_id VARCHAR,
  midtrans_payment_url TEXT,
  paid_at TIMESTAMP,
  created_at TIMESTAMP
)

-- AFFILIATE MANAGEMENT
affiliates (
  id UUID PK,
  user_id UUID FK → users,
  marketplace ENUM('tiktok','shopee'),
  creator_id VARCHAR,           -- ID creator di marketplace
  creator_name VARCHAR,
  follower_count INTEGER,
  niche VARCHAR,
  status ENUM('prospect','invited','active','rejected','blacklist'),
  commission_rate DECIMAL(5,2),
  total_gmv DECIMAL(15,2) DEFAULT 0,
  notes TEXT,
  invited_at TIMESTAMP,
  created_at TIMESTAMP
)

-- CHAT LOGS (AI conversation)
chat_logs (
  id UUID PK,
  shop_id UUID FK → shops,
  order_id UUID FK → orders NULL,
  chat_type ENUM('buyer','affiliate'),
  counterpart_id VARCHAR,       -- ID pembeli/affiliator di marketplace
  counterpart_name VARCHAR,
  message_in TEXT,
  message_out TEXT,
  ai_model VARCHAR,
  tokens_used INTEGER,
  marketplace_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMP
)

-- REVIEW LOGS
review_logs (
  id UUID PK,
  shop_id UUID FK → shops,
  order_id UUID FK → orders NULL,
  marketplace_review_id VARCHAR,
  rating INTEGER,               -- 1-5
  review_text TEXT,
  reply_text TEXT,
  ai_generated BOOLEAN DEFAULT true,
  replied_at TIMESTAMP,
  created_at TIMESTAMP
)

-- NOTIFICATIONS
notifications (
  id UUID PK,
  user_id UUID FK → users,
  type VARCHAR,
  title VARCHAR,
  message TEXT,
  channel ENUM('wa','email','in_app'),
  sent BOOLEAN DEFAULT false,
  sent_at TIMESTAMP,
  created_at TIMESTAMP
)

-- ADMIN SETTINGS (credentials & config)
admin_settings (
  id UUID PK,
  key VARCHAR UNIQUE,
  value TEXT ENCRYPTED,
  description TEXT,
  updated_by VARCHAR,
  updated_at TIMESTAMP
)

-- PRICING CONFIG (diatur admin)
pricing_config (
  id UUID PK,
  plan_type ENUM('starter','pro'),
  setup_fee DECIMAL(15,2),
  monthly_fee DECIMAL(15,2),
  per_transaction_fee DECIMAL(15,2),
  max_shops INTEGER,
  max_orders_per_month INTEGER,
  features JSON,                -- feature flags per plan
  is_active BOOLEAN DEFAULT true,
  updated_at TIMESTAMP
)
```

---

## BAGIAN 10: API REFERENCE SHOPEE — LENGKAP

> **Sumber:** Shopee Open Platform Developer Guide + shopee-sdk (TypeScript SDK dengan 100% endpoint coverage) — github.com/congminh1254/shopee-sdk

### ⚠️ PEMBATASAN PENTING — HASIL INVESTIGASI MENYELURUH

**Shopee Open API = SELLER-SIDE ONLY. SUDAH DIVERIFIKASI SECARA MENYELURUH.**

**Metode Verifikasi:** Chrome browser extension digunakan untuk mengakses Vue.js app state dari Shopee Open Platform secara langsung. Ditemukan **447 API endpoint** di seluruh **29 module** Shopee Open Platform. Tidak satu pun dari 447 API tersebut adalah buyer-facing ordering API.

**Breakdown 29 Module Shopee Open Platform (total 447 API):**

| Module | Jumlah API | Fungsi |
|---|---|---|
| Product | 63 | SELLER kelola produk |
| Logistics | 46 | SELLER kelola pengiriman |
| AMS (Affiliate Marketing) | 36 | SELLER kelola affiliasi |
| GlobalProduct | 34 | SELLER produk global |
| Ads | 25 | SELLER kelola iklan |
| Livestream | 25 | SELLER live streaming |
| Order | 22 | SELLER terima & kelola order dari buyer |
| FirstMile | 16 | SELLER first-mile logistics |
| Returns | 15 | SELLER handle retur |
| Video | 15 | SELLER kelola video |
| Add-On Deal | 14 | SELLER buat add-on deal |
| Payment | 18 | SELLER terima pembayaran |
| Discount | 12 | SELLER buat diskon |
| ShopFlashSale | 11 | SELLER buat flash sale |
| Overview | 10 | Dokumentasi |
| Bundle Deal | 10 | SELLER buat bundle |
| Shop | 9 | SELLER kelola toko |
| ShopCategory | 7 | SELLER kategori toko |
| MediaSpace | 6 | SELLER media storage |
| Media | 6 | SELLER media |
| Merchant | 6 | SELLER merchant info |
| Voucher | 6 | SELLER buat voucher |
| Follow Prize | 6 | SELLER follow prize |
| AccountHealth | 6 | SELLER kesehatan akun |
| Public | 6 | API publik |
| SBS | 5 | SELLER by Shopee |
| Push | 4 | Webhook seller |
| FBS | 4 | Fulfilled by Shopee |
| TopPicks | 4 | SELLER top picks |

**Pencarian keyword buyer-side pada 447 API:**
- `place_order` → **0 hasil**
- `create_order` (sebagai buyer) → **0 hasil**
- `add_to_cart` → **0 hasil**
- `checkout` → **0 hasil**
- `buy` / `purchas` → **0 hasil**
- `submit_order` → **0 hasil**

Yang ditemukan hanya 3 endpoint *tentang* buyer (bukan *sebagai* buyer):
- `v2.order.handle_buyer_cancellation` — seller tangani cancel dari buyer
- `v2.order.get_pending_buyer_invoice_order_list` — khusus Brazil (NF-e invoice)
- `v2.order.get_buyer_invoice_info` — khusus Brazil

**KESIMPULAN FINAL:**
```
Shopee Open Platform API TIDAK MEMILIKI buyer-side ordering API.
Tidak ada endpoint untuk: place order, add to cart, checkout, atau purchase
sebagai buyer, baik di versi v1 maupun v2.

Ini bukan keterbatasan sementara — ini adalah keputusan desain Shopee
yang memang membatasi Open API hanya untuk ekosistem seller/merchant.
```

**Implikasi untuk AutoToko:**
- Fitur "auto-restock via Shopee" → **BUKAN call Shopee API**, implementasi via Email notif + deep link (lihat Bagian 8.6)
- Fitur "withdrawal balance" → **BUKAN call API**, implementasi via Email notif manual ke Seller Center

### 10.1 Base URL & Environment

| Environment | URL | Keterangan |
|---|---|---|
| Production Global (SG) | `https://partner.shopeemobile.com` | Untuk server di region SG — **GUNAKAN INI untuk Indonesia** |
| Production China | `https://openplatform.shopee.cn` | Untuk server di China Mainland |
| Production Brazil | `https://openplatform.shopee.com.br` | Untuk server di US/Brazil |
| Sandbox | `https://openplatform.sandbox.test-stable.shopee.sg` | Testing & development |

**Untuk AutoToko (Indonesia):** Gunakan `https://partner.shopeemobile.com`

### 10.2 Authentication & Token

**Credentials yang dibutuhkan:**
- `partner_id` — dari Shopee Open Platform Console
- `partner_key` — dari Shopee Open Platform Console
- `access_token` — expire **4 JAM** (14400 detik), refresh SETIAP 3 JAM
- `refresh_token` — expire **30 hari** (2592000 detik)
- `shop_id` — ID toko yang diauthorize

**⚠️ KRITIS: access_token expire 4 jam — paling cepat di antara semua marketplace!**

**Token response dari Shopee:**
```json
{
  "access_token": "786b4c74526e52426555616e...",
  "refresh_token": "527a424f54494572544875766...",
  "expire_in": 14400,
  "refresh_token_expire_in": 2592000,
  "request_id": "84ec4d8971735d62dca40c0...",
  "shop_id": 123456789
}
```

### 10.3 Signature Shopee — BERBEDA dari TikTok!

**Formula signature:**
```
base_string = partner_id + API_path + timestamp + access_token + shop_id
sign = HMAC-SHA256(base_string, partner_key)
```

**Contoh:**
```
partner_id   = 1234567
API_path     = /api/v2/order/get_order_list
timestamp    = 1623812664
access_token = abc123token
shop_id      = 987654321

base_string = "1234567/api/v2/order/get_order_list1623812664abc123token987654321"
sign = HMAC-SHA256(base_string, partner_key) → hex string
```

**⚠️ Perbedaan utama dengan TikTok:**
- Shopee: `partner_id + path + timestamp + token + shop_id` (concatenated, no separator)
- TikTok: Sort params alphabetically → app_secret prefix & suffix

### 10.4 OAuth Flow Shopee — Step by Step

```
Step 1: Generate Authorization URL
URL = https://partner.shopeemobile.com/api/v2/shop/auth_partner
    + ?partner_id={id}
    + &redirect={redirect_url}
    + &sign={HMAC-SHA256(partner_id+/api/v2/shop/auth_partner+timestamp, partner_key)}
    + &timestamp={unix_timestamp}

Step 2: User login di Shopee & approve → redirect ke:
https://your-callback.com?code=xxxx&shop_id=999999&main_account_id=888888

Step 3: Exchange code untuk token
GET /api/v2/auth/token/get
?code={code}&shop_id={shop_id}&partner_id={id}&timestamp={ts}&sign={sign}

Step 4: Simpan access_token + refresh_token ke database (encrypted!)

Step 5: Refresh SETIAP 3 JAM (sebelum expire 4 jam)
GET /api/v2/auth/access_token/get
?refresh_token={refresh_token}&shop_id={shop_id}&partner_id={id}&timestamp={ts}&sign={sign}

Step 6: Jika refresh_token expired (30 hari) → minta user re-authorize
```

**Cancel authorization:**
```
GET /api/v2/shop/cancel_auth_partner
```

### 10.5 Push Mechanism (Webhooks) Shopee

**Setup:** Shopee Open Platform Console → App → Webhook Callback URL

| Code | Event | Trigger | Action AutoToko |
|---|---|---|---|
| **1** | SHOP_UPDATE | Info toko berubah | Update data toko di DB |
| **2** | ITEM_UPDATE | Produk diupdate/dihapus | Sync master produk |
| **3** | ORDER_STATUS | Status order berubah ⚡ | Trigger auto-workflow |
| **4** | ORDER_TRACKING | Tracking number update | Update AWB di DB |
| **5** | BANNED | Produk/toko diblokir | Alert user via Email |
| **6** | VERIFICATION | Verifikasi masa depan | N/A |
| **7** | ITEM_PROMOTION | Stok terpengaruh promo | Sync stok |
| **8** | RESERVED_CHANGE | Stok reserve berubah | Update stok |
| **15** | SHIPPING_DOC | AWB document ready/failed | Update status AWB |
| **17** | RETURN_STATUS | Status retur berubah | Trigger after-sales |

**⚠️ Push Mechanism hanya memberi tahu bahwa data BERUBAH, bukan isi data baru.**
Setelah menerima webhook → call API yang sesuai untuk ambil data terbaru.

### 10.6 Order Flow Shopee — Lengkap

**Status Order (lifecycle):**
```
UNPAID
  ↓ (buyer pay)
READY_TO_SHIP
  ↓ (seller arrange shipment)
PROCESSED
  ↓ (kurir pickup)
SHIPPED
  ↓ (delivered to buyer)
COMPLETED
  ↓ (after-sales done)

Juga bisa:
CANCELLED (dari UNPAID atau READY_TO_SHIP)
INVOICE_PENDING (Brazil & Philippines only)
```

**3 Entities Penting:**
- **Order** (`order_sn`): 1 checkout, bisa punya banyak items
- **Package** (`package_number`): Unit pengiriman, bisa di-split dari 1 order
- **Item**: Produk dalam order dengan quantity

**Key Order APIs:**
```
GET  /api/v2/order/get_order_list            → list orders dengan filter status
GET  /api/v2/order/get_order_detail          → detail 1 order (dengan items, buyer, alamat)
POST /api/v2/order/cancel_order              → seller cancel order
POST /api/v2/order/handle_buyer_cancellation → approve/reject cancel request dari buyer
POST /api/v2/order/split_order               → split order jadi multiple packages
GET  /api/v2/order/get_shipment_list         → list packages yang perlu di-ship
GET  /api/v2/order/search_package_list       → search packages (ToProcess, dsb)
```

**Shipping Flow untuk Indonesia (FBS - Fulfilled by Seller):**
```
1. Ambil shipping parameter
   GET /api/v2/logistics/get_shipping_parameter?order_sn=xxx

2. Pilih metode: pickup / dropoff / non_integrated
   - pickup/dropoff → kurir TikTok/Shopee integrated
   - non_integrated → kurir sendiri (JNE, JT, dll) → wajib upload tracking manual

3. Ship order (generate AWB)
   POST /api/v2/logistics/ship_order
   Params: order_sn, package_number, pickup/dropoff/non_integrated settings

   Atau batch ship:
   POST /api/v2/logistics/mass_ship_order

4. Ambil tracking number (untuk integrated channel)
   GET /api/v2/logistics/get_tracking_number?order_sn=xxx

5. Generate AWB document (PDF untuk print)
   POST /api/v2/logistics/create_shipping_document
   GET  /api/v2/logistics/get_shipping_document_result  (poll sampai READY)

6. Update tracking manual (untuk non_integrated channel)
   POST /api/v2/logistics/update_shipping_order
```

**Package fulfillment statuses:**
```
LOGISTICS_NOT_START → LOGISTICS_READY → LOGISTICS_REQUEST_CREATED
→ LOGISTICS_PICKUP_DONE → (delivered)
```

**Q&A dari dokumentasi resmi:**
- **Q: Tidak bisa get time slot?** → Order mungkin sudah di-ship atau ship_by_day sudah lewat
- **Q: Error "logistic status not ready to ship"?** → Cek order_status, harus READY_TO_SHIP
- **Q: AWB status PROCESSING terus?** → Poll `/get_shipping_document_result` setiap 30 detik (max 5 menit)
- **Q: Error "Order status does not support AWB printing"?** → Order harus status PROCESSED (sudah di-ship)

### 10.7 Product APIs Shopee — Lengkap

**⚠️ PENTING: Category tree berbeda per shop! Selalu fetch berdasarkan shop_id, bukan global.**

**Product Management (CRUD):**
```
GET  /api/v2/product/get_item_list           → list produk (max 100 per request, pagination)
     Params: offset, page_size, update_time_from/to, item_status (NORMAL/BANNED/UNLIST)
GET  /api/v2/product/get_item_base_info      → detail produk (max 50 item_id sekaligus)
POST /api/v2/product/add_item                → buat produk baru
POST /api/v2/product/update_item             → update produk
POST /api/v2/product/delete_item             → hapus permanen
POST /api/v2/product/unlist_item             → sementara nonaktifkan (unlist=true/false)
GET  /api/v2/product/search_item             → cari produk di toko
GET  /api/v2/product/get_item_extra_info     → views, likes, sales per produk
GET  /api/v2/product/get_item_limit          → batas listing per market (char limit, price range)
```

**Category & Attributes:**
```
GET  /api/v2/product/get_category            → category tree (WAJIB by shop_id!)
GET  /api/v2/product/get_attribute_tree      → atribut wajib/opsional per kategori
GET  /api/v2/product/get_brand_list          → list brand per kategori
POST /api/v2/product/category_recommend      → saran kategori berdasarkan nama produk
```

**Variant / Model Management:**
```
GET  /api/v2/product/get_model_list          → list variants (models) per produk
POST /api/v2/product/init_tier_variation     → setup variasi produk (Size, Color, dll)
POST /api/v2/product/update_tier_variation   → update nama/option variasi
POST /api/v2/product/add_model               → tambah variant baru
POST /api/v2/product/update_model            → update harga/stok per variant
POST /api/v2/product/delete_model            → hapus variant
```

**Stock & Price (Operasi Paling Sering Dipakai):**
```
POST /api/v2/product/update_stock            → update stok per item/model
     Body: { item_id, stock_list: [{ model_id, normal_stock }] }
     * Jika produk tanpa variasi: model_id tidak perlu

POST /api/v2/product/update_price            → update harga per item/model
     Body: { item_id, price_list: [{ model_id, original_price }] }
```

**Image & Media:**
```
POST /api/v2/media_space/upload_image        → upload gambar, dapat image_id
```

**Review / Comment:**
```
GET  /api/v2/product/get_comment             → ambil review per produk
POST /api/v2/product/reply_comment           → balas review (by comment_id)
```

**Promotion & Boost:**
```
POST /api/v2/product/boost_item              → boost produk (tingkatkan visibility)
GET  /api/v2/product/get_boosted_list        → list produk yang sedang di-boost
GET  /api/v2/product/get_item_promotion      → info promosi aktif per produk
```

**Compliance:**
```
GET  /api/v2/product/get_item_violation_info          → cek violations produk
GET  /api/v2/product/get_item_content_diagnosis_result → diagnosis konten produk
```

**Flow Membuat Produk (yang Benar):**
```
1. GET /api/v2/product/get_category         → ambil kategori yang sesuai (by shop_id!)
2. GET /api/v2/product/get_attribute_tree   → ambil atribut wajib kategori
3. GET /api/v2/product/get_item_limit       → cek batasan karakter & harga per market
4. GET /api/v2/logistics/get_channel_list   → ambil logistic_id (enabled=true)
5. POST /api/v2/media_space/upload_image    → upload gambar → dapat image_id
6. POST /api/v2/product/add_item            → buat produk dengan semua data di atas
7. POST /api/v2/product/init_tier_variation → setup variasi (jika ada)
8. POST /api/v2/product/add_model           → tambah model per kombinasi variasi
```

### 10.8 Return & Refund APIs Shopee — Lengkap

**Return statuses:**
- `REQUESTED` → buyer baru ajukan retur
- `PROCESSING` → sedang dalam proses
- `ACCEPTED` → seller accept
- `COMPLETED` → retur selesai
- `CANCELLED` → retur dibatalkan

**Endpoints:**
```
GET  /api/v2/returns/get_return_list         → list semua return (filter by status, date)
     Params: page_no, page_size, create_time_from/to, status, negotiation_status
GET  /api/v2/returns/get_return_detail       → detail 1 return by return_sn
POST /api/v2/returns/confirm                 → accept return request
POST /api/v2/returns/dispute                 → dispute return (upload bukti)
POST /api/v2/returns/offer                   → counter-offer ke buyer (solusi, jumlah refund)
POST /api/v2/returns/accept_offer            → accept offer dari buyer
GET  /api/v2/returns/get_available_solutions → cek solusi yang tersedia (return/refund)
GET  /api/v2/returns/get_return_dispute_reason → list alasan dispute
POST /api/v2/returns/upload_proof            → upload bukti (text + image + video)
GET  /api/v2/returns/query_proof             → query bukti yang sudah diupload
GET  /api/v2/returns/get_reverse_tracking_info → tracking retur (buyer kirim balik)
POST /api/v2/returns/cancel_dispute          → batalkan dispute
```

**Solutions untuk return:**
- `0` = Return and Refund (buyer kembalikan barang, uang dikembalikan)
- `1` = Refund Only (uang dikembalikan tanpa perlu kembalikan barang)

**AutoToko Automation Flow untuk Returns:**
```
Webhook Code 17 (RETURN_STATUS) diterima
    → GET return_detail untuk ambil info lengkap
    → Klasifikasi: low-value (< Rp50k) → auto-confirm
    → Medium-value → kirim notif Email ke user untuk review
    → High-value atau reason = "damaged" → auto-dispute dengan foto
    → Auto-generate reply ke buyer via chat
```

### 10.9 Finance APIs Shopee

```
GET /api/v2/payment/get_escrow_detail        → detail settlement per order_sn
GET /api/v2/payment/get_payment_list         → daftar pembayaran (pagination by date)
GET /api/v2/payment/get_payout_info          → info payout/withdrawal ke rekening bank
```

### 10.10 Logistics APIs Shopee

```
GET /api/v2/logistics/get_channel_list       → daftar kurir tersedia (enabled=true)
GET /api/v2/logistics/get_shipping_parameter → parameter shipping per order
POST /api/v2/logistics/ship_order            → ship single package
POST /api/v2/logistics/mass_ship_order       → batch ship multiple packages (same channel & warehouse)
GET  /api/v2/logistics/get_tracking_number   → ambil tracking number
POST /api/v2/logistics/create_shipping_document → generate AWB PDF
GET  /api/v2/logistics/get_shipping_document_result → cek status AWB (READY/FAILED/PROCESSING)
POST /api/v2/logistics/update_shipping_order → update tracking manual (non-integrated)
```

### 10.11 Chat APIs Shopee

```
GET  /api/v2/message/get_message             → ambil pesan dalam conversation
POST /api/v2/message/send_message            → kirim pesan ke buyer
GET  /api/v2/message/get_conversation_list   → daftar percakapan aktif
```

### 10.12 Promotion & Discount APIs Shopee

```
GET  /api/v2/discount/get_discount_list      → daftar promo aktif
POST /api/v2/discount/add_discount           → buat promo baru
POST /api/v2/discount/update_discount        → update promo
POST /api/v2/discount/end_discount           → akhiri promo lebih awal
POST /api/v2/discount/add_discount_item      → tambah produk ke promo
POST /api/v2/discount/update_discount_item   → update produk dalam promo
GET  /api/v2/shop_flash_sale/get_flash_sale_list → list flash sale tersedia
POST /api/v2/discount/add_voucher            → buat voucher
```

### 10.13 Ads APIs Shopee

```
POST /api/v2/ads/create_ad_campaign          → buat campaign iklan
GET  /api/v2/ads/get_ad_campaign_list        → list campaign
POST /api/v2/ads/update_ad_campaign          → update campaign (budget, status)
GET  /api/v2/ads/get_ad_report               → laporan performa iklan
POST /api/v2/product/boost_item              → boost produk (alternatif iklan sederhana)
```

### 10.14 Account Health APIs Shopee

```
GET /api/v2/account_health/shop_penalty      → penalti yang diterima toko
GET /api/v2/account_health/get_shop_performance → metrik performa toko
```

### 10.15 SDK Reference yang Direkomendasikan

**Package:** `@congminh1254/shopee-sdk` (npm, TypeScript)
- GitHub: https://github.com/congminh1254/shopee-sdk
- 100% endpoint coverage, 671 test cases
- Auto-signing, token auto-refresh, TypeScript types

**29 Managers tersedia:**
AuthManager, ProductManager, OrderManager, LogisticsManager, PaymentManager,
VoucherManager, DiscountManager, BundleDealManager, AddOnDealManager,
ShopFlashSaleManager, FollowPrizeManager, TopPicksManager, ShopCategoryManager,
ReturnsManager, AdsManager, AmsManager, AccountHealthManager, ShopManager,
MerchantManager, MediaManager, MediaSpaceManager, GlobalProductManager,
FirstMileManager, SbsManager, FbsManager, LivestreamManager, VideoManager,
PushManager, PublicManager

**⚠️ Catatan:** Meskipun SDK ini berguna sebagai referensi & type definitions, AutoToko menggunakan **n8n** untuk semua integrasi eksternal. SDK ini lebih cocok sebagai referensi type dan API endpoint documentation daripada dipakai langsung di kode NestJS.

### 10.16 Order Manager — Detail Lengkap

**Semua method penting OrderManager:**

```
getOrderList(params)
  → time_range_field: 'create_time' | 'update_time'
  → time_from/to: Unix timestamp
  → page_size: max 100
  → cursor: untuk pagination (bukan offset!)
  → order_status: filter opsional (UNPAID/READY_TO_SHIP/PROCESSED/SHIPPED/COMPLETED/CANCELLED)

getOrdersDetail(params)
  → order_sn_list: max 50 order sekaligus
  → response_optional_fields: ['buyer_user_id','buyer_username','recipient_address',
      'actual_shipping_fee','note','item_list','pay_time','package_list',
      'shipping_carrier','payment_method','total_amount','invoice_data']
  ⚠️ PENTING: Selalu include response_optional_fields untuk kurangi ukuran response

getShipmentList()      → orders ready to ship atau sudah di-ship
splitOrder()           → split 1 order jadi multiple packages (multi-warehouse)
unsplitOrder()         → revert split (hanya jika belum di-ship)
cancelOrder()          → cancel order (dengan cancel_reason code)
searchPackageList()    → cari packages by status, warehouse, logistics channel
handleBuyerCancellation() → approve/reject buyer's cancel request
addOrderNote()         → tambah catatan internal ke order
```

**Cancel Reason Codes yang Valid (Indonesia):**
- `OUT_OF_STOCK` — stok habis
- `CUSTOMER_REQUEST` — buyer minta cancel
- `UNDELIVERABLE_AREA` — area tidak bisa dikirim
- `COD_NOT_SUPPORTED` — COD tidak tersedia

**Paginasi Order (wajib cursor-based, bukan offset):**
```javascript
// BENAR — gunakan cursor
let cursor = '';
let hasMore = true;
while (hasMore) {
  const res = await getOrderList({ cursor, time_from, time_to, page_size: 100 });
  orders.push(...res.order_list);
  cursor = res.next_cursor;
  hasMore = res.more;
}
```

### 10.17 Logistics Manager — Detail Lengkap

**Complete Shipping Workflow (7 steps):**
```
Step 1: getOrdersDetail() → verifikasi status READY_TO_SHIP
Step 2: getChannelList() → ambil kurir yang tersedia (enabled: true)
Step 3: getShippingParameter(order_sn) → cek mode: pickup/dropoff/non_integrated
Step 4: getAddressList() → ambil pickup address (untuk mode pickup)
Step 5: shipOrder(order_sn, pickup/dropoff/non_integrated)
Step 6: getTrackingNumber(order_sn) → ambil tracking number
Step 7: getTrackingInfo(order_sn) → monitoring detail dengan event history
```

**3 Mode Shipping:**
```
pickup:        { address_id, pickup_time_id } → kurir jemput ke alamat seller
dropoff:       { branch_id, sender_real_name } → seller antar ke counter kurir
non_integrated: { tracking_number } → kurir sendiri (JNE, JT, SiCepat dll)
```

**Fitur tambahan Logistics:**
```
getPauseStatus()    → cek apakah logistics sedang di-pause
setPauseStatus()    → pause/resume logistics channel
getAddressList()    → list semua pickup address toko (dengan flag: pickup/return)
getTrackingInfo()   → array event tracking dengan timestamp & description lengkap
```

**Cache Strategy untuk Logistics:**
- Channel list: cache 1 jam (jarang berubah)
- Address list: cache 30 menit
- Tracking info: NO cache (real-time)

**Error Codes Logistics:**
| Code | Deskripsi | Solusi |
|---|---|---|
| `error_order_not_found` | Order tidak ditemukan | Verifikasi order_sn |
| `error_order_status` | Order belum READY_TO_SHIP | Cek status order |
| `error_logistics_channel` | Channel tidak valid | Pakai getChannelList() |
| `error_param` | Parameter tidak lengkap | Cek required fields |

### 10.18 Payment Manager — Detail Lengkap

**Finance Methods untuk Rekonsiliasi:**
```
getEscrowDetail(order_sn)
  → escrow_amount: yang seller terima setelah semua fee
  → buyer_total_amount: yang buyer bayar
  → transaction_fee, commission_fee, service_fee
  → seller_discount, shopee_discount (siapa yang menanggung diskon)
  → coins, voucher_from_seller, voucher_from_shopee
  → vat, seller_withholding_tax
  → buyer_payment_info: { payment_method, card_no }

getEscrowDetailBatch(order_sn_list)
  → max 50 order sekaligus (lebih efisien untuk rekonsiliasi bulk)

getEscrowList(release_time_from, release_time_to)
  → list semua order yang sudah di-settle dalam periode tertentu

getWalletTransactionList()
  → riwayat transaksi wallet seller (hanya local shop)

generateIncomeReport(start_time, end_time, currency)
  → trigger generate laporan → dapat income_report_id

getIncomeReport(income_report_id)
  → poll status: PENDING/PROCESSING/COMPLETED
  → jika COMPLETED: dapat download URL (PDF/Excel)

generateIncomeStatement()  → statement periode
getIncomeStatement()       → poll + download statement

getPaymentMethodList()     → list payment methods tersedia (NO auth needed)
```

**Response Structure getEscrowDetail (kritis untuk laporan keuangan AutoToko):**
```json
{
  "order_income": {
    "escrow_amount": 85000,       ← Yang masuk ke kantong seller
    "buyer_total_amount": 100000, ← Yang buyer bayar
    "actual_shipping_fee": 9000,
    "transaction_fee": 2000,      ← Fee ke Shopee
    "commission_fee": 3000,       ← Komisi Shopee
    "seller_discount": 1000,      ← Diskon yang seller tanggung
    "shopee_discount": 4000,      ← Diskon yang Shopee tanggung
    "coins": 0,
    "voucher_from_seller": 0,
    "voucher_from_shopee": 5000
  }
}
```

### 10.19 Ads Manager Shopee

**⚠️ PENTING: Advertising features butuh special permission dari Shopee!**
Harus request akses ke Shopee Partner Support sebelum bisa pakai ads API.

**⚠️ DEPRECATION: Auto Product Ads sedang di-deprecated. Pakai Manual Product Ads atau GMS Campaign.**

**Ads Methods:**
```
getTotalBalance()                    → cek saldo iklan
getRecommendedItemList()             → produk yang direkomendasikan untuk iklan
createManualProductAds(params)       → buat iklan produk manual
  → params: budget, start_date, item_id, roas_target, bidding_method
updateManualProductAds(params)       → update iklan (budget, status, dll)
getManualProductAdsList(params)      → list semua iklan aktif
```

**KPI Ads (untuk laporan performa):**
- **Broad**: performa setelah click iklan (termasuk produk lain yang dibeli)
- **CTR**: Click-Through Rate = Clicks / Impressions × 100%
- **CR**: Conversion Rate = Conversions / Clicks × 100%
- **ROAS**: Return on Ad Spend

### 10.20 Flash Sale & Voucher Manager Shopee

**Flash Sale (ShopFlashSaleManager):**
```
getTimeSlotId(start_time, end_time)  → ambil slot waktu yang tersedia
createShopFlashSale(timeslot_id)     → buat flash sale
addShopFlashSaleItems(flash_sale_id, items)
  → items: [{ item_id, purchase_limit, models: [{ model_id, promo_price, stock }] }]
updateShopFlashSale(flash_sale_id, status)  → 1=enable, 2=disable
getShopFlashSaleList(type)           → type: 1=upcoming, 2=ongoing, 3=expired
getItemCriteria()                    → min/max discount, min rating, min orders per kategori
```

**Voucher (VoucherManager):**
```
addVoucher(params)
  → voucher_type: 1=shop voucher, 2=product voucher
  → reward_type: 1=fixed amount, 2=percentage, 3=coins cashback
  → min_basket_price: minimum belanja
  → max_price: cap maksimum diskon (untuk percentage)
  → usage_quantity: max pemakaian

updateVoucher(voucher_id, params)   → update voucher aktif
deleteVoucher(voucher_id)           → hapus voucher
getVoucherList(params)              → list semua voucher
getVoucherDetail(voucher_id)        → detail 1 voucher
addVoucherCode(voucher_id, codes)   → tambah kode spesifik ke voucher
```

### 10.21 Shop Manager Shopee

```
getShopInfo()     → shop_name, status, region, rating, response_time, etc.
getProfile()      → description, shop logo URL, shop banner
updateProfile()   → update shop_name, shop_logo, description
getWarehouseDetail()   → warehouse info: warehouse_id, address_id, full_address
```

### 10.22 Account Health Manager Shopee

```
getShopPerformance()   → seller metrics: late dispatch rate, non-fulfillment rate, etc.
getShopPenalty()       → penalti yang diterima toko (jika ada)
```

**Metrics penting untuk monitoring:**
- `late_shipment_rate`: % order yang terlambat di-ship
- `non_fulfillment_rate`: % order yang gagal di-fulfill
- `overall_star_rating`: rating keseluruhan toko
- `response_rate`: % chat yang dibalas

**AutoToko harus monitor ini dan alert seller jika mendekati batas punishment Shopee.**

### 10.23 Sandbox Testing Shopee

**Environment:**
```
Sandbox URL: https://openplatform.sandbox.test-stable.shopee.sg
```

**2 Tipe Test Account:**
- **Core Function:** product, order, fulfillment dasar — gratis, tanpa KYC
- **Full Function:** semua fitur termasuk payment, finance — butuh KYC Shopee

**Setup Sandbox:**
1. Register di Shopee Open Platform Console
2. Buat app (sandbox mode)
3. Gunakan base URL sandbox untuk semua API calls
4. Test account dibuat langsung di Partner Center

**Perbedaan Sandbox vs Production:**
- Token berbeda (tidak bisa pakai production token di sandbox)
- Data terpisah, tidak mempengaruhi real shop
- Rate limit lebih longgar
- Webhook bisa di-test dengan test payload tool

### 10.24 V2.0 Data Definition — Tipe Data Penting

**Common field types:**
```
Unix Timestamp → detik sejak 1 Jan 1970 (10 digit, bukan milliseconds!)
order_sn       → string unique identifier per order di Shopee
item_id        → integer, ID produk di Shopee
model_id       → integer, ID variant/model produk
shop_id        → integer, ID toko yang diauthorize
partner_id     → integer, ID developer/partner
```

**Shopee API Flow Diagrams (dari Developer Guide ID:27):**

```
1. Create Item Flow:
   get_category → get_attribute_tree → upload_image → add_item → init_tier_variation → add_model

2. Order Status Flow:
   UNPAID → READY_TO_SHIP → PROCESSED → SHIPPED → COMPLETED
         ↘ CANCELLED        ↗ split possible

3. Package Fulfillment Flow:
   getShipmentList → getShippingParameter → shipOrder → getTrackingNumber → getShippingDocument

4. Arrange Shipment Flow:
   get_shipping_parameter → ship_order (pickup/dropoff/non_integrated)
   → get_tracking_number → create_shipping_document → poll get_shipping_document_result
```

---

## BAGIAN 11: API REFERENCE TIKTOK SHOP (YANG DIBUTUHKAN)

### 11.1 Base URL TikTok Shop
```
Production: https://open-api.tiktokglobalshop.com
```

### 11.2 Request Format TikTok
```
Headers:
  Content-Type: application/json
  x-tts-access-token: {access_token}

Query params (SETIAP request):
  app_key: {app_key}
  sign: {HMAC-SHA256 signature}
  timestamp: {10-digit Unix timestamp, ±5 menit}
```

### 11.3 Signature TikTok
```
sorted_params = sort_alphabetically(all_params EXCEPT sign dan access_token)
base_string = app_secret + join(key+value for key,value in sorted_params) + app_secret
sign = HMAC-SHA256(base_string, app_secret)
```

### 11.4 OAuth Flow TikTok
Lihat dokumen: `AUTOPILOT_SELLER_KNOWLEDGE_BASE.md` Bagian 4

**Key difference TikTok:** access_token expire 7 hari (lebih lama dari Shopee)

### 11.5 Key APIs TikTok Shop
```
// Authorization
GET /authorization/202309/token          → exchange code + refresh token

// Shop
GET /seller/202309/shops                 → get authorized shops

// Products
GET /product/202309/products             → list produk
GET /product/202309/products/{id}        → detail produk
POST /product/202309/products            → create produk
PUT  /product/202309/products/{id}       → update produk
DELETE /product/202309/products          → delete produk
POST /product/202309/images/upload       → upload gambar

// Orders
GET /order/202309/orders/search          → search orders by status
GET /order/202309/orders                 → batch get order detail
POST /order/202309/orders/cancel         → cancel order

// Fulfillment
POST /fulfillment/202309/packages/ship   → ship package (generate AWB)
GET  /fulfillment/202309/packages        → list packages

// Logistics
GET /logistics/202309/warehouses         → list warehouse
GET /logistics/202309/delivery_options   → delivery options

// Finance
GET /finance/202309/payments/statements  → settlement statements
GET /finance/202309/payments             → payment list

// Customer Engagement
POST /customer_service/202309/messages/send → kirim pesan
```

### 11.6 Webhooks TikTok Shop
Event yang penting:
- `ORDER_STATUS_CHANGE` → trigger auto-approve & workflow
- `RETURN_STATUS_UPDATE` → trigger after-sales workflow
- `PRODUCT_STATUS_UPDATE` → alert jika produk di-suspend
- `SELLER_DEAUTHORIZE` → hapus token dari DB

---

## BAGIAN 12: n8n WORKFLOW DESIGN

### 12.1 Workflow yang Harus Dibuat di n8n

| Workflow Name | Trigger | Keterangan |
|---|---|---|
| `tiktok-order-webhook` | HTTP Webhook (TikTok POST) | Process order events TikTok |
| `shopee-order-webhook` | HTTP Webhook (Shopee POST) | Process order events Shopee |
| `token-refresh-scheduler` | Cron: */3 jam | Auto-refresh Shopee token |
| `tiktok-token-refresh` | Cron: Harian | Auto-refresh TikTok token |
| `auto-approve-order` | Triggered by webhook WF | Logic approve order |
| `ai-chat-buyer` | Triggered by webhook WF | AI reply pembeli |
| `ai-chat-affiliate` | Triggered by schedule/event | AI chat affiliator |
| `auto-reply-review` | Triggered by webhook WF | AI reply review |
| `daily-report` | Cron: 23:55 harian | Generate laporan harian |
| `weekly-report` | Cron: Senin 07:00 | Generate laporan mingguan |
| `product-sync` | Cron: Setiap 6 jam | Sync produk & stok |
| `activate-ads` | Cron: 07:00 harian | Aktifkan iklan |
| `trend-analysis` | Cron: 08:00 harian | Analisis tren market |
| `product-health-check` | Cron: Minggu malam | Evaluasi katalog |
| `restock-alert` | Triggered by order | Cek stok bahan |
| `affiliate-search` | Cron: 2x seminggu | Cari affiliator baru |
| `billing-deduct` | Triggered by order | Potong fee dari wallet |
| `balance-alert` | Cron: Harian | Alert wallet hampir habis |

### 12.2 n8n ↔ NestJS Communication
- n8n memanggil **internal REST API** NestJS untuk operasi database
- NestJS memanggil **n8n Webhook** untuk trigger workflow
- Autentikasi: shared secret key (header X-Internal-Token)

---

## BAGIAN 13: MOBILE APP (React Native)

### 13.1 Fitur Mobile (Monitor & Quick Trigger Only)

**Dashboard:**
- Total order hari ini
- Revenue hari ini  
- Alert penting (stok habis, produk di-suspend, balance rendah)

**Order Monitor:**
- Notifikasi push order masuk
- Lihat list order per toko
- Lihat detail order
- Manual approve/reject order (jika auto-approve OFF)

**Quick Triggers:**
- Pause/resume automation per toko
- Top-up balance
- Lihat saldo wallet
- Approve rekomendasi eliminasi produk

**Notifications:**
- Push notification untuk semua alert penting
- Deep-link ke halaman terkait

**TIDAK ada di mobile:**
- CRUD master produk (web only)
- Setup affiliate (web only)
- Manage kredensial (web only)
- Admin panel (web only)

---

## BAGIAN 14: KEAMANAN & COMPLIANCE

### 14.1 Keamanan Data
- Token marketplace: AES-256 encryption at rest
- API credentials admin: AES-256 encryption at rest
- HTTPS everywhere (TLS 1.3)
- Database: PostgreSQL dengan row-level security
- Redis: password protected, TLS enabled

### 14.2 Data User
- Password tidak ada (OTP only) → tidak ada risiko password leak
- WhatsApp/email disimpan dengan hashing di log
- GDPR-ready: user bisa minta hapus data

### 14.3 API Security
- Rate limiting pada semua endpoint API internal
- IP whitelist untuk admin panel
- Audit log semua aksi admin
- WebSocket dengan JWT auth

---

## BAGIAN 15: CHECKLIST DEVELOPMENT — URUTAN PRIORITAS

### Phase 1 (MVP - 3 bulan)
- [ ] Setup infrastruktur Docker (NestJS + PostgreSQL + Redis + n8n + Next.js)
- [ ] Database schema & migrations
- [ ] Auth: WhatsApp OTP + Email OTP
- [ ] Admin CMS: credential management
- [ ] Connect toko: TikTok Shop OAuth
- [ ] Connect toko: Shopee OAuth
- [ ] Token auto-refresh (keduanya)
- [ ] Sync order dari TikTok & Shopee
- [ ] Webhook receiver (TikTok & Shopee)
- [ ] Dashboard: overview order & revenue
- [ ] Master produk: CRUD + link ke postingan via SKU
- [ ] Auto-approve order (basic)
- [ ] Billing: wallet + top-up Midtrans
- [ ] Per-transaction fee deduction
- [ ] Laporan harian (basic)
- [ ] Notif Email untuk event penting

### Phase 2 (Month 4-6)
- [ ] AI chat buyer (Claude API)
- [ ] AI reply review
- [ ] Auto-generate AWB
- [ ] Duplicate postingan produk
- [ ] BOM mapping + restock alert
- [ ] Posting produk ke marketplace via platform
- [ ] Product health score
- [ ] Laporan bulanan + export Excel
- [ ] Mobile app (React Native) — basic dashboard

### Phase 3 (Month 7-9)
- [ ] Affiliate management (cari, tandai, undang, chat)
- [ ] AI chat affiliate
- [ ] Auto-activate ads
- [ ] Trend analysis
- [ ] Product optimization AI suggestions
- [ ] Auto-apply marketplace events
- [ ] Eliminate product workflow
- [ ] Advanced analytics dashboard

---

## BAGIAN 16: ENVIRONMENT VARIABLES YANG DIPERLUKAN

```env
# App
NODE_ENV=production
APP_URL=https://app.autotoko.id
ADMIN_URL=https://admin.autotoko.id

# Database
DATABASE_URL=postgresql://user:pass@postgres:5432/autopilot
REDIS_URL=redis://:password@redis:6379

# Auth
JWT_SECRET=xxx
JWT_EXPIRES_IN=1h
REFRESH_TOKEN_SECRET=xxx
REFRESH_TOKEN_EXPIRES_IN=30d

# Encryption
ENCRYPTION_KEY=xxx   # 32-byte AES-256 key

# TikTok Shop
TIKTOK_APP_KEY=xxx
TIKTOK_APP_SECRET=xxx
TIKTOK_REDIRECT_URL=https://app.autotoko.id/auth/tiktok/callback

# Shopee
SHOPEE_PARTNER_ID=xxx
SHOPEE_PARTNER_KEY=xxx
SHOPEE_REDIRECT_URL=https://app.autotoko.id/auth/shopee/callback

# WhatsApp (RECEIVE ONLY — untuk login mechanism)
# WA hanya MENERIMA pesan dari user untuk proses login, TIDAK mengirim notifikasi
WA_AUTOTOKO_NUMBER=628xxxxxxxxx  # Nomor WA AutoToko yang menerima pesan login dari user
WA_WEBHOOK_SECRET=xxx            # Secret untuk verifikasi webhook n8n incoming WA

# SendGrid (Email — SEMUA outgoing notification)
SENDGRID_API_KEY=xxx
SENDGRID_FROM_EMAIL=noreply@autotoko.id
SENDGRID_FROM_NAME=AutoToko

# Claude AI
ANTHROPIC_API_KEY=xxx

# Midtrans
MIDTRANS_CLIENT_KEY=xxx
MIDTRANS_SERVER_KEY=xxx
MIDTRANS_IS_PRODUCTION=true

# n8n
N8N_WEBHOOK_BASE_URL=http://n8n:5678
N8N_INTERNAL_TOKEN=xxx   # shared secret

# Internal API
INTERNAL_API_TOKEN=xxx   # untuk n8n ↔ NestJS

# Revo Print
REVO_PRINT_API_KEY=xxx
REVO_PRINT_API_URL=https://api.revoprint.id

# MinIO / Storage
MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_ACCESS_KEY=xxx
MINIO_SECRET_KEY=xxx
MINIO_BUCKET=autotoko
```

---

## BAGIAN 17: CATATAN KHUSUS UNTUK DEVELOPER

1. **Shopee token expire 4 JAM** — ini yang paling kritikal. WAJIB ada job refresh setiap 3 jam. Jangan sampai token expired saat order masuk.

2. **TikTok rate limit dynamic** — makin banyak user connect toko, makin besar quota. Implement request queue per toko dari awal.

3. **Webhook idempotency** — marketplace bisa kirim event yang sama lebih dari 1x. Selalu cek `webhook_events` table sebelum proses.

4. **SKU matching** — ini jantung dari master produk. Query yang perlu dioptimasi dengan index: `WHERE marketplace_sku = master_sku AND user_id = ?`

5. **Multi-tenant isolation** — semua query WAJIB include `user_id` dalam WHERE clause. Gunakan PostgreSQL Row Level Security (RLS) untuk proteksi ekstra.

6. **n8n + NestJS communication** — gunakan event-driven: NestJS emit event → n8n listen via webhook. Jangan coupling langsung.

7. **AI chat context** — ketika Claude menjawab chat, sertakan: riwayat chat 10 pesan terakhir, detail produk yang dibeli, status order, kebijakan toko. Ini critical untuk jawaban yang relevan.

8. **Balance check sebelum automation** — setiap kali automation dijalankan, cek dulu apakah user punya saldo cukup. Jika tidak, pause automation + kirim notif.

9. **Shopee category per shop** — category tree Shopee berbeda per market/shop. Jangan cache category global. Cache per shop_id.

10. **TikTok shop_cipher** — parameter ini diperlukan untuk beberapa TikTok API call. Simpan bersama shop data saat OAuth.

---

## BAGIAN 18: BRANDING & WHITE-LABEL SYSTEM

### 18.1 Nama Aplikasi
**AutoToko** — nama brand resmi platform ini.

### 18.2 Branding Dikelola dari CMS Admin
Semua elemen brand bisa diubah tanpa deploy ulang, langsung dari Admin CMS:

| Elemen | Deskripsi | Tipe Data |
|---|---|---|
| **Nama Aplikasi** | Default: "AutoToko" | string |
| **Logo** | Upload file PNG/SVG, tampil di navbar, login page, email | file upload |
| **Favicon** | Icon kecil di browser tab | file upload |
| **Primary Color** | Warna utama UI (button, header, accent) | hex color |
| **Secondary Color** | Warna aksen kedua | hex color |
| **Background Color** | Warna latar utama | hex color |
| **Text Color** | Warna teks utama | hex color |
| **Font** | Pilih dari preset Google Fonts | select |
| **Tagline** | Kalimat di bawah logo di halaman login | string |
| **Email Sender Name** | Nama pengirim email OTP & notif | string |
| **WA Greeting Message** | Template pembuka pesan WA otomatis | text |
| **Footer Text** | Teks footer di semua halaman web | string |
| **Meta Title** | SEO title default | string |
| **Meta Description** | SEO description default | string |
| **Favicon Color** | Warna favicon jika tidak upload gambar | hex color |

### 18.3 Implementasi Branding di Frontend
- Branding config disimpan di `admin_settings` table dengan prefix `brand_`
- Di-serve via endpoint publik: `GET /api/public/branding`
- Frontend Next.js load branding saat startup → inject sebagai CSS variables
- Contoh CSS variables yang di-generate dinamis:
```css
:root {
  --color-primary: #1E40AF;
  --color-secondary: #7C3AED;
  --color-bg: #F8FAFC;
  --color-text: #1E293B;
  --font-family: 'Inter', sans-serif;
}
```
- Logo & favicon diload dari MinIO storage URL yang tersimpan di config
- Semua email template menggunakan branding yang sama (inline CSS dari config)

### 18.4 WhatsApp — RECEIVE ONLY (untuk Login Mechanism)

**⚠️ KOREKSI PENTING: WhatsApp di AutoToko = RECEIVE ONLY.**
- AutoToko **TIDAK** mengirim pesan WA keluar (tidak ada notifikasi via WA)
- WhatsApp hanya digunakan untuk **menerima** pesan dari user sebagai mekanisme login
- Semua notifikasi keluar menggunakan **Email via SendGrid**

**Setup n8n untuk WA Login:**
- Buat workflow n8n: `autotoko-wa-login-receiver`
- Trigger: Webhook yang menerima incoming WA message dari user
- Logic:
  ```
  1. Terima incoming message dari user WA
  2. Ekstrak: nomor WA pengirim + isi pesan
  3. Parse kode login dari pesan (e.g. "AutoToko-9823X7 https://...")
  4. Validasi kode ke backend: POST /auth/wa-login/verify
  5. Backend mark session sebagai verified
  6. Frontend (polling) detect verified → redirect ke dashboard
  ```

**Config di Admin CMS:**
- `WA_AUTOTOKO_NUMBER`: Nomor WA AutoToko yang menerima pesan login dari user
- `WA_WEBHOOK_SECRET`: Secret untuk verifikasi incoming webhook dari WA API

### 18.5 Email Notification System (SendGrid)

**Semua notifikasi keluar menggunakan Email:**

```
NestJS → SendGrid API → Email user
```

**n8n Workflows untuk Email:**
- `autotoko-email-sender`: workflow generik untuk kirim email via SendGrid
- Input format: `{ to, subject, template_id, dynamic_template_data }`

**SendGrid Dynamic Templates yang perlu dibuat:**
- `login-otp` — OTP untuk email login
- `welcome` — Email selamat datang user baru
- `daily-report` — Laporan harian order & revenue
- `weekly-report` — Laporan mingguan performa
- `monthly-report` — Laporan bulanan + export link
- `low-wallet-alert` — Alert saldo wallet hampir habis
- `restock-alert` — Alert stok bahan kritis + link supplier
- `token-expire-alert` — Alert token toko hampir expire
- `product-suspended` — Alert produk disuspend marketplace
- `topup-confirmation` — Konfirmasi top-up wallet berhasil

**Config di Admin CMS:**
- `SENDGRID_API_KEY`: API key SendGrid
- `SENDGRID_FROM_EMAIL`: Email pengirim (noreply@autotoko.id)
- `SENDGRID_FROM_NAME`: Nama pengirim (sesuai branding dari Admin CMS)

---

## BAGIAN 19: RUANG IMPROVISASI CLAUDE CODE

> ⚡ **SECTION INI KHUSUS UNTUK CLAUDE CODE**
>
> PRD di atas adalah panduan utama, tapi tidak mungkin mencakup 100% detail implementasi.
> Claude Code DIIZINKAN dan DIDORONG untuk melakukan improvisasi pada hal-hal berikut,
> selama tetap sesuai dengan arsitektur dan business logic yang sudah ditetapkan.

### 19.1 Area yang Boleh Diimprovisasi Claude Code

#### A. UX/UI Design
- Desain halaman, layout, color scheme default, animasi, micro-interaction
- Pilihan komponen Shadcn/UI yang paling sesuai untuk setiap fitur
- Responsive breakpoints dan mobile-first decisions
- Loading states, skeleton screens, empty states
- Toast notifications, modal design, form validation UX
- Onboarding wizard steps & copy

#### B. Error Handling & Edge Cases
- Semua skenario error yang belum disebutkan di PRD
- Retry logic detail (berapa kali, delay berapa lama)
- Graceful degradation ketika API marketplace down
- Conflict resolution ketika data tidak sinkron antara platform & marketplace
- Handling marketplace API changes/breaking changes

#### C. Performance Optimization
- Database query optimization, index yang diperlukan
- Caching strategy detail (apa yang di-cache, TTL berapa)
- Lazy loading strategy untuk dashboard dengan banyak data
- Pagination strategy (cursor-based vs offset-based per use case)
- Background job batching untuk operasi massal

#### D. Security Details
- Input validation & sanitization detail
- SQL injection protection patterns
- XSS prevention
- CSRF token implementation
- Rate limiting rules per endpoint
- Helmet.js configuration
- Content Security Policy headers

#### E. Notification System Detail
- Template WA message untuk setiap skenario (tulis copy yang natural & friendly)
- Email template design
- In-app notification grouping & priority
- Notification preferences per user (bisa opt-out mana saja)
- Push notification payload untuk mobile app

#### F. AI Prompt Engineering
- System prompt detail untuk AI chat buyer (gaya bahasa, batasan, eskalasi rules)
- System prompt untuk AI chat affiliate (lebih formal, business-oriented)
- System prompt untuk AI reply review
- System prompt untuk trend analysis
- System prompt untuk product optimization suggestions
- Context window management (apa yang dimasukkan ke context, apa yang tidak)
- Token usage optimization

#### G. n8n Workflow Detail
- Error handling di tiap node n8n
- Retry mechanism dalam workflow
- Dead letter queue untuk failed webhooks
- Logging & monitoring tiap workflow
- Workflow versioning strategy

#### H. Admin CMS Tambahan
- Dashboard analytics yang lebih detail
- Bulk operations (suspend banyak user sekaligus, dll)
- Export data capability
- System health dashboard (API quota usage, error rates, dll)
- Feature flags per user atau per paket yang lebih granular

#### I. Developer Experience
- API documentation (Swagger/OpenAPI)
- Seed data untuk development
- Test fixtures untuk unit test
- Mock marketplace API untuk testing
- Docker development setup yang mudah

#### J. Business Logic yang Belum Terdefinisi
- Apa yang terjadi jika dua order masuk bersamaan untuk stok yang sama (race condition)
- Logika retry untuk payment yang gagal
- Logika dunning (reminder bertahap) untuk user yang saldo habis
- Logika suspend bertahap (warning → soft suspend → hard suspend)
- Referral/affiliate program untuk user platform (bukan seller-affiliator)
- Logika prorate jika user upgrade/downgrade paket di tengah bulan
- Kebijakan refund setup fee

### 19.2 Hal yang TIDAK Boleh Diubah Claude Code (Fixed Requirements)

❌ **JANGAN ganti** tech stack utama tanpa konfirmasi (Next.js, NestJS, PostgreSQL, Redis, n8n, React Native)  
❌ **JANGAN ganti** WhatsApp API ke Twilio atau layanan lain  
❌ **JANGAN hilangkan** konsep master produk & SKU matching  
❌ **JANGAN ganti** struktur multi-tenant (setiap data WAJIB punya user_id)  
❌ **JANGAN ubah** business model (wallet + per-transaksi + subscription)  
❌ **JANGAN implement** fitur yang mengakibatkan delete data permanen tanpa konfirmasi user  
❌ **JANGAN expose** credential/token marketplace ke client-side/frontend  
❌ **JANGAN bypass** billing check sebelum menjalankan automation  

### 19.3 Cara Claude Code Mendokumentasikan Improvisasi

Setiap kali Claude Code menambahkan sesuatu yang tidak ada di PRD, **tulis komentar** dalam kode:

```typescript
// [AutoToko Improvisation] Reason: PRD tidak specify retry logic untuk token refresh.
// Implementasi: exponential backoff 3x dengan delay 1s, 2s, 4s sebelum mark shop sebagai disconnected.
```

Dan update file `IMPROVISATION_LOG.md` dengan format:
```markdown
## [Tanggal] [Nama Fitur]
**Area:** Error Handling
**Keputusan:** Implement exponential backoff 3x untuk token refresh failure
**Alasan:** Prevent false disconnect ketika network blip sementara
**Impact:** Shop tidak langsung di-disconnect karena 1x failure
```

### 19.4 Prioritas Improvisasi

Ketika Claude Code menemukan ambiguitas atau celah di PRD, **urutan prioritas pengambilan keputusan:**

1. **Security first** — jika ada trade-off antara UX dan keamanan, pilih keamanan
2. **User tidak kehilangan data** — lebih baik automation gagal daripada data rusak
3. **Fail gracefully** — selalu ada fallback, selalu ada notifikasi ke user
4. **Performance** — optimize query/cache sebelum scale infrastructure
5. **DRY code** — buat abstraksi yang baik untuk pola yang berulang (marketplace adapter pattern sangat disarankan)

### 19.5 Marketplace Adapter Pattern (SANGAT DISARANKAN)

Claude Code SANGAT DIANJURKAN untuk implement **Adapter Pattern** untuk integrasi marketplace:

```typescript
// Interface yang sama untuk semua marketplace
interface MarketplaceAdapter {
  // Auth
  getAuthUrl(userId: string): string;
  exchangeToken(code: string, shopId: string): Promise<TokenData>;
  refreshToken(refreshToken: string): Promise<TokenData>;
  
  // Orders
  getOrders(shopId: string, filters: OrderFilters): Promise<Order[]>;
  approveOrder(shopId: string, orderId: string): Promise<void>;
  cancelOrder(shopId: string, orderId: string, reason: string): Promise<void>;
  
  // Products
  getProducts(shopId: string): Promise<Product[]>;
  createProduct(shopId: string, product: ProductData): Promise<string>;
  updateProduct(shopId: string, productId: string, data: Partial<ProductData>): Promise<void>;
  updateStock(shopId: string, updates: StockUpdate[]): Promise<void>;
  
  // Fulfillment
  shipOrder(shopId: string, packageId: string, data: ShipData): Promise<TrackingData>;
  getTrackingNumber(shopId: string, orderId: string): Promise<string>;
  
  // Chat
  sendMessage(shopId: string, conversationId: string, message: string): Promise<void>;
  getMessages(shopId: string, conversationId: string): Promise<Message[]>;
  
  // Finance
  getSettlements(shopId: string, dateRange: DateRange): Promise<Settlement[]>;
}

// Implementasi spesifik
class TikTokShopAdapter implements MarketplaceAdapter { ... }
class ShopeeAdapter implements MarketplaceAdapter { ... }
// Mudah tambah Tokopedia, Lazada nanti
class TokopediaAdapter implements MarketplaceAdapter { ... }

// Factory
class MarketplaceAdapterFactory {
  static create(marketplace: 'tiktok' | 'shopee' | 'tokopedia'): MarketplaceAdapter { ... }
}
```

Pattern ini akan membuat kode jauh lebih maintainable dan mudah tambah marketplace baru.

---

## BAGIAN 20: CATATAN INTEGRASI WHATSAPP (xtracker reference)

### 20.1 Konteks
User (owner) sudah punya WhatsApp API yang berjalan di n8n pada project **xtracker**.
AutoToko menggunakan WA yang sama dengan project xtracker — **hanya untuk menerima pesan masuk dari user**.

### 20.2 Yang Perlu Dilakukan
1. Di n8n (instance AutoToko atau shared dengan xtracker), buat workflow:
   - **`autotoko-wa-login-receiver`**: Menerima incoming WA → ekstrak kode login → verifikasi ke backend
2. Backend AutoToko expose endpoint: `POST /auth/wa-login/verify`
3. n8n memanggil endpoint ini saat ada pesan WA masuk dari user

### 20.3 Flow Lengkap WA Login

```
Frontend AutoToko:
  1. Generate kode: "AutoToko-9823X7" → simpan di Redis (TTL 5 menit)
  2. Generate callback_token unik
  3. Redirect user ke:
     wa.me/628xxx?text=AutoToko-9823X7%20https%3A%2F%2Fautotoko.id%2Fauth%2Fwa-callback%3Ftoken%3D{callback_token}
  4. Mulai polling: GET /auth/wa-login/status?token={callback_token} setiap 2 detik

Sisi User:
  5. WhatsApp terbuka dengan pesan pre-filled
  6. User klik Send/Kirim
  7. Pesan terkirim dari nomor WA user ke nomor WA AutoToko

n8n (autotoko-wa-login-receiver):
  8. Terima webhook incoming WA message
  9. Ekstrak: wa_number (nomor pengirim) + text (isi pesan)
  10. Parse kode dari text: "AutoToko-9823X7 https://..."
  11. POST /auth/wa-login/verify { code: "AutoToko-9823X7", wa_number: "628xxx" }

Backend (NestJS):
  12. Validasi kode ada di Redis dan belum expired
  13. Mark session sebagai VERIFIED dengan wa_number
  14. Buat/temukan user berdasarkan wa_number
  15. Generate JWT token

Frontend (polling response):
  16. Status = verified → simpan JWT → redirect ke /dashboard
```

### 20.4 Format WA Message yang Diterima

```
Format yang user kirim: "AutoToko-XXXXXX https://autotoko.id/auth/wa-callback?token=yyy"

n8n regex untuk ekstrak kode:
  const match = message.text.match(/AutoToko-([A-Z0-9]{6,8})/);
  const code = match ? 'AutoToko-' + match[1] : null;
```

**⚠️ CATATAN:** AutoToko **TIDAK PERLU** mengirim pesan WA balik ke user. Login berhasil dideteksi oleh frontend via polling, bukan via WA reply.

---

*Dokumen ini adalah single source of truth untuk development AutoToko.*  
*Update terakhir: Juni 2026*  
*Nama resmi aplikasi: **AutoToko***
