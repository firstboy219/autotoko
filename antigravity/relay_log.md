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

### ⚠️ KONSEKUENSI — kerjakan berikutnya (URGENT)
- **Login web user rusak**: dev login dimatikan di prod, web app belum punya UI WA/Email OTP. User terkunci.
  - Backend WA login SUDAH ada: `POST /api/auth/wa-login/start`, `GET /api/auth/wa-login/status?token=`.
  - Email OTP backend BELUM ada (SMTP creds sudah di env). Perlu service + endpoints + store (opsi: tabel baru `email_otp_sessions` via migration, atau reuse pola `waLoginSessions`).
  - Web `apps/web/src/pages/Login.tsx` perlu di-rewrite: tab WA | Email, polling status WA, input OTP email.

### ⏳ BELUM dikerjakan (urutan saran)
- P3 Product detail + postings UI + pagination/search backend.
- P4 Dashboard improvements (recent orders, quick actions, trend chart, limit/filter `/orders`).
- P5 Orders page (pagination, filter marketplace/status, search, detail modal).
- P6 Email OTP (backend + web UI).
- P7 README update (port 8090), merge `develop`→`main`, push.
- Security sisa: native webhook signature verify, Postgres RLS.
- Register URL webhook/Midtrans di dashboard TikTok/Shopee/Midtrans.

### Catatan teknis
- `typecheck` semua workspace hijau. Build backend & admin OK.
- Admin & web pakai API path relatif `/api` (proxy nginx) — aman lintas-domain.
- DB: 18 tabel live di `autotoko`. Migration runner: `node dist/database/migrate.js`. Generate migration baru lokal dgn drizzle-kit lalu jalankan runner di server (tunnel `infra/scripts/db-tunnel.sh --bg` → localhost:15432).
