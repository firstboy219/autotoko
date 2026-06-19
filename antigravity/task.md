# AutoToko Phase 1 — Task List

## Priority 1: Commit & Deploy Admin CMS
- [/] Commit 8 uncommitted files (Admin CMS + Pricing)
- [ ] Build & deploy backend + admin static to server
- [ ] Verify admin CMS accessible at /admin/

## Priority 2: Critical Security Hardening
- [ ] Fix DEV_LOGIN: default to false, add NODE_ENV guard
- [ ] Fix CryptoService: throw in production if key missing
- [ ] Fix webhooks: reject if WEBHOOK_INGEST_SECRET empty
- [ ] Update server .env: DEV_LOGIN_ENABLED=false, generate WEBHOOK_INGEST_SECRET
- [ ] Deploy security fixes to server
- [ ] Verify: dev login rejected, webhooks protected

## Priority 3: Product Detail + Postings UI
- [ ] Add product detail route /produk/:id
- [ ] Product detail page: info, edit form, postings list
- [ ] Product list: search/filter, pagination, gmv7d display
- [ ] Backend: pagination + search on GET /products
- [ ] Deploy product improvements

## Priority 4: Dashboard Improvements
- [ ] Recent orders (last 5) on dashboard
- [ ] Quick action buttons
- [ ] Simple order trend chart (7 days, CSS bars)
- [ ] Better stat cards with icons
- [ ] Backend: add limit/filter params on GET /orders

## Priority 5: Orders Page Improvements
- [ ] Pagination controls
- [ ] Filter by marketplace + status
- [ ] Search by order ID / buyer
- [ ] Order detail modal
- [ ] Deploy orders improvements

## Priority 6: Email OTP Login
- [ ] Add Gmail SMTP config to autotoko .env (reuse xtracker creds)
- [ ] Create email OTP service (send via Gmail/nodemailer)
- [ ] Add email OTP endpoints (start + verify)
- [ ] Update Login.tsx: tab for WA vs Email login
- [ ] Set correct WA_AUTOTOKO_NUMBER in server .env
- [ ] Deploy email OTP + WA fixes

## Priority 7: Final Cleanup & Merge
- [ ] Update README.md (port, status)
- [ ] Final deploy & verify everything
- [ ] Merge develop → main
- [ ] Push both branches
