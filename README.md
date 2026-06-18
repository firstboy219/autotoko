# AutoToko

SaaS multi-tenant autopilot untuk seller online di **TikTok Shop + Shopee**
(Tokopedia/Lazada = Phase 2). Konsep inti: **Master Produk ↔ Postingan**
dihubungkan via **SKU**.

> Spec lengkap (single source of truth): [`Knowledge Base/AUTOTOKO_PRD_COMPLETEv3.md`](./Knowledge%20Base/AUTOTOKO_PRD_COMPLETEv3.md)

## Tech stack

| Layer | Pilihan |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| Backend | NestJS (Fastify adapter) |
| Dashboard user + Admin CMS | Vite + React SPA (static, served by nginx) |
| Landing (SEO) | SSR terpisah (TBD: Astro/Next) |
| DB | PostgreSQL (shared on server) |
| Cache/Queue | Redis + BullMQ |
| Storage | Cloudflare R2 (S3-compatible) |
| Automation | n8n (shared) |
| AI | Claude (provider/model configurable via Admin CMS) |
| Mobile (Phase 2) | React Native / Expo |
| Payment | Midtrans |

## Layout

```
apps/
  backend/   NestJS + Fastify API
  web/       Vite React SPA — user dashboard
  admin/     Vite React SPA — Admin CMS
  landing/   SSR marketing/landing (Phase later)
  mobile/    Expo (Phase 2)
packages/
  shared/    Shared TS types (MarketplaceAdapter interface, DTOs)
infra/       docker (dev) + nginx reference
n8n/         workflow references
```

## Getting started

```bash
corepack enable pnpm        # if pnpm isn't available
pnpm install
docker compose -f infra/docker/docker-compose.dev.yml up -d   # local pg + redis
cp apps/backend/.env.example apps/backend/.env                # then fill values
pnpm dev                    # runs all apps via turbo
```

- Backend: http://localhost:8080/api/health
- Web dashboard: http://localhost:5173
- Admin CMS: http://localhost:5174

## Deploy

Build off-server (local/CI), ship artifacts — the server (3.7 GB, shared with
xtracker + geoscan) is too small to build on. Frontends deploy as static files
to nginx; backend runs as a mem-limited Docker container. Reuse the shared
postgres + n8n. See `Knowledge Base/SERVER_KB.md`.
