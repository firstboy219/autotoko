# Prompt untuk Claude Code — Modul Payout AutoToko

Salin-tempel prompt di bawah ini ke Claude Code. Sebelum menjalankan, pastikan file
`PAYOUT_MODULE_REQUIREMENT.md` sudah ditaruh di root repo project AutoToko (sejajar
dengan `AUTOTOKO_PRD_COMPLETE.md` yang sudah ada), supaya Claude Code bisa membacanya.

---

## PROMPT

```
Saya ingin membangun modul baru bernama "Payout / Pencairan Dana" di project AutoToko ini.
Modul ini menggantikan proses manual pencairan dana marketplace yang saat ini dicatat
di Google Sheets secara semi-manual oleh admin.

PENTING — LAKUKAN INI DULU SEBELUM MENULIS KODE APAPUN:
File PAYOUT_MODULE_REQUIREMENT.md berisi rancangan KEBUTUHAN BISNIS (business logic,
hierarki data, alur kerja, hak akses) — BUKAN skema database atau source code yang harus
diikuti secara literal. Dokumen itu disusun terpisah dari codebase dan mungkin sudah tidak
sinkron dengan struktur aktual project ini (nama tabel, konvensi penamaan, model yang sudah
ada bisa berbeda).

Langkah wajib:
1. Baca AUTOTOKO_PRD_COMPLETE.md untuk konteks tech stack dan konvensi project.
2. Baca PAYOUT_MODULE_REQUIREMENT.md untuk memahami KEBUTUHAN BISNISNYA saja — istilah
   (Seller/Sub-seller/Sub-sub-seller), hierarki, business logic kalkulasi split, alur
   batch, dan hak akses per role.
3. EKSPLORASI codebase aktual: cek skema database yang sebenarnya berjalan sekarang
   (migration files terbaru, model/entity yang ada), cek bagaimana tabel toko, tenant,
   dan user/role sudah didefinisikan, cek konvensi penamaan yang dipakai (snake_case/
   camelCase, prefix tabel, dsb), dan cek apakah sudah ada modul Wallet/transaksi yang
   pola desainnya bisa dicontoh.
4. Setelah eksplorasi, SESUAIKAN semua nama tabel, nama field, dan pendekatan teknis di
   requirement doc dengan apa yang benar-benar ada di codebase ini. Requirement doc adalah
   acuan APA yang perlu dibangun secara bisnis, bukan BAGAIMANA persis strukturnya harus
   ditulis di database.
5. Tunjukkan ke saya ringkasan hasil eksplorasi (skema existing yang relevan) dan
   rencana penyesuaian sebelum menulis migration apapun.

Kerjakan secara bertahap, JANGAN langsung generate semua sekaligus. Konfirmasi ke saya
di akhir tiap tahap sebelum lanjut ke tahap berikutnya.

## TAHAP 1 — Eksplorasi Codebase + Skema Database
- Lakukan langkah eksplorasi di atas terlebih dahulu.
- Rancang tabel/kolom baru yang dibutuhkan untuk mendukung kebutuhan bisnis di Bagian 3-5
  requirement doc (entitas Sub-seller, Sub-sub-seller, Batch Pencairan, Mutasi Pencairan,
  Mutasi Penyesuaian, relasi ke toko, pengaturan sedekah per tenant) — dengan penamaan
  dan struktur yang KONSISTEN dengan konvensi project ini, bukan menyalin literal dari
  requirement doc.
- Pastikan constraint bisnis tetap terjaga: sub_sub_seller pada toko harus kosong jika
  sub_seller juga kosong (validasi di level aplikasi, bukan hanya database).
- Tampilkan rencana migration dan minta konfirmasi saya sebelum dijalankan ke database.

## TAHAP 2 — Business Logic Kalkulasi Split
- Implementasikan fungsi kalkulasi split mengikuti LOGIKA BISNIS di Bagian 4.2 dan 4.3
  requirement doc (rumusnya harus persis sama), mendukung 3 skenario (A: toko milik
  Seller sendiri, B: milik Sub-seller, C: milik Sub-sub-seller) dan 2 basis perhitungan
  sedekah — tapi implementasi teknisnya (nama fungsi, lokasi file, pola service/util)
  ikuti konvensi kode yang sudah ada di project ini.
- WAJIB buat unit test yang memvalidasi: total hasil split (sedekah + seller + subseller +
  subsubseller) SELALU sama persis dengan nominal Kredit input, tidak ada selisih akibat
  pembulatan. Pakai contoh angka di Bagian 4.3 sebagai salah satu test case.
- Fungsi ini harus reusable dan dipanggil dari endpoint create Mutasi Pencairan, bukan
  logic yang tertanam di controller.

## TAHAP 3 — API Endpoints
- CRUD untuk Sub-seller dan Sub-sub-seller (termasuk validasi rate 0-100%, dan validasi
  bahwa sub_sub_seller wajib terhubung ke sub_seller yang valid dalam tenant yang sama).
- Endpoint Batch: mulai batch baru, tutup & lapor, tandai sudah transfer ke Admin
  (dengan upload bukti), tandai diteruskan per Mutasi Pencairan.
- Endpoint Mutasi Pencairan: create (draft), update (hanya jika masih draft), ubah ke
  status selesai (dengan validasi semua bukti wajib sudah terupload sesuai skenario
  yang berlaku untuk toko tersebut), list dengan filter.
- Endpoint Mutasi Penyesuaian: create koreksi yang mereferensikan Mutasi Pencairan asli.
- Terapkan hak akses sesuai kebutuhan bisnis di Bagian 7 requirement doc (siapa boleh
  apa), TAPI gunakan sistem role/permission yang SUDAH ADA di project ini — cek dulu
  bagaimana auth middleware dan role existing (Owner/Admin/dst) sudah diimplementasi,
  jangan bikin sistem role baru yang terpisah kalau yang lama masih relevan.
- Upload file bukti pakai infrastruktur file storage yang sudah dipakai project ini
  (cek AUTOTOKO_PRD_COMPLETE.md bagian tech stack).

## TAHAP 4 — Frontend
- Bangun 8 halaman/komponen sesuai Bagian 9 requirement doc:
  List Batch, Detail Batch, Form Input Mutasi Pencairan, List Mutasi Pencairan (lintas batch),
  Manajemen Sub-seller, Manajemen Sub-sub-seller, Pengaturan Payout Tenant, Portal
  Sub-seller/Sub-sub-seller (read-only).
- Form Input Mutasi Pencairan: kalkulasi split harus muncul real-time (read-only) begitu
  nominal kredit diinput, mengikuti skenario A/B/C sesuai toko yang dipilih. Tampilkan
  badge peringatan jika nominal_bukti_marketplace berbeda dari nominal_kredit.
- Ikuti konvensi UI/component library yang sudah dipakai di project ini (Shadcn/UI +
  Tailwind, sesuai PRD).
- Gunakan koneksi WebSocket yang sudah ada di project untuk notifikasi real-time saat
  status batch berubah, konsisten dengan pola real-time notification lain di AutoToko.

## TAHAP 5 — Testing End-to-End
- Setelah semua tahap di atas selesai, jalankan skenario uji manual:
  1. Buat Sub-seller baru, assign ke toko yang sudah ada.
  2. Buat Sub-sub-seller di bawah Sub-seller itu, assign ke toko lain.
  3. Buat batch baru, input 3 Mutasi Pencairan (satu untuk masing-masing skenario
     A/B/C), pastikan kalkulasi split benar sesuai contoh di Bagian 4.3.
  4. Coba ubah status ke "selesai" tanpa upload bukti lengkap — harus ditolak sistem.
  5. Lengkapi bukti, ubah ke selesai — pastikan record terkunci (tidak bisa diedit langsung).
  6. Buat Mutasi Penyesuaian untuk salah satu transaksi, pastikan data asli tidak berubah.
  7. Tutup batch, tandai sudah transfer ke Admin, tandai diteruskan satu-satu — pastikan
     status batch akhirnya berubah ke "selesai" otomatis setelah semua item diteruskan.
- Laporkan hasil pengujian ke saya sebelum modul ini dianggap selesai.

Mulai dari TAHAP 1 dulu. Tunjukkan rencana migration-nya ke saya sebelum lanjut ke TAHAP 2.
```

