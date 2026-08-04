# AutoToko Scan Resi (Android)

Aplikasi Android native (Java) untuk merekam nomor resi paket yang sudah
selesai diproduksi. Kamera membaca nomor resi lewat OCR di perangkat, petugas
menekan Simpan, dan server menolak resi yang sudah pernah masuk.

## Kenapa dibuat seperti ini

**Resi tidak pernah disimpan otomatis.** OCR pada label kirim cukup baik tapi
tidak pasti — label penuh angka lain (nomor HP pembeli, order id, kode pos).
Karena server menolak resi yang sudah tercatat, satu pembacaan salah yang
tersimpan otomatis akan memakai "kunci" yang mungkin dibutuhkan paket yang
benar, dan petugas tidak akan pernah tahu. Karena itu aplikasi menampilkan
tebakan terbaik plus alternatifnya, dan manusia yang memutuskan.

**Larangan duplikat ditegakkan oleh UNIQUE INDEX di Postgres**
(`resi_scans_user_resi_unique`), bukan oleh pengecekan di aplikasi. Dua HP yang
memindai label sama pada saat bersamaan akan sama-sama lolos pengecekan
"apakah sudah ada?", dan hanya constraint database yang benar-benar menahan.
Sudah diuji: 5 permintaan serentak → 1 tersimpan, 4 ditolak 409.

**Perbandingan resi dinormalisasi** (huruf besar, hanya A-Z 0-9). OCR membaca
label yang sama sebagai `JX 1234-5678 90`, `jx1234567890`, atau
`JX1234567890` tergantung cahaya dan sudut. Tanpa normalisasi, paket yang sama
bisa masuk tiga kali. Yang sengaja TIDAK disamakan: O/0 dan I/1 — dua resi asli
bisa saja berbeda hanya di situ, dan menyamakannya akan menolak paket sah tanpa
jalan keluar.

**Uniknya per tenant, bukan global.** Dua seller berbeda boleh memegang paket
dengan nomor yang kebetulan sama.

## Build

Perlu JDK 17 + Android SDK (platform 34, build-tools 34).

    cd apps/scanner
    echo "sdk.dir=/path/ke/android-sdk" > local.properties
    gradle :app:testReleaseUnitTest     # WAJIB: menguji logika baca OCR
    gradle :app:assembleRelease

Hasil: `app/build/outputs/apk/release/app-release.apk`

`gradle.properties` sengaja membatasi heap (`-Xmx1024m`, daemon mati) karena
build ini berjalan di server yang sama dengan API produksi.

## Kunci penandatanganan — PENTING

Kunci rilis TIDAK ada di dalam git (lihat `.gitignore`). Di server ada di:

    /home/ubuntu/keys/autotoko-scanner.jks
    /home/ubuntu/keys/scanner-keystore.properties   (berisi password)

**Backup file ini.** Android hanya menerima pembaruan yang ditandatangani kunci
yang sama. Kalau hilang, satu-satunya jalan adalah menerbitkan aplikasi baru dan
semua HP harus uninstall-install ulang. Siapa pun yang memegangnya bisa
menerbitkan pembaruan yang diterima sebagai aplikasi ini.

Tanpa `keystore.properties`, project tetap bisa di-build (tidak tertandatangani).

## Yang diuji

`ResiExtractorTest` (10 test, jalan di JVM tanpa perangkat). OCR sendiri tidak
bisa diuji di JVM, jadi bagian yang mengubah teks OCR menjadi nomor resi
itulah yang harus terbukti benar. Kasus yang dijaga:

- memilih resi, bukan nomor HP pembeli yang ada di label yang sama
- membaca kelompok berspasi (`SPXID 0432 1234 5678`) sebagai satu nomor
- tidak menawarkan pembacaan terpotong sebagai "alternatif"
- mengabaikan kode pos dan tanggal
- aman untuk input kosong/sampah

## Batasan yang diketahui

- Butuh koneksi saat menyimpan. Tidak ada antrian offline; kalau sinyal mati,
  petugas akan melihat pesan gagal dan bisa mengulang. Ini disengaja: antrian
  offline berarti duplikat baru ketahuan belakangan, padahal justru itu yang
  harus dicegah di tempat.
- Kurir dengan awalan huruf yang tidak dikenal dan nomornya tercetak
  berspasi mungkin perlu Input Manual.
- Membaca teks (OCR), bukan barcode. Kalau nanti akurasi jadi masalah,
  membaca barcode pada label jauh lebih pasti daripada OCR.
