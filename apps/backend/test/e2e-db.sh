#!/bin/bash
# DB Postgres 16 sekali-pakai untuk tes E2E (tanpa data, tanpa rahasia).
#   bash test/e2e-db.sh up    -> container autotoko-e2e-pg di 127.0.0.1:5499, skema dimuat
#   bash test/e2e-db.sh down  -> hapus container
# Lalu: E2E_DATABASE_URL=$URL DATABASE_URL=$URL pnpm test
# JANGAN pernah arahkan tes ke DB produksi.
# test/schema.sql = pg_dump --schema-only --no-owner --no-privileges dari prod
# (drizzle-kit migrate pada DB kosong gagal karena urutan fungsi, jadi pakai dump ini).
set -euo pipefail
cd "$(dirname "$0")"
URL=postgres://postgres:e2e@127.0.0.1:5499/autotoko_e2e
case "${1:-up}" in
  up)
    docker rm -f autotoko-e2e-pg >/dev/null 2>&1 || true
    docker run -d --name autotoko-e2e-pg -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=autotoko_e2e \
      -p 127.0.0.1:5499:5432 postgres:16-alpine >/dev/null
    for _ in $(seq 1 30); do docker exec autotoko-e2e-pg pg_isready -U postgres -d autotoko_e2e -q && break; sleep 1; done
    sleep 2
    docker exec -i autotoko-e2e-pg psql -U postgres -d autotoko_e2e -v ON_ERROR_STOP=1 -q < schema.sql >/dev/null
    echo "$URL" ;;
  down) docker rm -f autotoko-e2e-pg >/dev/null; echo removed ;;
esac
