# AutoToko — Relay Log (estafet antar-AI)

> Tujuan: catatan progres berurutan agar AI lain bisa melanjutkan tanpa kehilangan konteks.
> Sumber kebenaran lain: memory `autotoko-status.md`, `infra/DEPLOY.md`, PRD di `Knowledge Base/`.

## Akses cepat
- **Repo:** `/Users/mm/Projects/AutoToko` (branch `develop`). Push: `git@github-xtracker:...` (key `~/.ssh/xtracker_ed25519`).
- **SSH server:** `ssh -i /Users/mm/Projects/geoscan/LightsailDefaultKey-ap-southeast-1.pem ubuntu@13.212.182.48`
- **Backend live:** pm2 `autotoko-backend` :8090 → `https://apitoko.cosger.online`
- **Web:** `https://viewtoko.cosger.online` · **Admin CMS:** `https://viewtoko.cosger.online/admin/`
- **JANGAN ganggu** xtracker / geoscan / shared postgres / n8n.
- **Secrets baru** (ADMIN_PASSWORD, WEBHOOK_INGEST_SECRET) ada di Mac `/tmp/autotoko_new_secrets.txt` + server `.env`. Tidak di git.

## Deploy cheatsheet
- Backend: build off-server → `pnpm --filter=@autotoko/backend --legacy deploy --prod /tmp/autotoko-deploy` → tar ke `/home/ubuntu/apps/autotoko` (preserve `.env`) → `pm2 restart autotoko-backend --update-env`. Detail: `infra/DEPLOY.md`.
- Web: `pnpm --filter @autotoko/web build` → tar `apps/web/dist` ke `/opt/autotoko/web`.
- Admin: `pnpm --filter @autotoko/admin build` → tar `apps/admin/dist` ke `/opt/autotoko/admin`.

---

## Sesi 2 — 2026-06-19 (lanjutan oleh Claude Code / Opus)

### ✅ SELESAI & terverifikasi
1. **Commit Admin CMS** (HEAD `025dc5a`) — SPA login/settings/pricing + PricingService/Controller.
2. **Security hardening** (HEAD `e9b98f5`):
   - `auth.service.ts`: `login()` baru — `ADMIN_USERNAME`/`ADMIN_PASSWORD` (constant-time compare), berfungsi di production. Dev login (user/user) hanya jika `NODE_ENV!=production` && `DEV_LOGIN_ENABLED=true`. Default disabled.
   - `crypto.service.ts`: throw saat startup bila production + `ENCRYPTION_KEY` < 32 char.
   - `webhooks.controller.ts`: fail-closed (tolak semua bila `WEBHOOK_INGEST_SECRET` kosong).
   - `.env.example`: dokumentasi `ADMIN_*`, `SMTP_*`, `WEBHOOK_INGEST_SECRET` wajib.
3. **Server .env diupdate**: `DEV_LOGIN_ENABLED=false`, `ADMIN_USERNAME=admin` + strong pass, `WEBHOOK_INGEST_SECRET` random, `WA_AUTOTOKO_NUMBER=15556410810` (reuse nomor Twilio xtracker), `SMTP_*`/`MAIL_FROM` (Gmail xtracker). Backup `.env.bak.<ts>` ada di server.
4. **Deploy backend** + restart → verified: public dev login `user/user`→401, admin login→token OK, webhook no-secret→401, `/api/health` db:up, xtracker tetap online.
5. **Deploy Admin CMS static** ke `/opt/autotoko/admin` + nginx `location /admin/` (alias, try_files → /admin/index.html). Verified: index + assets 200, login admin publik OK.

6. **Login web diperbaiki (P6 + WA UI)** (HEAD `9fea375`, pushed):
   - `apps/web/src/pages/Login.tsx` rewrite: tab WhatsApp (start→buka wa.me→poll status→JWT) + tab Email OTP + dev login (collapsible). `lib/auth.ts` tambah `applyToken`, `waLogin`, `emailLogin`.
   - **Email OTP backend baru**: `common/mail/mail.service.ts` (nodemailer, reuse Gmail SMTP xtracker; no-op + warn bila SMTP kosong) + `MailModule` (@Global). `modules/auth/email-otp.service.ts` (kode 6-digit di-hash sha256, TTL 5 menit, max 5 attempt, max 3/15min per email). Tabel `email_otp_sessions` (migration `0001_smart_rocket_raccoon.sql`, SUDAH diterapkan ke DB live via tunnel). Endpoint `POST /api/auth/email/{start,verify}`.
   - **Deployed + verified live**: backend redeploy (nodemailer ikut bundle), web redeploy. email/start invalid→400, valid→email terkirim (Gmail), verify wrong code→"Kode salah". WA start→waLink benar. Admin asset hash konfirmasi fresh.
   - ⚠️ **Catatan build**: `pnpm --filter @autotoko/web build` GAGAL di pnpm deps-status-check (stale dist terdeploy). Workaround: build langsung `cd apps/<app> && npx vite build` lalu tar dist. (Backend `pnpm --filter ... deploy --legacy` tetap OK.)

