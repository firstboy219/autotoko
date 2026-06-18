# AUTOPILOT SELLER ONLINE — KNOWLEDGE BASE
## TikTok Shop Open API: Complete Technical Reference for Claude Code

**Tanggal dibuat:** Juni 2026  
**Sumber:** Dibaca langsung dari partner.tiktokshop.com/docv2 via browser automation  
**Tujuan:** Panduan lengkap untuk membangun SaaS AutoToko

---

## 1. DESKRIPSI PRODUK & BUSINESS MODEL

### Apa itu AutoToko?
SaaS multi-tenant yang mengotomasi operasi seller di TikTok Shop.  
- **User** = pemilik online shop yang mendaftar ke platform kita
- **Setiap user bisa menambahkan/sync banyak toko TikTok Shop** yang mereka miliki
- **Business model: Pay-per-transaction** — user dikenakan biaya setiap kali ada transaksi/order yang diproses melalui platform

### Kategori Developer di TikTok
Kita termasuk kategori: **"eCommerce SaaS Developer / eCommerce System Integrator"**  
Menurut dokumentasi resmi TikTok: developer yang membuat sistem eCommerce untuk manage advertising, product promotion, marketing, dan fungsi bisnis lainnya.  
**Konsekuensi:** Kita WAJIB menyimpan OAuth credentials (access_token, refresh_token) dan data seller di database kita.

### Jenis App yang Harus Dibuat
- **Public App** — terdaftar di TikTok Shop App Store, bisa di-discover seller
- Harus melalui app review process TikTok
- Seller authorize app dari Seller Center App Store
- Cocok untuk SaaS yang mau banyak user

---

## 2. ARSITEKTUR API TIKTOK SHOP

### Base URL (Production)
```
https://open-api.tiktokglobalshop.com
```

### Format Endpoint
```
https://open-api.tiktokglobalshop.com/{category}/{version}/{resource}
```
Contoh: `GET https://open-api.tiktokglobalshop.com/authorization/202309/token`

### HTTP Methods yang Didukung
- `GET` — baca data
- `POST` — kirim/buat data
- `PUT` — update data
- `DELETE` — hapus data

### Versi API
- Format versi: `YYYYMM` (contoh: `202309`, `202407`)
- Versi baru dirilis setiap bulan
- Setiap versi dijamin tersedia minimum 2 bulan sebelum deprecated
- Pengumuman deprecated di Changelog minimal 2 bulan sebelumnya
- **Versi aktif saat ini:** `202309` (terbaru, gunakan ini sebagai default)

---

## 3. AUTHENTICATION & AUTHORIZATION (KRITIS!)

### Request Headers Wajib
```
Content-Type: application/json
x-tts-access-token: {access_token}
```

### Common Query Parameters Wajib (SETIAP request)
| Parameter | Lokasi | Tipe | Deskripsi | Contoh |
|---|---|---|---|---|
| `app_key` | Query | string | Unique key dari Partner Center | `29a39d` |
| `sign` | Query | string | HMAC-SHA256 signature | `bc721f0e...` |
| `timestamp` | Query | Unix timestamp | 10-digit, valid range: [now-5min, now+30sec] | `1623812664` |

### Request Signing (HMAC-SHA256) — WAJIB di setiap request
**Algoritma:** HMAC-SHA256  
**Private key:** App Secret dari Partner Center (JANGAN expose ke client)  
**Aturan signing:**
1. Kumpulkan semua query parameters (KECUALI `sign` dan `access_token`)
2. Sort alphabetically
3. Concatenate: `{app_secret}{key1}{val1}{key2}{val2}...{app_secret}`
4. Hash dengan HMAC-SHA256
5. Timestamp harus dalam ±5 menit dari waktu server TikTok

**Error umum signing:**
- App Key & Secret tidak cocok
- Salah urutan parameter saat sorting
- Menggunakan SHA-256 biasa bukan HMAC-SHA256
- sign atau access_token ikut di-sign (tidak boleh!)

---

## 4. OAUTH FLOW (CARA USER CONNECT TOKO MEREKA)

### Alur Lengkap OAuth untuk SaaS Multi-tenant

```
User klik "Connect TikTok Shop"
    → Redirect ke TikTok Auth URL
    → User login & approve scopes di TikTok
    → TikTok redirect ke Redirect URL kita dengan ?auth_code=xxx
    → Backend kita tukar auth_code ke access_token
    → Simpan token di database kita
    → Dashboard user tampilkan toko berhasil terhubung
```

