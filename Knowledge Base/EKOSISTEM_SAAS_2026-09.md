# AutoToko — Ekosistem SaaS & Fase 0–1 (September 2026)

Ringkasan kerja besar 14–15 September 2026: merapikan ekosistem, mulai fitur
Fase 1, dan mengeraskan fondasi multi-tenant (SaaS). Semua di branch `develop`.
Cetak biru visual: artifact "Cetak Biru Ekosistem AutoToko"
(https://claude.ai/code/artifact/a2a5d482-ba4f-47b8-86d9-ca3c3face645).

> Doktrin bentuk: **APK = take-action** (scan/packing/aksi lapangan); **Web =
> take-action + monitoring**. Halaman monitoring → web-only.
> Dua sumber data tetap DNA: **API marketplace** × **scan/input manual** (manual
> = audit atas API; nominal manual null = "tidak tahu", bukan nol).

---

## 1. Fulfillment & status pesanan (perbaikan)

- Alur 5 langkah: **Menunggu Disetujui (masuk) → Menunggu Dicetak (approved) →
  Menunggu Dipacking (packing) → Menunggu Dipickup (siap_kirim) → Dalam
  Pengiriman (dikirim)**; selesai/retur/dibatalkan terminal.
- `AWAITING_SHIPMENT` marketplace → `masuk` (bukan `approved`). Order baru
  berbayar mulai di "Menunggu Disetujui".
- **Auto-siap-kirim DIHAPUS**, diganti **Auto Setujui/Auto Proses**: bila
  diaktifkan, order BARU yang **sudah dibayar** (AWAITING_SHIPMENT) otomatis
  `masuk → approved` saat sync (kurir instant dikecualikan). Saklar pakai kolom
  lama `order_settings.auto_siap_kirim` (di-repurpose). UNPAID tidak di-auto.
- `orders.createdAt` API kini = **create_time bawaan marketplace** (bukan waktu
  sync), pada insert + re-sync (COALESCE).
- Hanya 4 status **1-on-1** dgn marketplace: Menunggu Disetujui, Dalam
  Pengiriman, Dibatalkan, Selesai. Dicetak/Dipacking/Dipickup = rincian internal
  (di marketplace masih "siap kirim").
- **Status = sumber tunggal**: backend `GET /orders/status-meta`; web pakai
  `apps/web/src/lib/orderStatus.ts`; APK (rilis 5.13) menariknya via
  `Api.orderStatusMeta()` (fallback lokal). Ubah label = cukup deploy backend.

## 2. Fase 0 — rapikan ekosistem

- **Kesehatan Pesanan** (web-only monitoring, `/kesehatan-pesanan`,
  `GET /orders/health`): 5 sinyal dua-sumber read-only — belum-discan (60hr),
  discan-tanpa-API, SKU belum-dipetakan, order tanpa nominal, **isi terbaca ≠
  pesanan** (auto-cocok qty `resi_scan_items` vs `orders.items`).
- **Navigasi 6+1 domain default** (Layout `DEFAULT_SECTIONS`) bila belum dikustom.
- **Konsolidasi dashboard**: `/` = Dashboard v2 (laba bersih); lama →
  `/dashboard-ringkas`; `/dashboard-v2` tetap alias.
- Gambar produk di kartu order (web+APK), packing list pakai nama master produk
  (fallback nama postingan + varian).

## 3. Fase 1 — fitur

- **Scan-verify packing**: scan resi packer SUDAH jadi verifikasi packing; item
  yang terbaca saat scan (`resi_scan_items`) dibandingkan OTOMATIS dgn item
  pesanan → ditandai di Kesehatan Pesanan (bukan checklist manual). APK ≤5.15.
- **Chat Pelanggan** (`/chat`): fondasi (tabel `marketplace_conversations`/
  `marketplace_messages` + RLS, modul `chat`, inbox web, `syncChat` di
  marketplace-sync). **Live butuh approval khusus CS API** (lihat §5).
- **Retur & Refund** (`/retur`): fondasi (tabel `marketplace_returns` + RLS,
  `syncReturns`/`listReturns`, panel web monitoring). **Live butuh scope
  Reverse Order** (scope standar).
- Balasan chat & setujui/tolak retur (tulis-balik) = aksi manual + konfirmasi,
  menyusul saat scope aktif.

## 4. SaaS — isolasi (S1) & metering (S2)

- **S1 isolasi (KRITIS, diperbaiki):** audit menemukan **kebocoran lintas-tenant
  nyata** — app konek sebagai OWNER; RLS yang tidak `FORCE` dilewati owner. 9
  tabel ber-`user_id` (termasuk `staff_accounts`/password-hash & `marketplace_
  statements`/keuangan) bocor → di-`FORCE` + policy form `NULLIF` aman-bypass.
  Ditambah 9 tabel ANAK (tenant lewat FK: resi_scan_items, product_postings,
  master_product_variants, dst) ditutup policy subquery. Semua di
  `apps/backend/rls/enable-rls.sql`.
- **Eskalasi hak Portal ditutup**: token portal sub-seller (principalType,
  sub=tenant asli) dulu bisa tembus ~25 controller (opt-in @TenantOwnerOnly cuma
  6/31) → `jwt-auth.guard` sekarang **default-deny** portal kecuali `@PortalOnly`.
- **Sisa S1**: `webhook_events` & `wallet_transactions` — jalur webhook/billing
  punya mekanisme konteks yang belum jelas (perlu trace runtime + webhook uji di
  sesi interaktif); JANGAN ubah blind.
- **S2 metering (aman)**: `GET /account/usage` + kartu "Pemakaian bulan ini" di
  halaman Paket (toko/order vs batas, saldo, fee). **Penegakan keras/gating
  sengaja BELUM** (bisa menghentikan operasi live) — keputusan kebijakan.

## 5. API TikTok — status & kontrak

Terpakai: order search, fulfillment (ship+docs), product search/get.

Fondasi baru (dorman sampai scope/approval aktif), kontrak dari dok resmi
partner.tiktokshop.com (base `https://open-api.tiktokglobalshop.com`, semua +
common params app_key/sign/timestamp/shop_cipher + header x-tts-access-token):

- **Customer Service (chat) v202309** — scope `seller.customer_service`,
  **BUTUH APPROVAL KHUSUS** (≥1000 seller / ≥1jt call-hari / app kategori
  "TikTok Shop Seller"). Endpoint: `GET /customer_service/202309/conversations`
  (page_size max 20), `GET .../conversations/{id}/messages` (max 10, ada
  `plaintext`; `content` = JSON string `{"content":"…"}`), `POST .../messages`
  (body `{type:"TEXT", content: JSON.stringify({content})}` → `data.message_id`).
  Webhook: New Conversation / New Message. Role: BUYER/SHOP/CUSTOMER_SERVICE.
- **Return & Refund (Reverse Order) v202309** — scope standar. `POST
  /return_refund/202309/returns/search` (body filter: return_status/type/
  create_time_ge/…; page_size 10–50). Resp `data.return_orders[]`: return_id,
  order_id, return_type, return_status, refund_amount, return_line_items
  (product_image), seller_next_action_response[{action,deadline}], total_count,
  next_page_token.

Belum dipakai (peluang): withdrawal/settlement (Finance), inventory/price update
(Product-write → push stok/harga), product create/edit, promotion/voucher,
analytics.

## 6. APK — rilis

Skrip `apps/scanner/rilis-apk.sh` (verifikasi sidik kunci produksi sebelum
menyentuh `/opt/autotoko/downloads`, timpa APK kanonik, sisipkan releases.json,
verifikasi sha256 unduhan). Update DITAWARKAN (bukan paksa). Terakhir **5.15/56**.

## 7. Yang menunggu keputusan/aksi pemilik

1. **Aktifkan scope TikTok**: Reverse Order (retur live) → paling dekat;
   CS API (chat live) → ajukan approval; Product-write/Finance → Fase 2/3.
2. **Kebijakan penegakan billing (S2 keras)** — kapan blokir/ gating saldo.
3. **Sesi interaktif** untuk 2 tabel isolasi terakhir (webhook/billing).

Prinsip data yang mengikat semua: data manual jangan rusak/hilang; migrasi
aditif; di SaaS "jangan rusak data" berkembang jadi "jangan bocorkan data
lintas-tenant" — audit RLS setiap tabel/endpoint baru sebelum menambah tenant.


## 8. Ledger fase (per 15 September 2026)

- **Fase 0** rapikan ekosistem — SELESAI (nav 6+1 domain, label status
  single-source, dsb).
- **Fase 1** fitur (fondasi) — SELESAI: Kesehatan Pesanan; Retur (baca;
  approve/reject = aksi live, dorman sampai scope); Chat (baca + antre balasan,
  kirim dorman sampai scope CS/approval).
- **Fase 2** stok omnichannel — SELESAI & LIVE: `GET /inventory/omnichannel`
  + halaman **Stok Omnichannel** (habis / menipis / tak-tahu + deteksi
  TAK-SINKRON antar listing dari master yang sama), read-only, dari data
  `marketplace_skus` yang sudah tersinkron. Data live: 821 SKU / 5 toko
  (142 habis, 96 tak-tahu, 1 master tak-sinkron). Push stok/harga = homework.
- **Fase 3** keuangan/settlement — FONDASI SUDAH ADA (non-scope selesai):
  statement di-import (XLSX / OCR bukti pencairan) -> rekonsiliasi vs order
  (`/statements/reconcile`, halaman Rekonsiliasi) -> surface di Audit &
  DashboardV2 ("Uang masuk") -> feed HPP / biaya-marketplace. Modul payout
  lengkap (sub-seller berjenjang, batch, mutasi, disbursement, profit). Sisa =
  auto-sync Finance API (homework).
- **Fase 4** listing/promo — Kesehatan Katalog ADA. Sisa (promo/voucher,
  product create/edit, push listing) SELURUHNYA butuh Product-write /
  Promotion scope = homework.
- **SaaS S1** isolasi RLS — SELESAI kecuali 2 tabel (webhook_events,
  wallet_transactions) yang butuh sesi interaktif. **S2** metering terpasang;
  penegakan keras menunggu kebijakan pemilik.

Catatan jujur: di luar Fase 2, tak ada kode NON-SCOPE & non-redundan yang
tersisa untuk Fase 3/4 — membangun lagi hanya menduplikasi surface yang ada
(Rekonsiliasi/Laporan/Pencairan; Katalog) atau butuh scope/kontrak yang belum
aktif. Maka fase "diselesaikan" = bagian yang bisa dibangun sudah dibangun;
sisanya di-ledger sebagai homework, bukan ditutup diam-diam.

### Homework (menunggu scope/approval + verifikasi kontrak)
Kontrak di bawah BELUM diverifikasi ke dok resmi (butuh sesi Chrome/interaktif);
jangan dipakai sebelum diverifikasi:
- **Product-write (push stok/harga)** — pola seperti push-nama; `POST
  /product/202309/products/{id}/partial_edit` sudah LIVE untuk title. Untuk
  stok/harga: endpoint update inventory / update price v202309 — VERIFIKASI
  nama path & bentuk body saat scope aktif. Tulisan keluar ke listing live ->
  WAJIB aksi manual + konfirmasi, tak pernah otomatis.
- **Finance (withdrawal/settlement)** — auto-tarik settlement/transaction
  menggantikan import XLSX manual. VERIFIKASI endpoint (statement/transaction
  search) + scope Finance.
- **Promotion/voucher** — kelola promo/voucher. VERIFIKASI endpoint + scope
  Promotion.
- **CS chat live** — butuh APPROVAL KHUSUS (bukan sekadar toggle scope).
- **Reverse Order (retur live)** — scope standar, paling dekat diaktifkan.