7. **P3/P4/P5 UI** (HEAD `39cc848`, pushed): Dashboard (trend 7-hari CSS bars, recent orders, quick actions, stat icons); Orders (search id/buyer, filter marketplace+status, pagination, detail modal, badge warna per-MP); Produk (search, kolom GMV-7d, detail modal: edit/delete master + postings per toko + tambah/hapus posting auto-SKU). Semua client-side dari endpoint yang ada — tanpa perubahan backend. Build via `npx vite build` (workaround pnpm). Deployed + verified.
8. **P7 cleanup** (HEAD `f232a35`): README diperbarui (port 8090, URL live, status). **Merge `develop`→`main` + push kedua branch** — sekarang sinkron di `f232a35`.

### ✅ Verifikasi akhir live (2026-06-19)
- `apitoko/api/health` db:up · web 200 · `/admin/` 200 · dev login `user/user`→401 · admin login→201 · pm2 autotoko-backend + xtracker-backend keduanya online.

---

## Sesi 3 — 2026-06-19 (TikTok authorize URL, oleh Claude Code / Opus)

Sumber perubahan: `Knowledge Base/CLAUDE2.md` §4 + "TikTok Shop OAuth Flow". (Catatan: CLAUDE2.md mendeskripsikan stack lama Prisma/Next — **diabaikan**; hanya bagian authorize/OAuth TikTok yang relevan & di-implement ke kode aktual Drizzle/Fastify.)

### ✅ SELESAI & terverifikasi live (HEAD `b9debe1`, pushed develop)
- **`tiktok.adapter.ts`**:
  - `getAuthUrl` → `https://services.tiktokshop.com/open/authorize?service_id={tiktok_service_id}&state={signed-JWT}`. **service_id** = admin setting baru `tiktok_service_id` (authorize URL di-key oleh service_id, BUKAN app_key). Pakai `new URL()` — kalau admin paste authUrl yang sudah ada service_id, tidak ditimpa; kalau tak ada service_id, warn.
  - Token exchange/refresh pindah ke `GET https://auth.tiktok-shops.com/api/v2/token/{get|refresh}` (dulu `open-api.tiktokglobalshop.com/authorization/202309/token`). Konstanta `TIKTOK_AUTH_BASE`. Response shape sama. Get-shops API tetap di `open-api.tiktokglobalshop.com` (benar).
- **`crypto.service.ts`**: `decrypt` kini mengizinkan plaintext kosong round-trip (bagian data ciphertext kosong itu valid) — memperbaiki bug laten: 500 "Invalid ciphertext format" saat admin mengosongkan field jadi `""`.
- **Data live dibersihkan**: ditemukan `tiktok_auth_url` warisan menunjuk ke backend **omniseller** (project lain) — diset ke kanonik `https://services.tiktokshop.com/open/authorize`. Key dummy uji (`tiktok_app_key/secret/service_id`) dihapus dari `admin_settings` via DB tunnel; sisa hanya `tiktok_auth_url`.
- **Verifikasi**: dengan service_id dummy, connect/tiktok menghasilkan URL persis `…/open/authorize?service_id=…&state=…`; tanpa creds → connect 502 "not configured" (bukan 500). Backend redeploy + health db:up.

### ⚙️ Untuk AI berikutnya — saat ada kredensial TikTok asli
Set di Admin CMS (`https://viewtoko.cosger.online/admin/` → Settings, atau PUT `/api/admin/settings/<key>`): `tiktok_app_key`, `tiktok_app_secret`, `tiktok_service_id`. `tiktok_auth_url` sudah benar (boleh override bila perlu). Lalu uji OAuth round-trip nyata (auth_code expire 30 menit single-use; access_token 7 hari; refresh_token 1 tahun). Pastikan redirect/callback `…/api/shops/callback/tiktok` terdaftar di TikTok Partner Center.

---

## Sesi 4 — 2026-06-20 (BUG FIX: TikTok service_id hilang dari authorize URL)

**Laporan:** tombol "+ Hubungkan TikTok" → TikTok error "This service does not exist". URL yang dihasilkan: `…/open/authorize?state=…` TANPA `service_id`.

**Root cause (terkonfirmasi live):** prod `admin_settings` punya `tiktok_app_key` + `tiktok_app_secret` (diisi user) tapi **`tiktok_service_id` tidak ada**. Kode sesi-3 hanya `logger.warn` lalu tetap kembalikan URL tanpa service_id (silent fail). Selain itu form Admin CMS Settings **tidak punya field** `tiktok_service_id` sama sekali → tak bisa diisi lewat UI.

