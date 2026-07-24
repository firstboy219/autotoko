# MODUL PAYOUT / PENCAIRAN DANA — AUTOTOKO
## Requirement Document untuk Claude Code

**Status:** Ready for Development
**Terkait:** AUTOTOKO_PRD_COMPLETE.md (dokumen utama)
**Tujuan:** Menggantikan proses manual pencairan dana via Google Sheets dengan modul terintegrasi di AutoToko

---

## 1. LATAR BELAKANG

Seller AutoToko (termasuk Putra sendiri) saat ini mencatat pencairan dana dari marketplace secara manual di Google Sheets: mutasi masuk, split ke pihak terkait, dan bukti transfer berupa link Google Drive. Proses ini rawan salah hitung, tidak ada validasi silang, dan sulit dilacak riwayatnya per sub-seller. Modul Payout menggantikan proses ini sepenuhnya di dalam platform, sebagai **fitur inti platform** yang tersedia untuk semua tenant Seller — bukan fitur eksklusif untuk satu tenant tertentu.

---

## 2. KAMUS ISTILAH (WAJIB DIPAHAMI — SELARAS DENGAN PRD UTAMA)

| Istilah | Definisi |
|---|---|
| **Seller** | Tenant/akun yang terdaftar di AutoToko. Satu tenant bisa punya beberapa User (misal Owner dan Admin/Staff berbagi satu tenant Seller yang sama). |
| **Sub-seller** | Orang yang punya akun marketplace sendiri, menitipkan pengelolaan tokonya ke suatu tenant Seller. Sub-seller adalah entitas data di bawah tenant Seller, bukan tenant terpisah. |
| **Sub-sub-seller** | Orang yang punya akun marketplace sendiri, menitipkan pengelolaan tokonya ke seorang Sub-seller (bukan langsung ke Seller). Level maksimal hierarki — tidak ada level ke-4. |
| **Toko** | Akun marketplace (TikTok Shop/Shopee) yang terhubung ke platform. Bisa milik Seller sendiri, milik Sub-seller, atau milik Sub-sub-seller. |
| **Kredit (IN)** | Dana settlement yang cair dari marketplace, masuk ke rekening penampung Seller. |
| **Batch Pencairan** | Kumpulan beberapa Mutasi Pencairan yang direkap jadi satu unit kerja (relevan untuk alur kerja Admin/Staff, lihat Bagian 6). |
| **Mutasi Pencairan** | Satu record transaksi = satu kali dana cair dari satu Toko, sudah displit sesuai hierarki. |
| **Mutasi Penyesuaian** | Entri koreksi terpisah untuk membetulkan Mutasi Pencairan yang sudah berstatus "Selesai" (tidak boleh edit langsung). |

---

## 3. HIERARKI DATA

```
Tenant "Seller" (akun terdaftar di AutoToko)
   │
   ├── User: Owner (approve transfer, full akses, lihat semua nominal)
   ├── User: Admin/Staff (input data, tidak bisa approve transfer, lihat semua nominal)
   │
   ├──→ Toko (milik Seller sendiri langsung — tidak ada split sub-seller)
   │
   └──→ Sub-seller (entitas, dibuat oleh Seller, punya login sendiri)
          ├── Toko (milik Sub-seller langsung)
          │
          └──→ Sub-sub-seller (entitas, dibuat oleh Sub-seller, punya login sendiri)
                 └── Toko (milik Sub-sub-seller)
```

**Aturan penting:**
- Setiap tenant Seller terpisah total — tidak saling melihat data tenant lain (multi-tenant SaaS standar).
- Toko dibuat dulu (proses OMS/WMS yang sudah ada), baru kemudian di-assign/dihubungkan ke Sub-seller atau Sub-sub-seller yang sudah ada. Field relasi bersifat nullable.
- Sub-sub-seller HARUS terhubung ke satu Sub-seller (tidak bisa langsung ke Seller).
- Hierarki dibatasi maksimal 3 level: Seller → Sub-seller → Sub-sub-seller. Tidak ada Sub-sub-sub-seller.

