# Deploying AutoToko backend (cosger.online)

The backend runs on the shared host **as a pm2 process** (like xtracker) — no
Docker build on the box (too small; OOM risk). Build off-server, ship a
self-contained bundle. It reuses the shared **postgres** (`autotoko` DB) and
**n8n**; it must never disturb xtracker/geoscan.

## Current deployment (2026-06-18)

- pm2 process: **`autotoko-backend`** → `node dist/main.js`, listens `0.0.0.0:8090`
  (8090 not in the Lightsail public firewall; reachable internally only).
- Code/bundle at `/home/ubuntu/apps/autotoko`, env at `/home/ubuntu/apps/autotoko/.env`.
- DB: `postgresql://autotoko_user@127.0.0.1:5432/autotoko` (host → published pg port).
- Reachable from the **n8n container** via the host gateway `http://172.18.0.1:8090`.
- Midtrans creds stored in `admin_settings` (encrypted) — shared with xtracker
  (PRODUCTION keys; use sandbox keys for test flows).

## Public endpoints (nginx + Let's Encrypt, live)

| URL | Serves |
|---|---|
| `https://apitoko.cosger.online` | API → proxy `127.0.0.1:8090` |
| `https://viewtoko.cosger.online` | web SPA (static, root `/opt/autotoko/web`) + `/api/` proxy |

- nginx vhosts: `/etc/nginx/sites-enabled/{apitoko,viewtoko}`. TLS via certbot
  (auto-renew). Configure these in the respective dashboards:
  - Marketplace webhooks: `https://apitoko.cosger.online/api/webhooks/{tiktok,shopee}`
  - Midtrans notification: `https://apitoko.cosger.online/api/wallet/midtrans/notification`
- `APP_URL=https://viewtoko.cosger.online` (WA deep links + OAuth callback redirects).

> ⚠️ **FLAKY-NETWORK / .env RULES (read first — see relay sesi 12 & 16 incidents).**
> 1. **NEVER** `rm -rf live-dir && tar x` in one pipe (a mid-transfer drop wiped the
>    server in sesi 12). Use `rsync --partial` (resumable) and only swap statics atomically.
> 2. The `pnpm deploy` bundle **contains the local gitignored `apps/backend/.env`**
>    (PORT=8080, DB→tunnel `15432`). A plain rsync of the bundle **overwrites the
>    server `.env`** → app boots on :8080 against an unreachable DB → nginx 502
>    (sesi 16). **ALWAYS rsync the backend bundle with `--exclude='.env*'`.**
> 3. **Canonical good prod `.env` backup lives on the server at `/tmp/at.env`**
>    (22 lines, PORT=8090, DB on `5432`). If `.env` is ever clobbered, restore it:
>    `cp -a /tmp/at.env /home/ubuntu/apps/autotoko/.env && pm2 restart autotoko-backend --update-env`.
> 4. Verify externally with `curl -4` (owner IPv6/NAT64 times out).

```bash
KEY=/Users/mm/Projects/geoscan/LightsailDefaultKey-ap-southeast-1.pem
SSHI=(-i "$KEY" -o ConnectTimeout=15 -o ServerAliveInterval=10)   # use inline, zsh won't word-split a var
```

## Redeploy web/admin SPA (static, atomic swap)

```bash
cd apps/web && npx vite build && cd -        # or apps/admin (npx vite build avoids the pnpm deps-check)
# ship to a temp dir, then atomic swap — live dir untouched if the transfer fails
rsync -az --partial --delete -e "ssh ${SSHI[*]}" apps/web/dist/ ubuntu@13.212.182.48:/tmp/web-new/
ssh "${SSHI[@]}" ubuntu@13.212.182.48 \
  'sudo rsync -a --delete /tmp/web-new/ /opt/autotoko/web/ && sudo chown -R www-data:www-data /opt/autotoko && sudo chmod -R a+rX /opt/autotoko'
# admin → /tmp/admin-new → /opt/autotoko/admin (same pattern)
```

## Redeploy backend (build off-server → ship bundle)

```bash
# 1) build + bundle locally (all backend deps are pure-JS → portable)
#    build shared+backend directly (the pnpm wrapper trips a deps-status check):
(cd packages/shared && npx tsc -p tsconfig.json) && (cd apps/backend && npx nest build)
rm -rf /tmp/autotoko-deploy
pnpm --filter=@autotoko/backend --legacy deploy --prod /tmp/autotoko-deploy

# 2) back up the LIVE server .env first, then rsync the bundle EXCLUDING env files
ssh "${SSHI[@]}" ubuntu@13.212.182.48 'cp -a /home/ubuntu/apps/autotoko/.env /tmp/at.env.predeploy'
rsync -az --partial --exclude='.env*' -e "ssh ${SSHI[*]}" \
  /tmp/autotoko-deploy/ ubuntu@13.212.182.48:/home/ubuntu/apps/autotoko/

# 3) migrate (only if schema changed) + restart, then verify
ssh "${SSHI[@]}" ubuntu@13.212.182.48 \
  'cd /home/ubuntu/apps/autotoko && grep -q "^PORT=8090" .env || cp -a /tmp/at.env .env; node dist/database/migrate.js; pm2 restart autotoko-backend --update-env'
curl -4 -s https://apitoko.cosger.online/api/health   # expect db:up on :8090
```

## WA login n8n integration

Shared workflow `taruh data mentah (by wa/app)` (id `SDBMhwhGFhPFKnBi`) was
patched additively (see `n8n/autotoko-wa-login.md` + `n8n/patch-wa-login.cjs`):
a 3rd Switch1 branch routes `AUTOTOKO-` messages to the verify endpoint. Backup
of the pre-patch workflow: `/home/ubuntu/apps/autotoko/wf_orig.backup.json`
(rollback: `docker cp` it into n8n → `n8n import:workflow` → `docker restart n8n`).

## Security TODO before public launch

- `DEV_LOGIN_ENABLED=true` (user/user → admin) is a backdoor — disable once real
  auth UX ships, or before the API is exposed publicly.
- Wire native webhook signature verification; set `WEBHOOK_INGEST_SECRET`.
- Enable Postgres RLS on tenant tables.
