#!/bin/bash
# Gabungkan kembali uploads.tar.gz.gpg.part000..027 jadi satu file,
# lalu dekripsi dan ekstrak. Jalankan dari dalam folder uploads-parts/.
set -euo pipefail
cat uploads.tar.gz.gpg.part* > ../uploads.tar.gz.gpg
echo "Digabung -> ../uploads.tar.gz.gpg. Lanjut dekripsi:"
echo "gpg --batch --passphrase-file /path/to/passphrase.txt --decrypt ../uploads.tar.gz.gpg > uploads.tar.gz"
echo "tar -xzf uploads.tar.gz -C /home/ubuntu/apps/"
