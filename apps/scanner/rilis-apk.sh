#!/bin/bash
# =====================================================================
# Rilis APK "Scan Resi" AutoToko -> daftar versi aplikasi.
#
# Menerbitkan sebuah build sebagai VERSI RESMI: menimpa APK rilis kanonik
# lalu menyisipkan entri baru di AWAL releases.json. Berkas itu dibaca oleh
# GET /api/resi/app/releases, yang memberi makan halaman "Versi Aplikasi" di
# web DAN penanda "Versi baru tersedia" di menu APK. Jadi inilah satu-satunya
# langkah yang membuat sebuah update APK muncul di fitur versi web/APK.
#
# Update bersifat DITAWARKAN, bukan paksa: HP yang belum update tetap jalan.
#
# Pakai (jalankan di server, dari folder apps/scanner):
#   bash rilis-apk.sh "Catatan rilis dalam bahasa seller..."
#
# SEBELUM menjalankan: naikkan versionCode + versionName di app/build.gradle.
# Skrip menolak bila versionCode itu sudah pernah diterbitkan.
# =====================================================================
set -euo pipefail

NOTES="${1:-}"
SCANNER_DIR="$(cd "$(dirname "$0")" && pwd)"
GRADLE="$SCANNER_DIR/app/build.gradle"
APK_DIR="/opt/autotoko/downloads"
REL_NAME="scan-resi-ZUOm6H57GS7Q.apk"     # nama berkas rilis SELALU sama; versi dibedakan sha256
REL_JSON="$APK_DIR/releases.json"
DL_URL="https://viewtoko.cosger.online/unduh/${REL_NAME}"
# Sidik kunci produksi yang dipakai HP di lapangan. APK bersidik lain gagal
# dipasang dan jalan keluarnya cuma uninstall (= gudang kehilangan sesi login).
EXPECT_FP="f875cdc1dd6d8a21774d8787cb06f9ccfba5ebe089d6ade7d7020343918fb87c"

export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/home/ubuntu/gradle-8.7/bin:$PATH"
export JAVA_HOME="$(dirname "$(dirname "$(readlink -f "$(which javac)")")")"
export ANDROID_HOME="${ANDROID_HOME:-/home/ubuntu/android-sdk}"

[ -n "$NOTES" ] || { echo "Wajib: catatan rilis sebagai argumen pertama."; exit 1; }

VCODE=$(grep -oE 'versionCode[[:space:]]+[0-9]+' "$GRADLE" | grep -oE '[0-9]+' | head -1)
VNAME=$(grep -oE 'versionName[[:space:]]+"[^"]+"' "$GRADLE" | sed -E 's/.*"([^"]+)".*/\1/' | head -1)
echo "Versi dari build.gradle: $VNAME (code $VCODE)"

# Cegah entri ganda / lupa bump.
if [ -f "$REL_JSON" ]; then
  if python3 -c "import json,sys; d=json.load(open('$REL_JSON')); sys.exit(0 if any(int(r.get('versionCode',0))==$VCODE for r in d) else 1)"; then
    echo "GAGAL: versionCode $VCODE sudah ada di releases.json. Naikkan dulu di build.gradle."; exit 1
  fi
fi

echo "=== build assembleRelease ==="
( cd "$SCANNER_DIR" && gradle :app:assembleRelease -q )
APK="$SCANNER_DIR/app/build/outputs/apk/release/app-release.apk"
[ -f "$APK" ] || { echo "GAGAL: APK tidak ditemukan di $APK"; exit 1; }

echo "=== verifikasi sidik kunci (SEBELUM menyentuh $APK_DIR) ==="
APKSIGNER=$(ls -1 "$ANDROID_HOME"/build-tools/*/apksigner | sort -V | tail -1)
FP=$("$APKSIGNER" verify --print-certs "$APK" | grep -i 'SHA-256 digest' | grep -oE '[0-9a-f]{64}' | head -1)
echo "  sidik APK : $FP"
echo "  diharapkan: $EXPECT_FP"
[ "$FP" = "$EXPECT_FP" ] || { echo "GAGAL: sidik kunci TIDAK cocok. Batal terbit."; exit 1; }

SIZE=$(stat -c %s "$APK")
SHA=$(sha256sum "$APK" | cut -d' ' -f1)
PUB=$(date -u +%Y-%m-%dT%H:%M:%S.%6N+00:00)
echo "  size=$SIZE sha256=$SHA"

echo "=== terbitkan (butuh sudo untuk $APK_DIR yang root-owned) ==="
sudo cp "$APK" "$APK_DIR/$REL_NAME"
sudo chmod a+r "$APK_DIR/$REL_NAME"

# Susun releases.json baru sebagai ubuntu di temp, lalu sudo cp menimpa.
TMP_JSON=$(mktemp)
python3 - "$REL_JSON" "$VNAME" "$VCODE" "$REL_NAME" "$SIZE" "$SHA" "$PUB" "$NOTES" "$TMP_JSON" <<'PY'
import json, sys, os
src, vname, vcode, fn, size, sha, pub, notes, out = sys.argv[1:10]
data = []
if os.path.exists(src):
    try: data = json.load(open(src, encoding="utf-8"))
    except Exception: data = []
entry = {"versionName": vname, "versionCode": int(vcode), "fileName": fn,
         "sizeBytes": int(size), "sha256": sha, "publishedAt": pub, "notes": notes}
data = [entry] + [r for r in data if int(r.get("versionCode", 0)) != int(vcode)]
data.sort(key=lambda r: int(r.get("versionCode", 0)), reverse=True)
json.dump(data, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("  releases.json: %d entri; teratas %s (code %s)" % (len(data), vname, vcode))
PY
sudo cp "$TMP_JSON" "$REL_JSON"
sudo chmod a+r "$REL_JSON"
rm -f "$TMP_JSON"

echo "=== verifikasi unduhan (sha256 yang benar-benar dilayani) ==="
SERVED=$(curl -s "$DL_URL" | sha256sum | cut -d' ' -f1)
echo "  disk  : $SHA"
echo "  served: $SERVED"
[ "$SHA" = "$SERVED" ] || { echo "GAGAL: sha256 unduhan tidak cocok."; exit 1; }
echo "SELESAI RILIS $VNAME (code $VCODE)"