### Step 1: Generate Authorization Link
Setelah app dibuat di Partner Center, generate auth link dari Partner Center console.  
**PENTING:** auth_code:
- Expire dalam **30 menit**
- Hanya bisa digunakan **1 kali**
- Setelah seller klik link → di-redirect ke Redirect URL kita dengan `?auth_code=xxx`

### Step 2: Tukar auth_code → access_token + refresh_token
```
GET https://open-api.tiktokglobalshop.com/authorization/202309/token
```

**Query Parameters:**
| Parameter | Tipe | Required | Deskripsi |
|---|---|---|---|
| `app_key` | string | Ya | App key dari Partner Center |
| `app_secret` | string | Ya | App secret dari Partner Center |
| `auth_code` | string | Ya | Auth code dari step 1 |
| `grant_type` | string | Ya | Nilai: `authorized_code` |

**Response:**
```json
{
  "access_token": "TTP_RLM6CIADWF606TZGFO5XGA",
  "access_token_expire_in": 1630401330,
  "refresh_token": "TTP_C2XWDN63ON-FOHJSMR0WSG",
  "refresh_token_expire_in": 1630401510,
  "open_id": "jKlhBwAAAA...",
  "seller_name": "Test Seller",
  "seller_base_region": "ID",
  "user_type": 0
}
```

**Keterangan response:**
- `access_token` — dipakai di header setiap request, **expire 7 hari**
- `refresh_token` — untuk generate access_token baru
- `open_id` — ID unik user TikTok yang authorize
- `seller_base_region` — region asal seller (contoh: "ID" untuk Indonesia)
- `user_type` — `0` = Seller, `1` = Creator

### Step 3: Refresh access_token (SEBELUM expire)
```
GET https://open-api.tiktokglobalshop.com/authorization/202309/token
```

**Query Parameters:**
| Parameter | Tipe | Deskripsi |
|---|---|---|
| `app_key` | string | App key |
| `app_secret` | string | App secret |
| `refresh_token` | string | Refresh token yang tersimpan |
| `grant_type` | string | Nilai: `refresh_token` |

**Response sama dengan Step 2** — dapat access_token baru + refresh_token baru

### Seller Deauthorize
Jika seller cabut izin app → trigger **[Seller deauthorization] webhook**  
Kita harus handle webhook ini untuk hapus/invalidate token di database.

### Authorization untuk Test/Development
- App yang masih "in development" tidak bisa diauthorize oleh seller online (production)
- Gunakan **Seller Center Development Shops** (dari Partner Center) untuk testing
- Test account: langsung ke authorization approval step tanpa perlu auth link

---

## 5. ENTITY TAG & TOKEN TYPE

Ada 4 tipe entity dalam API Reference:

| Entity Tag | Level | Token yang Diperlukan | Fungsi |
|---|---|---|---|
| **Seller** | Seller account level | Seller access token (user_type=0) | Cross-shop operations, global product, seller metadata |
| **Shop** | Shop level | Shop access token | Operasi per-toko: produk, order, fulfillment |
| **Creator** | Creator account level | Creator access token (user_type=1) | Data creator, affiliate orders, open collaboration |
| **Asset** | Partner campaign level | Partner access token + category asset cipher | Affiliate marketing campaigns |

**Untuk AutoToko:** fokus pada **Seller** dan **Shop** entity tags.

---

## 6. ACCESS SCOPES (IZIN YANG HARUS DIMINTA SAAT SUBMIT APP)

### Tipe Scope
- **Public** — semua developer otomatis dapat akses setelah app dibuat
- **Custom** — data sensitif, harus apply khusus via: Partner Console → App & Service → Manage → Manage API

### Daftar Scope yang Dibutuhkan AutoToko

| Scope Name | Fungsi | Tipe |
|---|---|---|
| Shop Authorized Information | Akses shop ID seller | Public |
| Product Basic | Baca info produk, sync katalog | Public |
| Product Modify | Edit produk, atribut, status, sync stok | Public |
| Product Delete & Recover | Hapus & pulihkan produk dari showcase | Public |
| Order Information | Akses semua order data real-time | Public |
| Fulfillment Basic | Fulfill & kelola order, update status pengiriman | Public |
| Package Split And Combine | Pecah & gabungkan order | Public |
| Update Delivery Status | Push status delivered untuk 3PL | Public |
| Logistics Basic | Info logistik, warehouse, delivery options, kurir | Public |
| Promotion Information | Lihat daftar promo & event | Public |
| Promotion Modify | Buat & kelola diskon, promosi | Public |
| Global Shop Information | Akses info global shop (cross-border seller) | Public |
| Global Product Information | Akses info produk global | Public |
| Global Product Modify | Kelola produk global | Public |
| Global Product Delete | Hapus produk global | Public |
| Global Category Information | Info kategori global | Public |
| Finance (settlement) | Statement, payment, transaksi | **Custom*** |