---

## Catatan Penggunaan

- Requirement doc ini adalah acuan KEBUTUHAN BISNIS (istilah, hierarki, rumus kalkulasi,
  alur kerja, hak akses) — bukan skema database final. Prompt sudah diarahkan supaya
  Claude Code mengeksplorasi source code aktual dulu, baru menyesuaikan penamaan tabel/
  field ke konvensi yang benar-benar berjalan sekarang. Ini penting karena source code
  project bisa saja sudah berkembang sejak dokumen ini dibuat.
- Prompt sengaja dipecah 5 tahap dengan jeda konfirmasi, supaya Anda sebagai BA bisa
  mengecek hasil tiap tahap tanpa perlu membaca kode — cukup lihat apakah hasil eksplorasi,
  migration, hasil test, atau tampilan UI sudah sesuai ekspektasi bisnis di requirement doc.
- Kalau Claude Code melaporkan struktur existing yang berbeda jauh dari asumsi requirement
  doc (misal ternyata sudah ada konsep "reseller" dengan nama lain, atau modul Wallet
  yang polanya beda), itu wajar — biarkan dia menyesuaikan istilah teknis, TAPI pastikan
  logika bisnis (rumus split, hierarki 3 level, alur batch) tetap dipertahankan persis
  seperti yang disepakati di requirement doc ini.
- Kalau ada bagian requirement yang menurut Claude Code bentrok dengan struktur existing
  (misal toko sudah punya relasi lain yang konflik), minta dia berhenti dan laporkan
  dulu ke Anda sebelum memutuskan sendiri — jangan biarkan dia mengubah business logic
  secara sepihak hanya demi menyesuaikan kode lama.
- Simpan kedua file (requirement doc + prompt ini) di project Anda sebagai dokumentasi,
  supaya kalau ada pengembang lain atau sesi Claude Code baru, konteksnya tidak hilang.
