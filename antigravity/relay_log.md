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

### ⏳ BELUM dikerjakan (sisa Phase 1 — untuk AI berikutnya)
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
