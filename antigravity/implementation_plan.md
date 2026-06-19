# AutoToko — Lanjutkan Phase 1 (Prioritized)

Melanjutkan semua pekerjaan yang tertunda dari session Claude Code sebelumnya. Urutan berdasarkan prioritas: **security first → core features → polish → cleanup**.

---

## User Review Required

> [!IMPORTANT]
> **Email OTP**: Membutuhkan SendGrid API key yang aktif. Apakah sudah ada? Atau skip dulu dan fokus WA login saja?

> [!IMPORTANT]
> **WA Number**: `WA_AUTOTOKO_NUMBER` masih placeholder `628xxxxxxxxxx`. Nomor WA yang benar untuk AutoToko apa?

> [!WARNING]
> **DEV_LOGIN**: Saat ini siapa saja bisa login ke `apitoko.cosger.online` dengan `user/user` dan mendapat akses admin. Ini akan saya matikan — artinya setelah deploy, login hanya bisa via WA OTP (atau Email OTP jika disetujui). Setuju?

---

## Proposed Changes

### Priority 1 — Commit & Deploy Admin CMS (sudah code-complete)

Ada 8 file uncommitted dari session Claude Code yang terputus. Code sudah typecheck + build green.

#### [MODIFY] [App.tsx](file:///Users/mm/projects/autotoko/apps/admin/src/App.tsx)
- Sudah diubah: dari scaffold → real SPA routing (Login, Settings, Pricing)

#### [MODIFY] [vite.config.ts](file:///Users/mm/projects/autotoko/apps/admin/vite.config.ts)
- Sudah diubah: `base: "/admin/"` untuk sub-path serving

#### [MODIFY] [admin-settings.module.ts](file:///Users/mm/projects/autotoko/apps/backend/src/modules/admin-settings/admin-settings.module.ts)
- Sudah diubah: Added PricingService + PricingController

#### Untracked files (already written):
- `apps/admin/src/components/Layout.tsx` — admin nav sidebar
- `apps/admin/src/lib/{api,auth,useFetch}.ts` — admin API client
- `apps/admin/src/pages/{Login,Settings,Pricing}.tsx` — admin pages
- `apps/backend/src/modules/admin-settings/{pricing.service,pricing.controller}.ts` — pricing CRUD

**Action:** `git add -A && git commit`, build, deploy backend + admin static ke server.

---

### Priority 2 — Critical Security Hardening

> [!CAUTION]
> Backend sudah public di internet (`apitoko.cosger.online`). Security fixes ini wajib sebelum menambah fitur lain.

#### [MODIFY] [auth.service.ts](file:///Users/mm/projects/autotoko/apps/backend/src/modules/auth/auth.service.ts)
- Change `DEV_LOGIN_ENABLED` default dari `"true"` → `"false"`
- Tambah guard: hanya izinkan jika `NODE_ENV !== "production"`
- Jadi double protection: harus explicit set env var DAN bukan production

#### [MODIFY] [crypto.service.ts](file:///Users/mm/projects/autotoko/apps/backend/src/common/crypto/crypto.service.ts)
- Jika `NODE_ENV === "production"` dan `ENCRYPTION_KEY` tidak ada / lemah: **throw error** (jangan fallback ke hardcoded key)
- Dev mode tetap boleh pakai fallback key

#### [MODIFY] [webhooks.controller.ts](file:///Users/mm/projects/autotoko/apps/backend/src/modules/webhooks/webhooks.controller.ts)
- Generate random `WEBHOOK_INGEST_SECRET` jika belum diset di server `.env`
- Ubah guard: jika `WEBHOOK_INGEST_SECRET` kosong, **reject all** (bukan accept all)

#### [MODIFY] [.env](file:///Users/mm/projects/autotoko/apps/backend/.env.example) (server-side)
- Set `DEV_LOGIN_ENABLED=false` di server `.env`
- Set `WEBHOOK_INGEST_SECRET=<random-generated>`
- Verify `ENCRYPTION_KEY` sudah strong

**Action:** Edit code, deploy ke server, verify health check.

---

### Priority 3 — Product Detail + Postings UI

Saat ini Produk page hanya ada list view dan create. Belum ada detail, edit, delete, atau postings management.

#### [MODIFY] [Produk.tsx](file:///Users/mm/projects/autotoko/apps/web/src/pages/Produk.tsx)
- Tambah click-through dari tabel → detail view
- Tampilkan: info master produk, variants, list postings per shop
- Add edit form (PATCH /products/:id)
- Add delete button (DELETE /products/:id)
- Add posting create form (POST /products/:id/postings)
- Add posting delete (DELETE /products/postings/:postingId)
- Tambah search/filter on list
- Tampilkan `gmv7d` (sudah di-fetch tapi tidak ditampilkan)