**\* Finance scope perlu apply khusus, proses review 2-3 hari.**  
**PENTING:** Semua scope didaftarkan saat submit app — TIDAK bisa ditambah tanpa review ulang.

---

## 7. DOMAIN API & CAPABILITIES

### 7.1 Authorization API
- Get Authorized Category Assets
- Get Authorized Shops — **GET shop list yang sudah diauthorize user**

### 7.2 Seller API
**Fungsi:** Retrieve active shop(s) seller, check global product permission
- Seller-Shop relationship:
  - Local seller (Indonesia): 1 Seller → 1 Shop
  - Cross-border: 1 Seller → banyak Shop (1 per negara: shop_ID, shop_US, shop_UK, dst)
- `GET Active Shop List` — daftar toko aktif seller
- `GET Global Product Permission` — cek apakah toko bisa listing global product

### 7.3 Products API
**Fungsi:** CRUD produk, sync katalog, update harga & stok

**5-Step Flow untuk Posting Produk (Indonesia/SEA):**
1. Check Listing Prerequisites (optional tapi sangat disarankan)
2. Get Warehouse List → Get Categories → Get Category Rules → Get Attributes (+ opsional: Get Brands)
3. Upload Product Image (+ opsional: Upload Product File)
4. Check Product Listing (validasi, optional tapi sangat disarankan)
5. Create Product

**Konsep penting:**
- **Product:** item untuk dijual, punya unique product_id
- **Category:** predefined TikTok, struktur pohon, semua produk WAJIB punya kategori
- **Attribute:** konten tambahan, terikat ke kategori (berbeda tiap kategori)
- **SKU:** variant produk, punya stock & price sendiri
- TikTok review produk setelah dibuat atau diedit
- Jika live product gagal review setelah edit → versi lama tetap live
- Parameter `need_audit_version=true` di Get Product Detail → lihat versi yang sedang direview
- Produk bisa di-deactivate/freeze TikTok karena policy violation (ada Product webhook)

**Endpoints penting:**
- `GET /product/202309/products` — list produk
- `GET /product/202309/products/{product_id}` — detail produk
- `POST /product/202309/products` — create produk
- `PUT /product/202309/products/{product_id}` — update produk
- `DELETE /product/202309/products` — delete produk
- `POST /product/202309/images/upload` — upload gambar
- `GET /product/202309/categories` — list kategori

### 7.4 Orders API
**Fungsi:** Baca order, update status, manage lifecycle

**Order States (lifecycle):**
```
UNPAID → AWAITING_SHIPMENT → AWAITING_COLLECTION → IN_TRANSIT → DELIVERED → COMPLETED
              ↓
         PARTIALLY_SHIPPING
              ↓
          CANCELLED
```

**Konsep penting:**
- Order dibuat saat buyer klik "Place Order" → status awal: UNPAID
- Seller harus deduct/hold inventory begitu order dibuat (SEBELUM bayar!)
- **Order ID:** unique per order
- **SKU ID:** 1 order bisa punya banyak SKU
- **rts_sla:** deadline Ready To Ship. Lewat batas = late dispatch rate naik → kena penalti
- **Remorse period:** 1 jam setelah bayar → buyer bisa cancel TANPA approval seller
- Setelah remorse period → buyer minta cancel, butuh approval seller
- TikTok auto-cancel & refund buyer jika tracking info tidak valid atau melewati SLA
- **Buyer info REDACTED** untuk order dari buyer region yang berbeda dari seller region

**Status transitions yang perlu diperhatikan:**
- `UNPAID → CANCELLED`: buyer cancel atau TikTok cancel (timeout pembayaran)
- `AWAITING_SHIPMENT → AWAITING_COLLECTION`: seller arrange shipment (semua item)
- `AWAITING_COLLECTION → IN_TRANSIT`: kurir pickup
- `AWAITING_COLLECTION → CANCELLED`: TikTok cancel karena tracking tidak valid
- `COMPLETED → COMPLETED` (after-sales): seller atau TikTok bisa partial/full refund

