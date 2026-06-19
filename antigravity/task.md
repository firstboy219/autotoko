# AutoToko Phase 1 — Task List

## Priority 1: Commit & Deploy Admin CMS  ✅ DONE (sesi 2)
- [x] Commit 8 uncommitted files (Admin CMS + Pricing)
- [x] Build & deploy backend + admin static to server
- [x] Verify admin CMS accessible at /admin/ (viewtoko.cosger.online/admin/)

## Priority 2: Critical Security Hardening  ✅ DONE (sesi 2)
- [x] Fix DEV_LOGIN: default to false, add NODE_ENV guard + real ADMIN login
- [x] Fix CryptoService: throw in production if key missing/weak
- [x] Fix webhooks: reject if WEBHOOK_INGEST_SECRET empty (fail-closed)
- [x] Update server .env: DEV_LOGIN_ENABLED=false, generate WEBHOOK_INGEST_SECRET, ADMIN creds, WA number, SMTP
- [x] Deploy security fixes to server
- [x] Verify: dev login 401, admin login OK, webhooks 401 without secret

## Priority 3: Product Detail + Postings UI  ✅ DONE (sesi 2)
- [x] Product detail (modal) — info, edit form, delete, postings per shop
- [x] Add/delete posting (auto-SKU linking)
- [x] Product list: search, gmv7d display
- [~] Backend pagination on GET /products — skipped (client-side filter; lists small)
- [x] Deploy product improvements

## Priority 4: Dashboard Improvements  ✅ DONE (sesi 2)
- [x] Recent orders (last 5) on dashboard
- [x] Quick action buttons
- [x] Order trend chart (7 days, CSS bars, client-side)
- [x] Better stat cards with icons
- [~] Backend limit/filter on GET /orders — skipped (computed client-side)

## Priority 5: Orders Page Improvements  ✅ DONE (sesi 2)
- [x] Pagination controls (client-side)
- [x] Filter by marketplace + status
- [x] Search by order ID / buyer
- [x] Order detail modal
- [x] Deploy orders improvements

## Priority 6: Email OTP Login  ✅ DONE (sesi 2)
- [x] Add Gmail SMTP config to autotoko .env (reuse xtracker creds)
- [x] Create email OTP service (send via Gmail/nodemailer) + MailService
- [x] Add email OTP endpoints (start + verify) + email_otp_sessions table (migration 0001)
- [x] Update Login.tsx: tab for WA vs Email login (+ WA polling flow)
- [x] Set correct WA_AUTOTOKO_NUMBER in server .env (15556410810)
- [x] Deploy email OTP + WA fixes (verified live)

## Priority 7: Final Cleanup & Merge
- [x] Update README.md (port 8090, live URLs, status)
- [x] Final deploy & verify everything (security, admin, login, UI all live)
- [x] Merge develop → main
- [x] Push both branches
