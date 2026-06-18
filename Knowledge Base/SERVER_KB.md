Diserver ini ada 2 apps yang sedang running yaitu xtracker & geoscan,berikut detail dari geoscan :

# Server Knowledge Base — cosger.online (Lightsail)

> Canonical reference for any AI/engineer running future work on this server.
> Snapshot date: **2026-06-17**. Verify live state before acting (this drifts).
> Generated from a live inventory; values without secrets.

---

## 1. Identity & access
- **Provider:** AWS Lightsail (Ubuntu). Public IP **13.212.182.48**, internal host `ip-172-26-12-215`.
- **SSH:** `ssh -i LightsailDefaultKey-ap-southeast-1.pem ubuntu@13.212.182.48`
  - Key lives in the geoscan repo root, **gitignored** (`*.pem`) — never commit it.
  - User `ubuntu` has **passwordless sudo**.
- **Region:** ap-southeast-1.
- **Hardware:** 2 vCPU, **3.7 GB RAM** (~1.5 GB used, tight — respect container mem limits), 77 GB disk (~16% used).
- **AWS firewall:** ports 22, 80, 443 open publicly. (5432/5678 also *listen* on 0.0.0.0 — see Security.)

## 2. ⚠️ Coexistence rule — DO NOT BREAK XTRACKER
This host runs **two independent products**. Geoscan must never disrupt xtracker.
- **xtracker** — production app. Node backend via **pm2** (`xtracker-backend`, fork mode, listens `:3000`, user `ubuntu`), served at **api.cosger.online**. Code at `/home/ubuntu/apps/xtracker/backend`. DB = `saasdb`.
- **Shared infra used by BOTH:** the `postgres` container and the `n8n` container. Restarting **n8n** causes a ~20–30s blip for xtracker too → only restart when necessary; it's been done safely before. Never `docker rm`/wipe postgres or n8n.
- Geoscan's own containers (geoscan-*) can be rebuilt/restarted freely — that does NOT affect xtracker.

## 3. Containers (docker)
| Container | Image | Mem limit | Networks | Port (host) | Notes |
|---|---|---|---|---|---|
| `geoscan-backend` | geoscan-backend:latest | 512 MB | postgres_default + **n8n_default** | 127.0.0.1:8000 | FastAPI (uvicorn). On both nets so n8n can reach it. |
| `geoscan-celery` | geoscan-backend:latest | 400 MB | postgres_default | — | Celery worker `-c 1` (WAJIB, small host). Shows "unhealthy" (no real healthcheck) but functions. |
| `geoscan-qdrant` | qdrant/qdrant:latest | 384 MB | postgres_default | — | Vector DB (embeddings). Collections: `geoscan_historical`, `geoscan_situations`. |
| `geoscan-redis` | redis:7-alpine | 128 MB | postgres_default | — | Celery broker + cache + OTP store. |
| `n8n` | n8nio/n8n:latest (**v2.22.5**) | — | n8n_default | 0.0.0.0:5678 | SHARED w/ xtracker. SQLite at `/home/node/.n8n/database.sqlite`. |
| `postgres` | postgres:16-alpine | — | postgres_default | 0.0.0.0:5432 | SHARED. superuser `admin`. |

Networks: **`postgres_default`** (db/redis/qdrant/backend/celery), **`n8n_default`** (n8n + backend). Backend joins both: `run-backend.sh` runs it on postgres_default then `docker network connect n8n_default`.

## 4. Domains & TLS (nginx + certbot, auto-renew)
| Domain | Serves | nginx → |
|---|---|---|
| **apigeo.cosger.online** | Geoscan API + CMS `/admin` | proxy → 127.0.0.1:8000 |
| **viewgeo.cosger.online** | Geoscan web portal (Next.js static) | static `/opt/geoscan/web-portal` + `/api/` proxy → :8000 |
| **api.cosger.online** | xtracker | proxy → :3000 |
| n8n.cosger.online | n8n UI (shared) | (per n8n setup) |

nginx sites in `/etc/nginx/sites-enabled/`: apigeo / viewgeo / xtracker / default. Geoscan configs versioned in `infra/nginx/`. Certs in `/etc/letsencrypt/live/`.

## 5. Databases (postgres container)
- **`geoscan`** (~35 MB) — owner `geoscan_user`. Geoscan app DB. Alembic at **0013**. Live counts (2026-06-17): news_articles ~3037, crises 30, scenarios 13 (seeded only), impacts 0 (AI-blocked), users 6.
- **`saasdb`** (~11 MB) — xtracker. Do not touch.
- Superuser `admin`. Query: `docker exec -i postgres psql -U geoscan_user -d geoscan -c "..."`.

## 6. Geoscan codebase & deploy
- **Repo:** https://github.com/firstboy219/geos.git (private). Live HEAD `d6ef046` (2026-06-16).
- **Live checkout:** `/opt/geoscan` (git clone). `.env` there is gitignored — preserved across deploys.
- **Layout:** `backend/` (FastAPI + Alembic + Celery), `mobile/` (Expo RN app), `web/` (Next.js portal source; build output → `/opt/geoscan/web-portal`), `infra/docker/` (run scripts), `infra/nginx/`, `scripts/`, `n8n/` (workflow JSON references).
- **Backend deploy (safe; xtracker untouched):**
  ```
  cd /opt/geoscan && git fetch origin && git reset --hard origin/main
  docker build -t geoscan-backend:latest backend
  docker run --rm --network postgres_default --env-file /opt/geoscan/.env geoscan-backend:latest alembic upgrade head   # if migrations
  bash infra/docker/run-backend.sh && bash infra/docker/run-celery.sh
  curl -s http://127.0.0.1:8000/health
  ```