**Endpoints penting:**
- `GET /order/202309/orders/search` — search orders (filter by status, date)
- `GET /order/202309/orders` — get order detail batch
- `POST /order/202309/orders/cancel` — cancel order
- Subscribe: **Order Status Update webhook** — real-time notifikasi perubahan status

### 7.5 Fulfillment API
**Fungsi:** Proses pengiriman order

**2 Tipe Fulfillment:**

**a) Fulfilled by TikTok (FBT)**
- TikTok auto-proses order atas nama seller
- Seller tidak perlu manage fulfillment
- API tidak banyak digunakan

**b) Fulfilled by Seller (FBS) ← FOKUS UTAMA INDONESIA**
- Sub-tipe 1 — **TikTok Shipping (TIKTOK):** Seller beli label dari TikTok, jadwal pickup/dropoff di carrier TikTok
- Sub-tipe 2 — **Seller Shipping (SELLER):** Seller pakai kurir sendiri (JNE, JT, SiCepat, dll.)

**Alur FBS:**
1. Seller package barang
2. Arrange shipment (call API Ship Package)
3. Provide tracking number (khusus Seller Shipping)
4. Kurir pickup → status jadi AWAITING_COLLECTION
5. Kurir deliver → IN_TRANSIT → DELIVERED

**Split Order:**
- 1 order bisa di-split jadi beberapa package
- Semua package harus di-arrange sebelum order jadi AWAITING_COLLECTION
- Konsolidasi tersedia untuk region SEA (termasuk Indonesia) & LATAM

**Catatan penting:**
- Setelah seller arrange shipment → buyer TIDAK bisa cancel tanpa approval seller
- Verify kurir supported by TikTok untuk cegah auto-cancel

**Endpoints penting:**
- `POST /fulfillment/202309/packages/ship` — ship package (generate AWB)
- `GET /fulfillment/202309/packages` — get package list
- `POST /fulfillment/202309/packages/delivery_status` — update delivery status (3PL)

### 7.6 Logistic API
**Fungsi:** Info warehouse, kurir, delivery options

**Endpoints:**
- `GET /logistics/202309/warehouses` — daftar warehouse seller
- `GET /logistics/202309/delivery_options` — subscribed delivery options
- `GET /logistics/202309/shipping_providers` — daftar kurir tersedia
- `GET /logistics/202309/global_warehouses` — warehouse global (cross-border)

**Konsep:**
- Seller bisa punya banyak warehouse per shop
- Seller bisa punya banyak global warehouse
- Warehouse = titik kirim paket

### 7.7 Finance API
**Fungsi:** Laporan keuangan, rekonsiliasi (BUTUH Custom scope)

| Endpoint | Fungsi |
|---|---|
| `GET Statements` | Statement harian (settled), filter by payment status |
| `GET Payments` | Daftar pembayaran by date range — untuk rekonsiliasi dengan rekening bank |
| `GET Transactions by Statement` | Daftar order dalam 1 statement_id |
| `GET Transactions by Order` | Detail transaksi per order (sampai level SKU) |
| `GET Unsettled Transactions` | Transaksi yang belum di-settle |

**PENTING:** Tidak ada API untuk withdrawal. Withdrawal harus manual di Seller Center.

### 7.8 Return and Refund API
- Proses return request dari buyer
- Manage seller-initiated cancel
- Update refund status
- Track return shipment

### 7.9 Promotion API
- `GET /promotion/202309/promotions` — daftar promo
- `POST /promotion/202309/promotions` — buat promo
- `PUT /promotion/202309/promotions/{id}` — update promo

### 7.10 Analytics API
- Data performa produk, konversi, traffic

### 7.11 Affiliate Creator API
- Filter & invite creator berdasarkan kriteria (niche, follower, conversion)
- Track komisi affiliasi per creator
- Analisis ROI per creator
- **Creator token diperlukan (bukan seller token)**

### 7.12 Events API (Webhook Management via API)
- Subscribe/unsubscribe webhook topics via API (Method 2, selain via Partner Center)

### 7.13 Customer Service & Customer Engagement API
- Handle chat/pesan customer
- Review management

---

## 8. WEBHOOKS