---

## 4. BUSINESS LOGIC — KALKULASI SPLIT DANA

### 4.1 Pengaturan Rate (Level Tenant Seller)

| Setting | Lokasi | Sifat |
|---|---|---|
| `sedekah_rate` | Global per tenant Seller | Default 5%, editable oleh Owner kapan saja |
| `sedekah_basis` | Global per tenant Seller | Pilihan: `TOTAL_KREDIT_AWAL` atau `SISA_SETELAH_SPLIT_SUBSELLER` (lihat 4.3) |
| `rate_default` (Sub-seller) | Per entitas Sub-seller | Default 20%, bisa berbeda tiap Sub-seller |
| `rate_default` (Sub-sub-seller) | Per entitas Sub-sub-seller | Rate dari jatah Sub-seller induknya (misal 50%), bisa berbeda tiap Sub-sub-seller |
| Rate override per Toko | Per entitas Toko | Opsional. Kalau kosong, ikut rate default dari Sub-seller/Sub-sub-seller induknya |

**PENTING:** Semua rate harus disimpan sebagai **snapshot** di setiap Mutasi Pencairan saat transaksi dibuat. Perubahan rate di kemudian hari TIDAK mengubah data historis yang sudah tercatat.

### 4.2 Skenario Kalkulasi (3 Kemungkinan per Toko)

**Skenario A — Toko milik Seller sendiri (tidak ada sub_seller_id)**
```
Kredit (IN)
  → Sedekah (rate% dari basis yang berlaku)
  → Sisa 100% - sedekah% → Seller
```

**Skenario B — Toko milik Sub-seller (sub_seller_id terisi, sub_sub_seller_id kosong)**
```
Basis TOTAL_KREDIT_AWAL:
Kredit (IN)
  → Sedekah = Kredit × sedekah_rate
  → Sisa = Kredit − Sedekah
  → Bagian Sub-seller = Sisa × rate_subseller
  → Bagian Seller = Sisa − Bagian Sub-seller

Basis SISA_SETELAH_SPLIT_SUBSELLER:
Kredit (IN)
  → Bagian Sub-seller = Kredit × rate_subseller
  → Sisa Seller (sebelum sedekah) = Kredit − Bagian Sub-seller
  → Sedekah = Sisa Seller (sebelum sedekah) × sedekah_rate
  → Bagian Seller = Sisa Seller (sebelum sedekah) − Sedekah
  (Sub-seller TIDAK terpotong sedekah sama sekali di basis ini)
```

**Skenario C — Toko milik Sub-sub-seller (sub_seller_id DAN sub_sub_seller_id terisi)**
```
Hitung dulu Bagian Sub-seller seperti Skenario B (tergantung basis sedekah yang dipilih)
  → Bagian Sub-sub-seller = Bagian Sub-seller × rate_subsubseller
  → Sisa untuk Sub-seller = Bagian Sub-seller − Bagian Sub-sub-seller
```

### 4.3 Contoh Numerik Lengkap (untuk unit test)

Input: Kredit = Rp1.000.000, sedekah_rate = 5%, basis = TOTAL_KREDIT_AWAL, rate_subseller = 20%, rate_subsubseller = 50%

```
Sedekah         = 1.000.000 × 5%              = Rp50.000
Sisa            = 1.000.000 − 50.000           = Rp950.000
Bagian Subseller (kotor) = 950.000 × 20%       = Rp190.000
Bagian Seller            = 950.000 − 190.000   = Rp760.000
Bagian Subsubseller      = 190.000 × 50%       = Rp95.000
Bagian Subseller (bersih)= 190.000 − 95.000    = Rp95.000

Total cek: 50.000 + 760.000 + 95.000 + 95.000 = 1.000.000 ✓
```

**Wajib dibuatkan unit test untuk memastikan total split selalu sama dengan Kredit (IN), tidak ada dana yang "hilang" akibat pembulatan.** Gunakan strategi pembulatan konsisten (misal: sisa terakhir dihitung dari pengurangan, bukan dari rumus independen, supaya tidak ada selisih pembulatan).

