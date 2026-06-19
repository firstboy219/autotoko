#!/usr/bin/env bash
# Open an SSH tunnel from local :15432 to the shared server's postgres :5432,
# so local dev / drizzle-kit can reach the `autotoko` database.
#   Usage: bash infra/scripts/db-tunnel.sh         (foreground; Ctrl-C to stop)
#          bash infra/scripts/db-tunnel.sh --bg    (background)
set -euo pipefail

KEY="${LIGHTSAIL_KEY:-/Users/mm/Projects/geoscan/LightsailDefaultKey-ap-southeast-1.pem}"
HOST="ubuntu@13.212.182.48"
LOCAL_PORT=15432

if [[ "${1:-}" == "--bg" ]]; then
  ssh -i "$KEY" -o ExitOnForwardFailure=yes -f -N -L ${LOCAL_PORT}:127.0.0.1:5432 "$HOST"
  echo "Tunnel up in background: localhost:${LOCAL_PORT} -> postgres:5432"
  echo "Stop with: pkill -f '${LOCAL_PORT}:127.0.0.1:5432'"
else
  echo "Tunnel: localhost:${LOCAL_PORT} -> postgres:5432 (Ctrl-C to stop)"
  exec ssh -i "$KEY" -o ExitOnForwardFailure=yes -N -L ${LOCAL_PORT}:127.0.0.1:5432 "$HOST"
fi