### Konfigurasi Webhook
**Method 1: Via Partner Center**
- Masuk Partner Center → App → Developing tab → Basic information → HTTP Server URL
- TikTok auto-subscribe default webhook topics
- Bisa manage (add/remove) di Developing tab

**Method 2: Via Events API**
- Subscribe/unsubscribe programmatically

### Persyaratan Webhook Endpoint
- HTTPS (bukan HTTP)
- TLS v1.2+
- Domain name saja (bukan IP address, tidak boleh ada port)
- Harus balas `200` untuk sukses, `401` untuk auth failure
- Balas SECEPAT MUNGKIN (proses di background queue)

### Webhook Events yang Penting untuk AutoToko

| Event | Trigger | Action yang Kita Lakukan |
|---|---|---|
| Order Status Update | Status order berubah (apapun) | Trigger auto-workflow, notif user, update dashboard |
| New Order | Order baru dibuat (UNPAID) | Notif user, deduct inventory, mulai workflow produksi |
| Order Recipient Address Updated | Buyer update alamat | Update AWB jika sudah generate, notif user |
| Return Status Updated | Buyer ajukan retur | Mulai workflow after-sales, notif user |
| Product Status Updated | Produk di-review/freeze/deactivate TikTok | Alert user segera |
| Seller Deauthorization | Seller cabut akses app | Hapus/invalidate token di database |

### Aturan Handling Webhook (KRITIS)
1. **Balas HTTP 200 DULU** baru proses di background → jangan proses sync/blocking
2. **Webhook tidak 100% reliable** → implementasikan scheduled polling sebagai backup
3. **Idempotency handler** → cegah duplikat event (TikTok bisa kirim event yang sama >1x)
4. **Jangan rely 100% pada webhook** → kombinasikan webhook + polling periodik

---

## 9. RATE LIMITS (DYNAMIC QPS)

### Cara Kerja Rate Limit TikTok (BERBEDA dari marketplace lain!)
- **BUKAN fixed QPS** — quota dihitung dinamis
- Formula: **jumlah toko yang authorize app kita × karakteristik API endpoint**
- Makin banyak user connect toko mereka ke Autopilot → makin besar quota kita
- TikTok tidak publish angka QPS-nya — kita harus adaptive

### Respon Kode Throttle
- `429` — too many requests (bisa karena kita over-limit ATAU platform throttle)
- `503` — platform overload
- Penanganan SAMA untuk keduanya: backoff & retry

### Error Codes Rate Limit
- `36009002` — Too many requests → exponential backoff

### 5 Best Practices Rate Limit (URUTAN PRIORITAS)

1. **Exponential backoff + jitter** saat dapat 429/503
   - Jangan retry langsung → tunggu, tambah waktu tunggu secara eksponensial
   - Tambah jitter (randomisasi) untuk cegah thundering herd

2. **Request Queue Internal** — maintain queue, dispatch dengan rate terkontrol
   - Jangan burst banyak request dalam 1 detik
   - Proses queue secara smooth/merata

3. **Fetch Minimum yang Diperlukan**
   - Jangan full-table pull jika bisa incremental sync
   - Request hanya field yang benar-benar dibutuhkan

4. **Cache Data Statis**
   - Cache: kategori produk, shop config, category mappings, master data
   - Data ini jarang berubah — kurangi API traffic drastis

5. **Idempotency + Tiered Error Handling**
   - Semua write operations (create/update) harus idempotent → cegah duplikat
   - Bedakan: 429 / 503 / business error / network error → response berbeda

### Batasan Paginasi
- Batch endpoint = **1 request** (bukan per item dalam batch)
- Selalu gunakan batch API jika tersedia
- Max item per request bervariasi per endpoint (lihat docs masing-masing)

---

## 10. COMMON ERRORS & HANDLING

| Error Code | Pesan | Solusi |
|---|---|---|
| `36009002` | Too many requests | Exponential backoff, lihat Rate Limits |
| `36009007` | Request timeout | Retry atau pecah jadi request lebih kecil |
| `36009009` | Invalid path | URL endpoint salah, cek docs |
| `36009010` | Invalid method | HTTP method tidak supported (GET vs POST) |
| `36009004` | Invalid identifier | shop_id atau version salah, ambil dari Get Authorized Shops |
| `36004004` | Invalid auth code | auth_code expired/sudah dipakai → minta ulang |
| `0` | Success | Response code 0 = sukses |

---

## 11. REGIONS & LOCALIZATION