---

## 5. ENTITAS & SKEMA DATA (USULAN)

### 5.1 `sub_sellers`
| Field | Tipe | Keterangan |
|---|---|---|
| id | UUID | PK |
| seller_tenant_id | UUID | FK ke tenant Seller pemilik |
| nama | string | |
| kontak | string | No HP/email |
| email_login | string, nullable | Untuk akses login sub-seller |
| rekening_tujuan | string | Nomor rekening + bank |
| rate_default | decimal | Rate split dari Seller, misal 0.20 |
| status | enum | `aktif` / `nonaktif` |
| created_at, updated_at | timestamp | |

### 5.2 `sub_sub_sellers`
| Field | Tipe | Keterangan |
|---|---|---|
| id | UUID | PK |
| sub_seller_id | UUID | FK wajib ke `sub_sellers` (parent) |
| nama, kontak, email_login, rekening_tujuan | sama seperti di atas | |
| rate_default | decimal | Rate split dari jatah Sub-seller induknya, misal 0.50 |
| status | enum | `aktif` / `nonaktif` |

### 5.3 Perubahan pada `toko` (tabel existing)
| Field baru | Tipe | Keterangan |
|---|---|---|
| sub_seller_id | UUID, nullable | FK ke `sub_sellers` |
| sub_sub_seller_id | UUID, nullable | FK ke `sub_sub_sellers`. HARUS null jika `sub_seller_id` null |
| rate_override_subseller | decimal, nullable | Override rate default sub-seller untuk toko ini saja |
| rate_override_subsubseller | decimal, nullable | Override rate default sub-sub-seller untuk toko ini saja |

### 5.4 Pengaturan tenant Seller (tambahan ke tabel tenant/settings existing)
| Field baru | Tipe | Keterangan |
|---|---|---|
| sedekah_rate | decimal | Default 0.05 |
| sedekah_basis | enum | `TOTAL_KREDIT_AWAL` / `SISA_SETELAH_SPLIT_SUBSELLER` |
| sedekah_rekening_tujuan | string | Satu rekening untuk semua toko dalam tenant ini |

### 5.5 `payout_batches`
| Field | Tipe | Keterangan |
|---|---|---|
| id | UUID | PK |
| seller_tenant_id | UUID | FK |
| dibuat_oleh_user_id | UUID | User yang klik "Mulai batch baru" |
| status | enum | `berjalan` / `menunggu_transfer` / `sudah_ditransfer` / `selesai` |
| ditutup_at | timestamp, nullable | Saat Admin klik "Tutup & lapor" |
| total_transfer_ke_admin | decimal | Sum otomatis dari semua Mutasi Pencairan dalam batch (bagian sub-seller + sub-sub-seller yang perlu diteruskan Admin) |
| bukti_transfer_ke_admin | file url, nullable | Bukti Owner transfer ke Admin |
| ditransfer_at | timestamp, nullable | |

### 5.6 `payout_mutations` (Mutasi Pencairan)
| Field | Tipe | Keterangan |
|---|---|---|
| id | UUID | PK, format tampilan bisa dipertahankan mirip `{TAHUN}RNT{urut}` atau bebas |
| batch_id | UUID | FK ke `payout_batches` |
| toko_id | UUID | FK |
| tanggal_pencairan | date | Tanggal sesuai bukti marketplace |
| nominal_bukti_marketplace | decimal | Nominal sesuai screenshot mutasi rekening |
| nominal_kredit | decimal | Nominal dasar kalkulasi (bisa beda dari nominal_bukti_marketplace) |
| rekening_penampung | string | No rekening tujuan dana masuk dari marketplace |
| bukti_pencairan_marketplace | file url | WAJIB |
| rate_sedekah_terpakai | decimal | Snapshot |
| rate_subseller_terpakai | decimal, nullable | Snapshot |
| rate_subsubseller_terpakai | decimal, nullable | Snapshot |
| sedekah_basis_terpakai | enum | Snapshot |
| jumlah_sedekah | decimal | Hasil kalkulasi |
| jumlah_subseller | decimal, nullable | Hasil kalkulasi |
| jumlah_subsubseller | decimal, nullable | Hasil kalkulasi |
| jumlah_seller | decimal | Hasil kalkulasi |
| bukti_transfer_subseller | file url, nullable | |
| bukti_transfer_sedekah | file url, nullable | |
| bukti_transfer_seller | file url, nullable | |
| referensi_order_ids | array/json, nullable | Level 1 OMS integration — opsional |
| status | enum | `draft` / `selesai` |
| status_diteruskan_subseller | enum | `menunggu` / `diteruskan` |
| status_diteruskan_subsubseller | enum, nullable | `menunggu` / `diteruskan` |
| keterangan | text, nullable | |
| created_by, created_at, updated_at | | |

