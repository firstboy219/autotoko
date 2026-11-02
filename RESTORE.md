# AutoToko — Migration Backup (2026-11-02)

Encrypted backup for moving AutoToko off this server to a new one.
Everything here is encrypted with AES-256 (gpg symmetric), one shared
passphrase — given to the owner separately, never committed to this repo.

## What's in this backup

| File | Contents | Encrypted |
|---|---|---|
| `autotoko_db.dump.gpg` | Full Postgres dump (`pg_dump -Fc`), all tenants | yes |
| `configs.tar.gz.gpg` | nginx site configs (apitoko, viewtoko) + deploy-be.sh / deploy-web.sh | yes |
| `apk-downloads.tar.gz.gpg` | `/opt/autotoko/downloads` — published scanner APKs + releases.json | yes |
| `uploads.tar.gz.gpg` | `/home/ubuntu/apps/autotoko-uploads` — resi photos, label/packing PDFs, proof uploads | yes |

**NOT included here** (handed to the owner directly, out of band — too
sensitive to route through git even encrypted):
- `apps/autotoko/.env` (DB creds, `ENCRYPTION_KEY` for stored TikTok tokens,
  `JWT_SECRET`, SMTP/WA credentials, admin login)
- `/home/ubuntu/keys/autotoko-scanner.jks` + `scanner-keystore.properties`
  (APK signing key — **if this is lost, every installed scanner APK can
  never receive another update**; existing installs would need a full
  uninstall/reinstall across the whole warehouse)

Source code is already on the `develop` branch of this same repo — not
duplicated here.

## Restore on the new server

```bash
# 1. Decrypt (repeat per file, same passphrase for all)
gpg --batch --passphrase-file /path/to/passphrase.txt \
    --decrypt autotoko_db.dump.gpg > autotoko_db.dump
gpg --batch --passphrase-file /path/to/passphrase.txt \
    --decrypt configs.tar.gz.gpg > configs.tar.gz
gpg --batch --passphrase-file /path/to/passphrase.txt \
    --decrypt apk-downloads.tar.gz.gpg > apk-downloads.tar.gz
gpg --batch --passphrase-file /path/to/passphrase.txt \
    --decrypt uploads.tar.gz.gpg > uploads.tar.gz

# 2. Restore the database (create an empty `autotoko` DB first, same
#    roles: autotoko_user + the admin superuser used for RLS-forced tables)
pg_restore -U admin -d autotoko --no-owner --role=autotoko_user autotoko_db.dump

# 3. Unpack uploads to where UPLOAD_DIR points (apps/autotoko-uploads)
tar -xzf uploads.tar.gz -C /home/ubuntu/apps/

# 4. Unpack APK downloads to /opt/autotoko/downloads
tar -xzf apk-downloads.tar.gz -C /opt/autotoko/

# 5. Unpack configs, adapt nginx server_name/cert paths to the new box,
#    re-point DNS (apitoko.cosger.online, viewtoko.cosger.online) to the
#    new server's IP, reissue certs via certbot
tar -xzf configs.tar.gz

# 6. Copy .env and the APK keystore back in (received out of band, not
#    from this repo) to apps/autotoko/.env and /home/ubuntu/keys/

# 7. Clone `develop`, npm install, build, pm2 start — same steps as
#    deploy-be.sh / deploy-web.sh already describe.
```

## Cleanup after migration is confirmed working

- Delete this `backup/migration-20261102` branch (or at least the large
  binary files in it) — it's only meant to survive long enough for the move.
- Rotate `JWT_SECRET` and any admin/SMTP/WA passwords if there's any doubt
  about who saw them. `ENCRYPTION_KEY` CANNOT be rotated without
  re-encrypting every stored TikTok token — leave that one alone.