### Indonesia (Target Utama AutoToko)
- **Country code:** `ID`
- **Locale code:** `id-ID`
- Gunakan `id-ID` di semua API call yang support localization → response Bahasa Indonesia

### Semua Region yang Didukung TikTok Shop
| Negara | Country Code | Default Locale |
|---|---|---|
| Indonesia | ID | id-ID |
| Malaysia | MY | ms-MY |
| Thailand | TH | th-TH |
| Philippines | PH | en-PH |
| Singapore | SG | en-SG |
| Vietnam | VN | vi-VN |
| United States | US | en-US |
| United Kingdom | GB | en-GB |
| Brazil | BR | pt-BR |
| France | FR | fr-FR |
| Germany | DE | de-DE |
| Italy | IT | it-IT |
| Japan | JP | ja-JP |
| Mexico | MX | es-MX |
| Spain | ES | es-ES |
| Ireland | IE | en-IE |

**Catatan:** Ada halaman khusus "Link to Tokopedia & Shop — ISV & Seller Developer Onboarding" di docs TikTok yang mengindikasikan integrasi khusus untuk pasar Indonesia (TikTok Shop + Tokopedia). Perlu diselidiki lebih lanjut.

---

## 12. SELLER TYPES (PENTING UNTUK DATABASE DESIGN)

| Tipe Seller | Deskripsi | Jumlah Toko |
|---|---|---|
| **Local Seller** | Jual di negara yang sama dengan entitas bisnis. Tidak ada import/export. | **Maks 1 toko lokal** |
| **Global Seller** | Jual ke banyak negara, cross-border. | **1 toko per negara target** |
| **Intra-EU Seller** | Entitas di 1 negara EU, jual ke negara EU lain | **1 toko per negara EU** |

**Konsekuensi Database Design:**
- 1 user Autopilot bisa punya banyak toko (jika Global/Intra-EU seller)
- Setiap toko punya `shop_id` + `shop_cipher` UNIK
- Database harus: `users` → `shops[]` → `{shop_id, shop_cipher, access_token, refresh_token, expire_at, region}`
- `shop_id` dan `shop_code` di TikTok: **TIDAK BISA DIUBAH** setelah dibuat

---

## 13. SHOP STATES (STATE MACHINE)

```
start (+base_region)
    → new_create
        → pending (submit files)
            → rejected ← → re-submit → pending
            → active (onboard approved)
                → deactivated (GNE ban/suspend)
                    → active (activate/cancel the ban)
                    → closing (open publicity period)
                → closing (open publicity period for shop closure)
                    → withdraw (complete closure process)
                    → deactivated (interrupted publicity period)
```

**Autopilot harus track state ini dan alert user jika toko mereka `deactivated`, `rejected`, atau `closing`.**

---

## 14. APP SCORING & TIERING (DAMPAK JANGKA PANJANG)

Sistem penilaian TikTok untuk developer app:
- **Tier:** Gold → Silver → Bronze → Standard
- **Metrics:** Reliability (SLA), Seller CSAT, Feature Completeness, Market Impact, Business Performance
- **Manfaat Gold tier:** Priority API bandwidth, Featured di App Store, 1:1 dedicated support
- **Pilot di:** US (lalu roll out global)
- **Kategori:** ERP, Multi-Channel Management, Order Management, Customer Support, dll.

**Strategi:** Bangun dengan reliability tinggi dari awal → target Gold tier secepatnya.

---

## 15. APP DEVELOPMENT LIFECYCLE

### Langkah Setup App di Partner Center

**Step 1: Register Developer** di partner.tiktokshop.com

**Step 2: Create App**
- Pilih tipe: **Public App** (untuk SaaS)
- Isi: App name, description, kategori, icon
- Set **Redirect URL** — URL di server kita untuk terima auth_code
- Set **HTTP Server URL** — webhook endpoint kita
- Dapatkan: `app_key` dan `app_secret`
- Apply scopes yang dibutuhkan

**Step 3: Development & Testing**
- Buat **Seller Center Development Shops** di Partner Center
- 2 tipe test account:
  - **Core Function Account:** basic testing (product, order, fulfillment) — GRATIS
  - **Full Function Account:** semua fitur termasuk payment, KYC diperlukan
- Core function: akses lewat windowed view di Partner Center
- Full function: akses lengkap Seller Center termasuk finance API