### 5.7 `payout_adjustments` (Mutasi Penyesuaian)
| Field | Tipe | Keterangan |
|---|---|---|
| id | UUID | PK |
| original_mutation_id | UUID | FK ke `payout_mutations` yang dikoreksi |
| nominal_koreksi | decimal | Bisa negatif/positif |
| alasan | text | Wajib diisi |
| created_by, created_at | | |

---

## 6. ALUR KERJA (STATE MACHINE)

### 6.1 Siklus Batch
```
[Admin/Staff klik "Mulai batch baru"]
        ↓
   berjalan ──(Admin input Mutasi Pencairan per toko, bebas lintas hari)──┐
        ↓                                                                 │
   [Admin klik "Tutup & lapor ke Owner"]                                 │
        ↓                                                                 │
   menunggu_transfer                                                     │
        ↓                                                                 │
   [Owner transfer 1x nominal gabungan, upload bukti, tandai selesai]    │
        ↓                                                                 │
   sudah_ditransfer                                                      │
        ↓                                                                 │
   [Admin distribusikan manual ke tiap sub-seller/sub-sub-seller,        │
    tandai satu-satu "Diteruskan" per Mutasi Pencairan]                  │
        ↓                                                                 │
   Semua Mutasi Pencairan dalam batch berstatus "diteruskan" → selesai ──┘
```
Catatan: batch baru TIDAK otomatis terbuka setelah satu batch selesai — harus diklik manual oleh Admin/Staff. Owner harus bisa melihat batch berstatus `berjalan` secara read-only kapan saja (dashboard live progress), tanpa perlu melakukan aksi apapun di status ini.

### 6.2 Siklus Mutasi Pencairan (dalam satu batch)
```
draft (bebas diedit/dihapus oleh yang menginput)
   ↓
[Admin lengkapi bukti pencairan marketplace + 1-3 bukti transfer keluar
 sesuai skenario A/B/C]
   ↓
selesai (TERKUNCI — tidak bisa dihapus/diedit langsung)
```
Validasi wajib sebelum status bisa berubah ke `selesai`:
- `bukti_pencairan_marketplace` harus terisi (berlaku untuk semua skenario, termasuk toko milik Seller sendiri).
- Bukti transfer keluar wajib terisi untuk setiap pihak yang mendapat bagian > 0 pada transaksi tersebut (sedekah selalu; sub-seller/sub-sub-seller/seller tergantung skenario A/B/C).

Koreksi data yang sudah `selesai` HARUS melalui `payout_adjustments`, tidak boleh update langsung ke record `payout_mutations`.

### 6.3 Validasi Selisih Nominal
Jika `nominal_bukti_marketplace` ≠ `nominal_kredit`, sistem tetap mengizinkan penyimpanan, tetapi menampilkan badge peringatan visual dengan nilai selisihnya. Tidak memblokir alur kerja.

---

## 7. ROLE & HAK AKSES (RBAC)