- **Web portal deploy:** build locally (`cd web && npm i && npx next build`) → scp `web/out/` → `/opt/geoscan/web-portal` (out/ is gitignored; not built on server). Content is live via client fetch — only code changes need rebuild.
- **GitHub pushes are slow/flaky from here** → use `git -c http.version=HTTP/1.1 push`; verify with `git ls-remote origin main` and re-push if needed (background pushes sometimes don't land). The deploy token **lacks `workflow` scope** (can't push `.github/workflows/`).

## 7. AI engine & the quota reality (important)
- Provider/model switchable live via CMS (`app_settings`): currently **Gemini**, analysis `gemini-2.5-flash`, embeddings `gemini-embedding-001` (1536-dim → Qdrant). OpenAI key also present in `.env` as fallback.
- **Free-tier Gemini caps (the binding constraint):** generate `gemini-2.5-flash` = **5/min AND 20/day**; embeddings = **100/min AND 1000/day**. → AI-generate stages (16-layer scenarios, per-scenario impacts, personal impact) **cannot backfill** on free tier; they wait until billing/quota is raised in the CMS.
- **Non-AI replacements built** (work at volume, no quota): translation to ID (free Google Translate endpoint), intisari/quote extraction (extractive), news→situation grouping (embeddings + cached vectors), keyword category/region classification. `llm_client._with_retry` honours retry delays and fails fast on `PerDay`.
- Embeddings are cached on `news_articles.embedding` → re-clustering/threshold tuning costs no quota (`/internal/news/recluster?threshold=`).

## 8. n8n workflows
- ~13 geoscan workflows `geoscanWF01..13` (+ xtracker's own) on the SHARED n8n. WF-01 = OSINT news ingestion (schedule every 15 min → fetch sources → parse → POST `/internal/news/ingest`).
- **Editing a workflow:** `docker exec n8n n8n export:workflow --id=geoscanWFxx --output=/tmp/x.json` → patch JSON → `docker cp` in → `n8n import:workflow --input=...` → `n8n update:workflow --id=geoscanWFxx --active=true` → **`docker restart n8n`** (needed for active/schedule changes; brief blip).
- Gotchas: CLI `n8n execute` is blocked while n8n runs (port 5679 task-broker conflict) — trigger via schedule or REST instead. Code nodes that fan-out must use **Run Once for All Items** (returning an array from per-item mode errors in 2.22.5). HTTP "Fetch feed" must have `onError=continueRegularOutput` so one dead feed doesn't abort the run.
- Datacenter IP is **blocked by many direct outlet RSS** (Detik, Kompas, CNN Indonesia 403, Tempo timeout) → Indonesian outlets are sourced via **Google News RSS `site:` queries** instead. Bluesky/Mastodon native RSS work; Nitter/public-RSSHub don't.

## 9. Retention & cron — ⚠️ NOT INSTALLED
- Host crontab for `ubuntu` is **empty**. The intended jobs are NOT active:
  - DB backup: `scripts/backup_db.sh` (intended `0 20 * * *`).
  - News/data retention purge (4-month): `scripts/purge_old_news.sh` (intended `0 2 * * *`).
- Action for next maintainer: install these via `crontab -e`. Until then `news_articles` grows unbounded (already ~3000) and there are no automated backups.

## 10. Secrets — where they live (never commit)
`/opt/geoscan/.env` holds: DATABASE_URL, DB_*, SECRET_KEY, INTERNAL_API_KEY, JWT_*, REDIS_URL, GEMINI_API_KEY, GEMINI_MODEL_*, QDRANT_URL, PINECONE_* (legacy/unused, Qdrant replaced it), FIREBASE_CREDENTIALS_JSON, STRIPE_*, ALLOWED_ORIGINS, SENTRY_DSN, CELERY_*, ADMIN_PASSWORD (CMS login), OPENAI_API_KEY. CMS runtime overrides live in `app_settings` table (AI keys/models, news sources).

## 11. Security notes (for follow-up)
- **postgres (5432) and n8n (5678) listen on 0.0.0.0** — exposed at the OS level. They're protected only if the Lightsail firewall blocks those ports (verify). Recommend binding to 127.0.0.1 / private net or firewalling.
- Backend (8000) and qdrant/redis are correctly internal (127.0.0.1 / docker net only).
- `/internal/*` endpoints are gated by `INTERNAL_API_KEY` (X-Internal-Key); `/public/*` are read-only no-auth (for the portal).

## 12. Quick health checks
```
curl -s http://127.0.0.1:8000/health                       # geoscan backend
curl -s https://apigeo.cosger.online/health                # public
curl -s https://viewgeo.cosger.online/api/public/situations # portal API
docker ps; docker stats --no-stream                        # containers + mem
pm2 ls                                                      # xtracker
docker exec n8n n8n list:workflow                          # workflows
```