**Step 4: App Review**
- Public app wajib melalui TikTok app review process
- Custom app (untuk 1 seller spesifik): tidak perlu review

**Step 5: Launch**
- App terdaftar di TikTok Shop App Store
- Seller bisa discover dan authorize dari Seller Center → Growth → App Store
- Seller authorize → redirect ke Redirect URL kita → OAuth flow selesai

### SDK yang Tersedia
- **Java SDK** — handle request signing & authentication
- **GoLang SDK**
- **Node.js SDK**
- SDK TIDAK support webhook processing (harus implement sendiri)
- SDK belum tersedia untuk semua developer (whitelist based)

---

## 16. ARSITEKTUR TEKNIS YANG HARUS DIBANGUN

### Database Schema (Minimum)

```
users
  - id (UUID)
  - email
  - name
  - subscription_plan
  - created_at

shops
  - id (UUID)
  - user_id (FK → users)
  - shop_id (dari TikTok)
  - shop_name
  - shop_region (ID, US, UK, etc.)
  - shop_cipher
  - seller_name
  - seller_base_region
  - open_id
  - access_token (ENCRYPTED)
  - access_token_expire_at (Unix timestamp)
  - refresh_token (ENCRYPTED)
  - refresh_token_expire_at (Unix timestamp)
  - shop_state (active/deactivated/closing/etc)
  - connected_at
  - last_sync_at

transactions (untuk billing per-transaksi)
  - id (UUID)
  - user_id (FK)
  - shop_id (FK)
  - tiktok_order_id
  - order_status
  - order_amount
  - platform_fee (yang kita charge)
  - billed_at
  - paid_at

webhook_events (untuk idempotency)
  - id (UUID)
  - event_type
  - tiktok_event_id
  - shop_id
  - payload (JSON)
  - processed_at
  - created_at
```

### Komponen Backend yang Wajib Dibangun

1. **OAuth Handler**
   - Generate auth link per user
   - Handle callback dari TikTok (terima auth_code)
   - Exchange auth_code → access_token + refresh_token
   - Simpan token terenkripsi di database

2. **Token Manager**
   - Scheduled job: cek token yang akan expire dalam 24 jam
   - Auto-refresh sebelum expire (gunakan refresh_token)
   - Handle jika refresh_token juga expired → notif user untuk re-connect

3. **Webhook Receiver**
   - HTTPS endpoint (domain, bukan IP)
   - Balas HTTP 200 SEGERA
   - Proses di background queue (job queue: Bull, Celery, etc.)
   - Idempotency: cek apakah event sudah pernah diproses

4. **Request Queue & Rate Limiter**
   - Internal queue per shop
   - Exponential backoff untuk 429/503
   - Cache: kategori, warehouse, shop config

5. **Sync Service**
   - Scheduled polling sebagai backup webhook
   - Sync order, produk, stok secara berkala
   - Rekonsiliasi data

6. **Billing Service**
   - Detect transaksi baru dari webhook atau polling
   - Charge user per transaksi
   - Payment gateway: Midtrans (Indonesia) atau Stripe

### Request Signing Implementation (Pseudocode)
```
function generateSign(params, appSecret):
  # 1. Remove 'sign' dan 'access_token' dari params
  filteredParams = removeKeys(params, ['sign', 'access_token'])
  
  # 2. Sort params alphabetically by key
  sortedParams = sort(filteredParams, by='key')
  
  # 3. Concatenate
  str = appSecret
  for (key, value) in sortedParams:
    str += key + value
  str += appSecret
  
  # 4. HMAC-SHA256
  signature = hmacSHA256(str, appSecret)
  return signature
```

---

## 17. BUSINESS LOGIC AUTOPILOT SELLER ONLINE

### Per-Transaction Billing Flow
```
1. Webhook: NEW_ORDER diterima
2. Validasi idempotency (cek webhook_events table)
3. Simpan order ke database kita
4. Hitung platform fee (contoh: Rp 200/order, atau persentase)
5. Charge user via payment gateway
6. Simpan record di transactions table
7. Trigger automation workflow (approve, AWB, produksi, dst.)
8. Update dashboard user
```

### Automation Workflows yang Bisa Dibangun