| Aksi | Owner | Admin/Staff | Sub-seller (login) | Sub-sub-seller (login) |
|---|---|---|---|---|
| Input Mutasi Pencairan (draft) | Ya | Ya | Tidak | Tidak |
| Lihat semua nominal termasuk Bagian Seller | Ya | Ya | Tidak | Tidak |
| Lihat riwayat pencairan miliknya sendiri | Ya (semua) | Ya (semua) | Ya, toko miliknya saja | Ya, toko miliknya saja |
| Ubah status batch → "Sudah Ditransfer ke Admin" | Ya | Tidak | Tidak | Tidak |
| Tandai "Diteruskan" per Mutasi Pencairan | Ya | Ya | Tidak | Tidak |
| Buat/edit entitas Sub-seller | Ya | Ya (sesuai kebijakan Seller) | Tidak | Tidak |
| Buat/edit entitas Sub-sub-seller | Tidak langsung — dibuat oleh Sub-seller terkait, atau Owner/Admin atas nama Sub-seller | Sama | Bisa membuat Sub-sub-seller di bawahnya | Tidak |
| Ubah rate/pengaturan sedekah tenant | Ya | Tidak (disarankan; konfirmasi ke Putra saat implementasi) | Tidak | Tidak |
| Edit/hapus Mutasi Pencairan berstatus draft | Ya | Ya (miliknya) | Tidak | Tidak |
| Buat Mutasi Penyesuaian | Ya | Konfirmasi kebijakan saat implementasi | Tidak | Tidak |

**Catatan implementasi:** Login Sub-seller dan Sub-sub-seller sebaiknya memakai mekanisme passwordless yang sudah jadi standar AutoToko, bukan sistem otentikasi terpisah.

---

## 8. INTEGRASI DENGAN OMS (LEVEL 1 — TAHAP AWAL)

- Field `referensi_order_ids` di setiap Mutasi Pencairan bersifat opsional — Admin bisa memilih rentang Order dari toko terkait sebagai jejak, TIDAK dipakai untuk menghitung nominal kredit secara otomatis.
- Alasan: settlement marketplace jarang 1:1 dengan total omzet order karena potongan platform, refund, dan adjustment fee affiliate yang tidak selalu tercermin di data order OMS.
- Level 2 (rekonsiliasi otomatis dari data settlement OMS) didesain untuk fase berikutnya setelah gap data historis diobservasi — TIDAK termasuk dalam scope pengerjaan ini.

---

## 9. UI/HALAMAN YANG DIBUTUHKAN

1. **List Batch Pencairan** — daftar semua batch (status, tanggal buka/tutup, total nominal), filter by status.
2. **Detail Batch** — rekap semua Mutasi Pencairan dalam satu batch, kartu ringkasan total per kategori, tombol aksi sesuai status & role yang login.
3. **Form Input Mutasi Pencairan** — sesuai field di 5.6, dengan kalkulasi split real-time (read-only, auto-update saat nominal diubah), badge peringatan selisih nominal, upload multi-bukti sesuai skenario A/B/C yang aktif untuk toko terpilih.
4. **List Mutasi Pencairan (lintas batch)** — riwayat semua transaksi, filter by toko/tanggal/status, untuk kebutuhan pencarian & audit.
5. **Manajemen Sub-seller** — CRUD entitas Sub-seller, assign Toko ke Sub-seller, atur rate default & rekening.
6. **Manajemen Sub-sub-seller** — sama seperti di atas, tapi di bawah satu Sub-seller tertentu.
7. **Pengaturan Payout Tenant** — atur `sedekah_rate`, `sedekah_basis`, `sedekah_rekening_tujuan`.
8. **Portal Sub-seller/Sub-sub-seller (read-only, akses terbatas)** — riwayat pencairan bagian mereka sendiri saja, tanpa melihat nominal pihak lain.

---

## 10. HAL YANG SENGAJA DI-DEFER (BUKAN SCOPE SEKARANG)

- Rekonsiliasi otomatis penuh dengan data Order OMS (Level 2).
- Approval berjenjang multi-user untuk status "draft → selesai" (saat ini cukup satu langkah, karena akses masih terbatas Owner + Admin dalam satu tenant).
- Notifikasi otomatis (WA/email) ke Sub-seller saat dana diteruskan — bisa jadi enhancement lanjutan menggunakan infrastruktur WhatsApp API yang sudah ada di AutoToko.