### ✅ Fix (HEAD `411b7c2`, pushed develop)
- `tiktok.adapter.ts` `getAuthUrl`: kalau service_id tak resolvable → `throw BadGatewayException` dengan pesan jelas (service_id = App ID dari Partner Center → App Detail, BEDA dari app_key). Tidak lagi redirect ke URL rusak.
- `apps/admin/src/pages/Settings.tsx`: tambah field `tiktok_service_id` (label tegas membedakan dari App Key) + perjelas label app_key/auth_url. Admin redeploy.
- **Shopee dicek**: AMAN — `creds()` sudah `throw` bila partner_id/key/redirect kosong (fail-closed, tak ada pola bug serupa).
- **Verifikasi live**: tanpa service_id → connect 502 + pesan jelas; dengan service_id dummy → URL `…?service_id=…&state=…` benar. Dummy dihapus lagi (prod kembali ke pesan error sampai value asli diisi).

### ⚠️ ACTION OWNER (belum bisa dilakukan AI — butuh nilai rahasia)
Isi **`tiktok_service_id`** di Admin CMS (`https://viewtoko.cosger.online/admin/` → Kredensial & Config → TikTok Shop → field "Service ID / App ID") dengan nilai dari **TikTok Partner Center → App Detail** (numerik, mis. `7431458374265161478`). Setelah itu connect TikTok akan menghasilkan authorize URL valid. `tiktok_app_key`/`tiktok_app_secret` sudah terisi; `tiktok_auth_url` sudah kanonik.

---

## Sesi 5 — 2026-06-22 (TikTok service_id diisi + error UX + temuan blocker redirect)

**Data Partner Center (app "Jassa", dari owner):** Service ID `7561008038686230293`, App Key `6hq6fedc0u5cg`, **Redirect URL = `https://backend-gcp-omniseller-974841669069.asia-southeast2.run.app/api/auth/callback/tiktok`**, status **DRAFT**.