| Workflow | Trigger | API yang Dipakai |
|---|---|---|
| Auto-Approve Order | Webhook: NEW_ORDER | Order API: update status |
| Generate AWB | Webhook: AWAITING_SHIPMENT | Fulfillment API: ship package |
| Sync Stok | Setelah order confirmed | Product API: update inventory |
| Alert Stok Kritis | Inventory < threshold | Notif ke user |
| Auto-Reply Chat | Webhook: new chat message | Customer Engagement API |
| Auto-Reply Review | Review masuk | Customer Service API |
| Rekap Laporan Harian | Scheduled job | Finance API: statements |
| Sync Produk ke Semua Toko | User buat produk di Autopilot | Product API per toko |

---

## 18. CHECKLIST MEMULAI DEVELOPMENT

- [ ] Register developer account di partner.tiktokshop.com
- [ ] Buat Public App di Partner Center
- [ ] Catat `app_key` dan `app_secret`
- [ ] Set Redirect URL (OAuth callback endpoint)
- [ ] Set HTTP Server URL (webhook endpoint)
- [ ] Apply semua access scopes yang dibutuhkan
- [ ] Buat Seller Center Development Shop untuk testing
- [ ] Implement HMAC-SHA256 signing
- [ ] Implement OAuth flow (auth_code → token → refresh)
- [ ] Implement webhook receiver
- [ ] Implement token auto-refresh job
- [ ] Implement rate limit handling (exponential backoff + queue)
- [ ] Implement idempotency untuk webhook events
- [ ] Implement per-transaction billing
- [ ] Test semua flow dengan Development Shop

---

## 19. REFERENSI URL PENTING

| Halaman | URL |
|---|---|
| Partner Center | https://partner.tiktokshop.com |
| Developer Guide | https://partner.tiktokshop.com/docv2/page/tts-developer-guide |
| Authorization Guide (202309) | https://partner.tiktokshop.com/docv2/page/authorization-guide-202309 |
| Seller Auth Guide | https://partner.tiktokshop.com/docv2/page/seller-authorization-guide |
| Access Scope | https://partner.tiktokshop.com/docv2/page/access-scope |
| Sign API Request | https://partner.tiktokshop.com/docv2/page/sign-your-api-request |
| Rate Limits | https://partner.tiktokshop.com/docv2/page/rate-limits |
| Common Errors | https://partner.tiktokshop.com/docv2/page/common-errors |
| Order API Overview | https://partner.tiktokshop.com/docv2/page/order-api-overview |
| Fulfillment API Overview | https://partner.tiktokshop.com/docv2/page/fulfillment-api-overview |
| Finance API Overview | https://partner.tiktokshop.com/docv2/page/finance-api-overview |
| Webhook Config Guide | https://partner.tiktokshop.com/docv2/page/configuration-guide |
| Regions & Languages | https://partner.tiktokshop.com/docv2/page/regions-and-languages |
| Dev Shops Guide | https://partner.tiktokshop.com/docv2/page/seller-center-development-shops |
| App Category Selection | https://partner.tiktokshop.com/docv2/page/hulvi36o |
| API Versioning | https://partner.tiktokshop.com/docv2/page/api-versioning |
| API Testing Tool | https://partner.tiktokshop.com/docv2/page/api-testing-tool |
| Tokopedia x TikTok ID Onboarding | https://partner.tiktokshop.com/docv2/page/link-to-tokopedia-shop-isv-seller-developer-onboarding |

---

## 20. CATATAN KHUSUS INDONESIA

1. **Local Seller Indonesia:** Hanya 1 toko, seller_base_region = "ID", locale = "id-ID"
2. **Fulfillment:** Mayoritas pakai FBS + Seller Shipping (kurir lokal: JNE, JT, SiCepat, Anteraja, Pos)
3. **Split package:** Tersedia untuk SEA (termasuk ID) — implementasikan di fulfillment workflow
4. **Tokopedia integration:** Ada halaman khusus integrasi TikTok Shop + Tokopedia untuk Indonesia — perlu diteliti untuk kemungkinan cross-platform sync
5. **Bahasa Indonesia response:** Pass `id-ID` sebagai locale parameter untuk mendapatkan response dalam Bahasa Indonesia
6. **Waktu SLA:** rts_sla berbeda per region — untuk Indonesia perlu dicek di Seller Academy
7. **After-sales period:** Bervariasi per region — cek kebijakan Indonesia di Seller Academy

---

*Knowledge Base ini dibuat berdasarkan pembacaan langsung dari TikTok Shop Partner Center Documentation (Juni 2026). Selalu cek Changelog TikTok Shop untuk update terbaru sebelum implementasi.*
