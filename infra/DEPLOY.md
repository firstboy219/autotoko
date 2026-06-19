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

## Redeploy web SPA (static)

```bash
pnpm --filter @autotoko/web build
tar czf - -C apps/web/dist . | ssh -i "$KEY" ubuntu@13.212.182.48 \
  'sudo rm -rf /opt/autotoko/web && sudo mkdir -p /opt/autotoko/web && sudo tar xzf - -C /opt/autotoko/web && sudo chown -R www-data:www-data /opt/autotoko && sudo chmod -R a+rX /opt/autotoko'
```

## Redeploy (build off-server → ship bundle)

```bash
# 1) build + bundle locally (all backend deps are pure-JS → portable)
pnpm --filter @autotoko/shared build && pnpm --filter @autotoko/backend build
rm -rf /tmp/autotoko-deploy
pnpm --filter=@autotoko/backend --legacy deploy --prod /tmp/autotoko-deploy

# 2) ship (preserve symlinks); keep the server .env in place
KEY=/Users/mm/Projects/geoscan/LightsailDefaultKey-ap-southeast-1.pem
ssh -i "$KEY" ubuntu@13.212.182.48 'cp /home/ubuntu/apps/autotoko/.env /tmp/at.env'
tar czf - -C /tmp/autotoko-deploy . | ssh -i "$KEY" ubuntu@13.212.182.48 \
  'rm -rf /home/ubuntu/apps/autotoko && mkdir -p /home/ubuntu/apps/autotoko && tar xzf - -C /home/ubuntu/apps/autotoko && cp /tmp/at.env /home/ubuntu/apps/autotoko/.env'

# 3) migrate (if schema changed) + restart
ssh -i "$KEY" ubuntu@13.212.182.48 'cd /home/ubuntu/apps/autotoko && node dist/database/migrate.js && pm2 restart autotoko-backend'
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