### ✅ SELESAI (HEAD `8480cef`, pushed develop)
- **`tiktok_service_id` = `7561008038686230293`** diisi di prod Admin CMS (via API). connect/tiktok kini menghasilkan `…/open/authorize?service_id=7561008038686230293&state=…` (verified).
- **Error UX (#4)**: `apps/web/src/lib/api.ts` + `apps/admin/src/lib/api.ts` kini surface pesan dari body NestJS (`message` string|array), bukan "HTTP 502". Web+admin redeploy.

### 🚨 BLOCKER untuk owner (OAuth round-trip TIDAK akan selesai sampai ini dibetulkan)
**Redirect URL app "Jassa" di Partner Center menunjuk ke backend OMNISELLER (project lain), BUKAN AutoToko.** Setelah seller approve, TikTok redirect ke omniseller GCP → callback AutoToko (`https://apitoko.cosger.online/api/shops/callback/tiktok`) tak pernah menerima `code`. 
→ Owner harus ubah **Redirect URL di Partner Center → `https://apitoko.cosger.online/api/shops/callback/tiktok`** (atau buat app TikTok terpisah milik AutoToko). App "Jassa" tampaknya milik project omniseller yang dipinjam (jejak omniseller juga sempat ada di `tiktok_auth_url`, sudah dibersihkan sesi 3).

### ℹ️ Catatan owner (bukan bug)
- App masih **DRAFT** → seller online biasa belum bisa authorize. Untuk tes pakai **Development Shop** (partner.tiktokshop.com → Development Shops → buat Seller Center test account → langsung approve, tak butuh link). Setelah app di-publish (review TikTok), seller umum baru bisa.

---

## Sesi 6 — 2026-06-22 (Pipeline order: webhook signature verification)

Owner sudah ganti Redirect URL "Jassa" di Partner Center → `https://apitoko.cosger.online/api/shops/callback/tiktok`. Fokus: perkuat pipeline order marketplace.

### ✅ SELESAI & terverifikasi live (HEAD `77d4155`, pushed)
- **Native webhook HMAC verification** (`webhook-verifier.service.ts` + controller). Webhook diterima bila **`?secret=` valid (jalur n8n/manual) ATAU tanda tangan native valid (jalur marketplace langsung)**; selain itu 401 (fail-closed). Tidak merusak jalur secret lama; menambah penerimaan webhook marketplace asli.
  - Shopee: `hex(HMAC-SHA256(partner_key, push_url + "|" + raw_body))`
  - TikTok: `hex(HMAC-SHA256(app_secret, app_key + raw_body))`
  - `main.ts` aktifkan Fastify `rawBody: true` (sign atas byte mentah). Header tanda tangan dibaca dari `authorization` / `x-tts-signature` / `x-tiktok-signature` / `x-shopee-signature`. Creds dari Admin CMS. Config: `WEBHOOK_PUBLIC_BASE_URL` (default `https://apitoko.cosger.online`), `SHOPEE_PUSH_URL` (opsional).
- **Verifikasi**: secret→200, tanpa-auth→401, tanda tangan Shopee dummy valid (tanpa secret)→200, tanda tangan salah→401. Data uji dibersihkan.

### ⚠️ Catatan akurasi algoritma (untuk AI berikutnya)
Algoritma HMAC di atas "best-effort" per dokумentasi TikTok/Shopee + CLAUDE2.md — **belum diuji terhadap webhook marketplace ASLI** (app TikTok masih DRAFT). Saat uji dgn Development Shop / webhook asli: jika ditolak 401, sesuaikan formula/lokasi header di `webhook-verifier.service.ts` (mis. Shopee pakai `Authorization` header = url|body; TikTok header/format bisa beda). Jalur `?secret=` tetap jadi fallback aman selama tuning.

### 🔜 Lanjutan pipeline order yang disarankan (belum dikerjakan)
- **Order pull/sync** via n8n (selain webhook push) — sesuai arsitektur "semua API marketplace lewat n8n".
- **Daftarkan URL webhook** di dashboard TikTok/Shopee (`apitoko/api/webhooks/{tiktok,shopee}`) — bisa pakai `?secret=` atau native sig.
- **Kanban board** (opsional) — sekarang UI status berupa tabel+badge+filter+modal; bisa diupgrade ke kanban drag-drop.

---

## Sesi 7 — 2026-06-22 (Pipeline order: fulfillment status management + UI)

### ✅ SELESAI & terverifikasi live (HEAD `e4c9c0b`, pushed)
- **Status fulfillment internal** (terpisah dari `orders.status` mentah marketplace). Enum `fulfillment_status`: masuk→approved→produksi→packing→siap_kirim→dikirim→selesai (+retur, dibatalkan). Kolom `orders.fulfillment_status` default `masuk`. **Migration `0002_tricky_marvel_boy.sql` diterapkan ke DB live** via tunnel (additive: enum + kolom).
- **Backend**: `PATCH /api/orders/:id/status` (multi-tenant, divalidasi `@IsIn`). `OrdersService.updateStatus` + ekspor `FULFILLMENT_STATUSES`.
- **UI** (`apps/web/src/pages/Orders.tsx`): kolom badge "Status Proses" + filter status; modal detail dengan tombol cepat **Setujui/Tolak** (saat masuk), **Lanjut → tahap berikut**, dan select manual ke status apa pun. Reload list setelah ubah.
- **Verifikasi**: order baru default `masuk`; PATCH→`approved` 200; status invalid→400. Data uji dibersihkan.

### Catatan
- `pnpm db:generate` / `pnpm -r typecheck` / `pnpm --filter <app> build` semua kena pnpm deps-status-check di mesin ini → pakai langsung: `npx drizzle-kit generate`, `npx tsc --noEmit`, `npx nest build`, `npx vite build`.

---

## Sesi 8 — 2026-06-22 (Pendaftaran URL webhook — kesiapan endpoint)

Pendaftaran URL webhook = **aksi manual owner di dashboard marketplace** (tak bisa via AI). Yang sudah disiapkan & diverifikasi:
- Endpoint publik SIAP: `POST https://apitoko.cosger.online/api/webhooks/{tiktok,shopee}` → tanpa auth 401, dengan `?secret=` 200. GET → 404 (marketplace pakai POST; tidak ada GET-challenge yang dibutuhkan).
- **URL untuk didaftarkan** (pakai `?secret={WEBHOOK_INGEST_SECRET}` — jalur paling andal; native sig juga aktif sbg bonus):
  - TikTok: `https://apitoko.cosger.online/api/webhooks/tiktok?secret={WEBHOOK_INGEST_SECRET}`
  - Shopee: `https://apitoko.cosger.online/api/webhooks/shopee?secret={WEBHOOK_INGEST_SECRET}`
  - Nilai `{WEBHOOK_INGEST_SECRET}` ada di server `.env` + Mac `/tmp/autotoko_new_secrets.txt` (JANGAN commit ke git).
- **Owner action**:
  - TikTok Partner Center (app "Jassa") → Manage App → Webhooks/Notifications → set Callback URL di atas → subscribe event order (Order Status Update, dll). App masih DRAFT → tes pakai Development Shop.
  - Shopee: **belum bisa** — `shopee_partner_key/partner_id` belum diisi di Admin CMS. Set dulu, baru daftarkan Push URL (Shopee push URL bersifat GLOBAL per partner_id — hati-hati bila partner_id dipakai bersama project lain).
- Setelah didaftarkan: saat order masuk, webhook → `orders` upsert (fulfillment_status default `masuk`) + fee per-tx terpotong. Native sig TikTok masih perlu validasi vs webhook asli (jalur `?secret=` aman).

### 🔑 TEMUAN dari Chrome extension (Partner Center, app "Jassa")
- **TikTok MENOLAK `?secret=`** di callback URL (error "internal error"). URL tersimpan = `https://apitoko.cosger.online/api/webhooks/tiktok` (TANPA secret). → webhook TikTok asli **HANYA** bisa lewat **verifikasi tanda tangan native** (bukan `?secret=`).
- Event toggles belum diaktifkan (butuh klik manual di UI). Owner harus aktifkan: Type 4 Package Update, Type 6 Seller Deauthorisation, Type 7 Auth Expire, Type 11 Cancellation, Type 12 Order return (+ Reverse/Recipient sesuai kebutuhan).
- Redirect URL Partner Center sudah benar: `https://apitoko.cosger.online/api/shops/callback/tiktok`. Service ID `7561008038686230293`, App Key `6hq6fedc0u5cg` (di CMS).

### ✅ Sesi 9 (HEAD `74672e8`): TikTok sig native diperkuat + mode debug
- `verifyTikTok`/`verifyShopee` kini coba beberapa varian HMAC (terima bila salah satu cocok; tetap butuh secret key). TikTok candidates: `appkey_body` = HMAC(app_secret, app_key+body), `body_only`, `secret_wrapped`. Log nama varian yang cocok.
- **`WEBHOOK_DEBUG=true`** (sudah diset di server .env) → saat verifikasi gagal, log: tanda tangan diterima vs computed candidates + header kandidat (sign/auth/tts/…) + panjang body. Tujuan: tangkap test event asli dari Development Shop untuk kunci formula. **Matikan lagi (`WEBHOOK_DEBUG=false`) setelah formula terkonfirmasi.**
- **NEXT (butuh owner)**: aktifkan event toggles + kirim test event dari Development Shop → AI cek `pm2 logs autotoko-backend` untuk lihat varian mana yang match / sesuaikan `webhook-verifier.service.ts` bila tak ada yang match.
- Catatan: event auth-lifecycle (Type 6 Deauth, Type 7 Auth Expire) → lihat Sesi 10 (sudah dihandle).

---

## Sesi 10 — 2026-06-23 (multi-agent Opus: webhook parser robust + Orders Kanban)

Dikerjakan paralel oleh 2 subagent Opus (backend & frontend, file disjoint), diintegrasi + dideploy + diverifikasi oleh orchestrator.

### ✅ Backend — TikTok webhook tipe numerik + auth lifecycle (HEAD `1101324`)
- `webhooks.service.ts handleTikTok`: `type` diperlakukan sbg NUMBER. Map ke label (`TIKTOK_EVENT_TYPE_LABELS`); tidak ada "Order Status type 1" — order lifecycle = 4/11/12/64/65/67 (+2). Tipe order → resolve order id best-effort (`data.order_id ?? order_sn ?? order_list[0].order_id`) → upsert (jalur lama). Tipe non-order → hanya direkam. **Auth lifecycle**: type 6 (seller deauth) → `shops.shopStatus='disconnected'` (by marketplace+shopId, multi-tenant); type 7 (auth expire) → warn saja (token bisa di-refresh). Idempotensi pakai `tts_notification_id` bila ada. 
- Verified live (secret path): type4 direkam, type6→`authAction:disconnect`, type99→`type_99`, replay→`duplicate:true`.

### ✅ Frontend — Orders Kanban (HEAD `668c7eb`)
- Toggle **Tabel | Kanban** di halaman Orders. Kanban: 1 kolom per status fulfillment (+retur/dibatalkan), kartu (badge MP/pembeli/total/tanggal), klik → modal detail yang sama, tombol ◀▶ pindah status via `PATCH /orders/:id/status`. Filter search+marketplace berlaku di kedua view. Tanpa lib baru. Verified live (bundle mengandung Kanban).

### Catatan multi-agent
- Subagent dibatasi: hanya edit kode area masing-masing, TANPA git/build-lain/deploy/server/migration. Orchestrator yang typecheck gabungan, build, commit, deploy, verifikasi. Pola aman: partisi file disjoint (backend service vs web page).

---

## Sesi 11 — 2026-06-23 (OAuth callback robust + manual connect sandbox)

**Bug:** sandbox authorize dari Partner Center tak bawa state JWT AutoToko → `handleCallback` lempar "Invalid or expired state" → callback redirect ke `/toko?error=` → `/toko` protected → SPA pantul ke `/login` = "Koneksi Gagal".

### ✅ Fix (HEAD `5e3583b`, pushed, deployed, verified)
- `shops.controller.ts` callback: tambah logging (code/state/shop_id), dan saat error **render halaman HTML (HTTP 200)** berisi pesan + auth_code + cara selesaikan manual — TIDAK lagi redirect ke route protected. Sukses tetap redirect ke `/toko?connected=`.
- **Endpoint manual** `POST /api/shops/connect/:mp/manual` (JwtAuthGuard + AdminOnly), body `{authCode, shopId?, userId?}` → exchange code→token→saveShop tanpa state. Untuk sandbox/admin.
- `shops.service.connectManual()`.
- Verified: callback state-invalid→200 HTML (bukan /login); connect/tiktok(admin)→authUrl service_id benar; manual no-auth→401, admin+dummy→502 (sampai exchange).

### Cara connect sandbox "Bulanja" (shop_id 7494387970839184847) — untuk owner
- **Opsi A (disarankan):** login viewtoko → Toko Saya → "+ Hubungkan TikTok" (authorize URL bawa state kita) → authorize sandbox shop → callback sukses → shop+token tersimpan. Berhasil selama authorize dimulai DARI AutoToko.
- **Opsi B (manual, kalau authorize dari Partner Center):** setelah authorize, ambil `auth_code` (dari URL callback / halaman info baru) → admin POST `/api/shops/connect/tiktok/manual {"authCode":"…"}` (pakai admin JWT). auth_code single-use, ~30 menit.
- Tabel `shops` masih KOSONG (belum ada token). HMAC webhook verify TIDAK butuh shop token (pakai app_secret), tapi agar webhook meng-upsert order, shop row harus ada.

### ⏳ Subagent Notifikasi/BOM (Sesi 10.5) — TERTUNDA
2 subagent Opus kena session limit (reset 3am WIB), kerja setengah-jadi diparkir di `/tmp/autotoko-partial-agents/` (notifications: 3 file tanpa migration; bom: dto saja). Repo bersih di `5e3583b`. Lanjutkan/selesaikan modul Notifikasi + BOM nanti.

---

## Sesi 12 — 2026-06-25 (audit + order filters + dashboard summary; INSIDEN deploy)

### ✅ Fitur (HEAD `8bcbda1`, deployed, verified)
- **GET /orders** kini terima query `status, shopId, dateFrom, dateTo, limit, offset` (divalidasi; multi-tenant; tetap kembalikan array → backward-compatible). `OrdersService.list(userId, opts)`.
- **GET /api/dashboard/summary** (DashboardModule baru) → `{today_orders, today_revenue, active_shops, total_orders, total_revenue, total_fee_charged}` (today dihitung di Asia/Jakarta). Web Dashboard memakainya (kartu "Hari Ini").
- Verified live: summary OK, filter OK, validasi invalid→400.

### 🚨 INSIDEN DEPLOY (penting untuk AI berikutnya!)
Jaringan owner sedang LABIL (IPv6/NAT64 + SSH drop). Saat deploy backend, perintah `tar | ssh 'rm -rf dir && tar xzf -'` PUTUS di tengah → **`rm -rf` jalan, extract gagal → seluruh `dist`+`node_modules`+`.env` di server TERHAPUS**. Proses pm2 masih jalan dari memori (sempat menyelamatkan). Pemulihan: `.env` ke-backup di `/tmp/at.env` (langkah pertama deploy) → dipulihkan; bundle di-`rsync --partial` ulang (resumable) → pm2 restart → sehat.
**ATURAN DEPLOY BARU (jaringan labil):**
- JANGAN `rm -rf live-dir && tar xzf -` dalam satu pipe (korupsi bila putus).
- Backend: pakai **`rsync -az --partial`** (resumable, idempoten) ke app dir, JANGAN rm dulu. Atau transfer tar ke `/tmp` dulu → extract → swap.
- Web: tar ke `/tmp/web.tgz` (rsync) → `sudo tar x` ke `web-new` → `mv` atomik → swap. Live dir tak tersentuh bila gagal.
- Pakai `ssh -o ServerAliveInterval=10` + loop retry.
- Verifikasi eksternal pakai `curl -4` (IPv6 NAT64 owner timeout). `/tmp/autotoko_new_secrets.txt` sempat hilang (/tmp dibersihkan) — ADMIN_PASSWORD/WEBHOOK_INGEST_SECRET bisa diambil ulang dari server `.env`.

---

## Sesi 13 — 2026-06-25 (WebSocket new_order + status 4 prioritas)

### ✅ WebSocket real-time (HEAD `9f2258f`, deployed, verified e2e)
- Backend: `EventsGateway` socket.io (@Global, `EventsModule`), auth JWT di handshake (`auth.token`), room per-user `user:<sub>`. `IoAdapter` di main.ts. `webhooks.service.upsertOrder` emit `new_order` (order baru) + `order_update` (status). socket.io di `/socket.io/` (HTTP server yg sama, port 8090).
- nginx **viewtoko**: ditambah `location /socket.io/` (proxy_pass :8090 + Upgrade/Connection upgrade headers, read_timeout 3600s). Hanya viewtoko — xtracker/geoscan tak tersentuh.
- Frontend: `lib/realtime.ts` (socket.io-client singleton same-origin, `transports:['websocket']`, token dari localStorage) + `useRealtime` hook. Layout → toast "Pesanan baru masuk!" (klik → /orders). Orders & Dashboard → live-reload. Disconnect saat logout.
- **Verified e2e live**: connect via nginx WS → server ack → webhook (secret) bikin order → klien terima `new_order`. Pakai `dns.setDefaultResultOrder('ipv4first')` di test (hindari IPv6 NAT64).

### Status 4 prioritas owner
1. ✅ **WebSocket new_order** — DONE (sesi ini).
2. ⏳ **Shopee** — terblokir kredensial (`shopee_partner_id/key` belum ada di Admin CMS). Adapter + webhook sig + push-URL doc sudah siap; tinggal isi creds → daftarkan push URL.
3. ✅ **Order Kanban** — sudah ada sejak sesi 10 (toggle Tabel|Kanban di Orders).
4. ⏳ **BOM auto-deduct** — BELUM. Modul BOM CRUD belum dibuat (kerja agent sesi 10.5 terparkir di `/tmp/autotoko-partial-agents/`). Perlu: bangun modul BOM (CRUD bahan, schema `bom_items` sudah ada) → lalu hook auto-deduct di `webhooks.service.upsertOrder` (kurangi `bom_items.current_stock` per `quantity` × item terjual; alert email bila < `minimum_threshold`). Multi-tenant via `master_products.user_id`.

---

## Sesi 14 — 2026-06-25 (BOM module + auto-deduct) — #4 SELESAI

### ✅ BOM (HEAD `33415f0`, deployed, verified e2e)
Dibangun di atas schema `bom_items` AKTUAL (TANPA migration): kolom `master_product_id` (WAJIB), `material_name`, `quantity` (per produk), `current_stock`, `minimum_threshold`, supplier*, dll. **Tidak ada `user_id`** → multi-tenant via join `master_products.user_id`. (Spec owner sebut user_id/linked_product_id-nullable/quantity_per_order — beda dari DB; saya pakai DB riil + nama API yang sesuai, agar tanpa migration = aman.)
- `BomModule` (CRUD): `GET /bom`, `POST /bom`, `PATCH /bom/:id`, `DELETE /bom/:id`, `POST /bom/:id/restock`, `GET /bom/alerts`. `supplierApiKey` di-encrypt. DTO dari partial agent (sesi 10.5, di /tmp) dipakai (IsEnum→IsIn).
- **Auto-deduct** di `webhooks.service.upsertOrder` (saat order baru): `BomService.deductForOrder` → parse `order.items` (line_items) ambil SKU+qty → resolve `product_postings.marketplaceSku → masterProductId` (cek milik user) → `bom_items` by master → `current_stock -= qty × quantity` → email alert bila `< minimum_threshold` (MailService). Skip rapi bila tak ter-map; tidak pernah blokir order. Hasil ikut di response webhook (`bom:{deducted}`).
- Frontend: `pages/Bom.tsx` (tabel, tambah, restock, set-stok, hapus, highlight merah low-stock, realtime reload), nav sidebar "BOM / Bahan" (🧪), route `/bom`. Dashboard: widget "⚠️ Peringatan Stok" dari `/bom/alerts`.
- **Verified e2e live**: POST /bom stok 10 (qty/produk 3, min 5) → webhook jual 2 → stok 4, lowStock true, masuk /bom/alerts. ✅

### Status 4 prioritas owner: SEMUA selesai/terblokir
1. ✅ WebSocket new_order · 2. ⏳ Shopee (blocked creds) · 3. ✅ Kanban · 4. ✅ BOM auto-deduct.

---

## Sesi 15 — 2026-06-25 (TikTok sig SKIP, dashboard alerts, produk×BOM)

- **Task TikTok sig verify: SKIP** (sesuai instruksi) — `WEBHOOK_DEBUG=true` masih ON, tapi 0 webhook TikTok asli & 0 shops (otorisasi sandbox belum tuntas). Verifier multi-kandidat + debug sudah siap; lock formula saat event asli pertama datang.
- **Dashboard alerts** (HEAD `3902494`): `GET /api/dashboard/alerts` → `{low_stock[], low_wallet|null, expiring_tokens[]}` (low_stock dari bom_items; wallet < Rp150k; token exp < 3 hari). Frontend: kartu alert amber di atas stats (realtime). Verified.
- **Master Produk × BOM**: Produk CRUD sudah lengkap (sesi 4). Ditambah section "Bahan Baku (BOM)" di modal detail produk — list bahan ter-link + quick-add (POST /bom). Verified.

### ⏳ BELUM dikerjakan (sisa Phase 1)
- Shopee creds + push URL (owner). Order pull via n8n. AI autopilot. RLS. Landing/mobile.
- WEBHOOK_DEBUG=true masih ON di server — matikan setelah formula sig TikTok terkonfirmasi.
- **Native webhook signature verify** (TikTok/Shopee) — saat ini hanya `?secret=` guard (fail-closed). Pasang verifikasi tanda tangan asli saat ada app keys marketplace.
- **Postgres RLS** pada tabel tenant (sekarang isolasi hanya app-layer `user_id`).
- **Daftarkan URL** webhook + Midtrans notif di dashboard TikTok/Shopee/Midtrans (URL siap di `infra/DEPLOY.md`).
- **n8n daily/weekly reports** (PRD).
- **AI autopilot** (chat buyer/affiliate, reply review, optimize) — belum ada; pakai abstraksi provider via Admin CMS (lihat memory `ai-provider-configurable-cms`).
- **Landing page SSR** + **mobile Expo** (Phase 2).
- Backend pagination `/products` & `/orders` bila data tumbuh besar (sekarang client-side, list ≤100).
- OAuth round-trip marketplace belum diuji dengan kredensial asli (belum ada).

### Catatan teknis
- `typecheck` semua workspace hijau. Build backend & admin OK.
- Admin & web pakai API path relatif `/api` (proxy nginx) — aman lintas-domain.
- DB: 18 tabel live di `autotoko`. Migration runner: `node dist/database/migrate.js`. Generate migration baru lokal dgn drizzle-kit lalu jalankan runner di server (tunnel `infra/scripts/db-tunnel.sh --bg` → localhost:15432).

---

## Sesi 16 — 2026-06-26 (AI Autopilot — provider per-fitur via CMS)

Owner pilih fitur #1 (AI autopilot) dgn syarat: **provider/model AI dipilih PER FITUR dari Admin CMS** (mis. auto-chat-pembeli→Gemini, auto-chat-affiliator→OpenAI, auto-approve→Claude). Selesai (kode + build + boot-test rute). E2E AI call MENUNGGU owner isi API key di CMS.

### ✅ Backend — modul `ai` (`apps/backend/src/modules/ai/`)
- `ai.types.ts` — provider (`anthropic|openai|gemini`), 5 fitur (`buyer_chat, affiliate_chat, review_reply, auto_approve, product_optimize`), default model per provider, mapping key API (`anthropic_api_key|openai_api_key|gemini_api_key`).
- `ai-providers.ts` — caller stateless per vendor pakai global `fetch` (Node 24): Anthropic Messages API, OpenAI Chat Completions, Gemini generateContent. Normalisasi → `complete({system,messages,maxTokens,temperature})`.
- `ai-provider.service.ts` — `resolveConfig(feature)` baca `ai_feature_<feat>_provider` + `ai_feature_<feat>_model` dari `admin_settings`, fallback ke global `ai_provider/ai_model`, lalu default per provider. `complete(feature,…)` ambil key provider (encrypted) → dispatch; lempar 502 jelas bila key kosong/gagal. `featureStatus()` utk UI CMS (config tiap fitur + apakah key provider terisi).
- `ai.service.ts` — fitur autopilot: `buyerChat`, `affiliateChat`, `reviewReply`, `autoApprove` (JSON verdict, default tolak bila tak ter-parse), `optimizeProduct` (JSON {title,description}). Semua pakai `complete(feature,…)` → provider per fitur.
- `ai.controller.ts` (`/api/ai`, JwtAuthGuard): `GET /features` + `PUT /features/:feature` (AdminOnly) utk konfigurasi; `POST /buyer-chat|affiliate-chat|review-reply|auto-approve|optimize-product`.
- Terdaftar di `app.module.ts`. **Boot-test lokal: 7 rute `/api/ai/*` ter-map, app start sukses** (DI resolve AdminSettings/Auth). typecheck BE hijau, `nest build` hijau.

### ✅ Frontend — Admin CMS `AiAutopilot.tsx`
- Halaman baru (nav 🤖 "AI Autopilot", route `/admin/ai`). Tiap fitur: dropdown provider + input model (auto-isi default saat ganti provider) → `PUT /ai/features/:feature`. Peringatan kuning bila API key provider belum diisi. Section "API Key Provider" (anthropic/openai/gemini → `PUT /admin/settings/:key`, encrypted). Box "Uji Coba" (kirim ke `buyer-chat`) utk tes key+model. typecheck + `vite build` admin hijau.

### ⏳ Owner / berikutnya
- **Isi API key** di Admin CMS (≥1 provider) lalu pilih provider per fitur → fitur AI aktif. Tanpa key → endpoint balas 502 jelas.
- Belum di-deploy (tunnel DB & SSH prod di luar scope sesi ini / diblok auto-mode). Deploy BE+admin sesuai cheatsheet saat siap.
- `auto_approve`/`buyer_chat` BELUM di-hook otomatis ke webhook order/chat — saat ini endpoint manual; wiring otomatis (gated setting) menyusul bila diinginkan.
- Default model: anthropic `claude-opus-4-8`, openai `gpt-4o`, gemini `gemini-1.5-pro` (owner bisa ganti di CMS).