#### [NEW] Route `/produk/:id` di [App.tsx](file:///Users/mm/projects/autotoko/apps/web/src/App.tsx)
- Tambah route untuk product detail page

#### [MODIFY] [products.controller.ts](file:///Users/mm/projects/autotoko/apps/backend/src/modules/products/products.controller.ts)
- Tambah pagination pada GET /products (query: `?page=&limit=&search=`)

#### [MODIFY] [products.service.ts](file:///Users/mm/projects/autotoko/apps/backend/src/modules/products/products.service.ts)
- Implement pagination + search filter
- Add sorting options

---

### Priority 4 — Dashboard Improvements

Dashboard saat ini hanya 4 angka stat. Perlu lebih informatif.

#### [MODIFY] [Dashboard.tsx](file:///Users/mm/projects/autotoko/apps/web/src/pages/Dashboard.tsx)
- Tambah recent orders table (last 5)
- Tambah quick action buttons (connect shop, add product, top-up)
- Tambah chart sederhana (order trend 7 hari) menggunakan CSS-only bars (tanpa library)
- Improve stat cards: icons, trend indicators

#### [MODIFY] [orders.controller.ts](file:///Users/mm/projects/autotoko/apps/backend/src/modules/orders/orders.controller.ts)
- Tambah query params pada GET /orders: `?limit=&offset=&marketplace=&status=`

#### [MODIFY] [orders.service.ts](file:///Users/mm/projects/autotoko/apps/backend/src/modules/orders/orders.service.ts)
- Implement pagination + filter support
- Add daily order counts for chart (last 7 days aggregate)

---

### Priority 5 — Orders Page Improvements

#### [MODIFY] [Orders.tsx](file:///Users/mm/projects/autotoko/apps/web/src/pages/Orders.tsx)
- Add pagination controls
- Add filter by marketplace (dropdown)
- Add filter by status
- Add search by order ID / buyer name
- Add order detail modal/view (GET /orders/:id)
- Better status badges with marketplace-specific colors

---

### Priority 6 — Email OTP Login *(jika SendGrid available)*

#### [NEW] `apps/backend/src/modules/auth/email-otp.service.ts`
- Generate 6-digit OTP, store di DB, kirim via SendGrid
- OTP expiry 5 menit (sama seperti WA)
- Rate limit: max 3 OTP per email per 15 menit

#### [NEW] `apps/backend/src/database/schema/` — add `emailOtpSessions` table
- Atau reuse pattern `waLoginSessions` dengan tambah kolom `channel`

#### [MODIFY] [auth.controller.ts](file:///Users/mm/projects/autotoko/apps/backend/src/modules/auth/auth.controller.ts)
- `POST /auth/email/start` — kirim OTP ke email
- `POST /auth/email/verify` — verify OTP → JWT

#### [MODIFY] [Login.tsx](file:///Users/mm/projects/autotoko/apps/web/src/pages/Login.tsx)
- Tambah tab: WA Login | Email Login
- Email login flow: masukkan email → terima OTP → masukkan OTP → login

---

### Priority 7 — Final Cleanup & Merge

#### Server `.env` verification
- Verify semua env vars di server sudah benar
- `DEV_LOGIN_ENABLED=false`
- `WEBHOOK_INGEST_SECRET` terisi
- `ENCRYPTION_KEY` strong

#### [MODIFY] [README.md](file:///Users/mm/projects/autotoko/README.md)
- Update port info (8090 bukan 8080)
- Update status section

#### Git merge
- Merge `develop` → `main` setelah semua selesai
- Push both branches

---

## Verification Plan

### Automated Tests
```bash
pnpm typecheck          # semua workspace harus green
pnpm build              # semua workspace harus build sukses
```

### Manual Verification
- SSH ke server → verify health check `curl http://127.0.0.1:8090/api/health`
- Test login di `https://viewtoko.cosger.online` — harus bisa login via WA (dev login disabled)
- Test Admin CMS di `https://viewtoko.cosger.online/admin/` — verify settings & pricing pages
- Test create product → view detail → edit → create posting → delete posting
- Test orders filter dan pagination
- Verify webhook endpoint menolak request tanpa secret
- Verify `https://apitoko.cosger.online/api/auth/login` dengan user/user → rejected (DEV_LOGIN off)
