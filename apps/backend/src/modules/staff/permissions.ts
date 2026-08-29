/**
 * Izin karyawan: apa yang boleh dibuka, dan bagaimana rute dipetakan ke sana.
 *
 * Izinnya sengaja setingkat MODUL, bukan per tombol. Izin per aksi terdengar
 * lebih rapi sampai seseorang harus mengarangnya untuk enam puluh rute, dan
 * yang terjadi kemudian selalu sama: satu rute terlewat, karyawan kehilangan
 * fitur yang seharusnya boleh, lalu izinnya dilonggarkan sampai tidak berarti
 * apa-apa. Delapan modul cukup menjawab "orang ini boleh pegang uang atau
 * tidak", dan itulah pertanyaan yang sebenarnya ditanyakan pemilik toko.
 */

export interface PermissionDef {
  key: string;
  label: string;
  /** Kalimat untuk pemilik toko, bukan untuk programmer. */
  hint: string;
}

export const STAFF_PERMISSIONS: PermissionDef[] = [
  {
    key: "dashboard",
    label: "Dashboard & Laporan",
    hint: "Melihat angka penjualan, kesehatan toko, dan laporan.",
  },
  {
    key: "scan",
    label: "Scan Resi & Packing",
    hint: "Scan resi, memetakan asal paket, dan riwayat scan. Ini yang dipakai tim gudang.",
  },
  {
    key: "produk",
    label: "Produk & HPP",
    hint: "Master produk, kategori, dan perhitungan harga pokok.",
  },
  {
    key: "bahan",
    label: "Bahan Baku & Stok",
    hint: "Bahan baku, resep, stok masuk dan keluar.",
  },
  {
    key: "toko",
    label: "Toko & Marketplace",
    hint: "Daftar toko, sambungan marketplace, dan branding.",
  },
  {
    key: "pencairan",
    label: "Pencairan Dana",
    hint: "Batch pencairan, transfer, bukti, dan bagian sub-seller. Ini menyentuh uang.",
  },
  {
    key: "order",
    label: "Order",
    hint: "Daftar order dan detailnya.",
  },
  {
    key: "wallet",
    label: "Saldo & Tagihan",
    hint: "Saldo wallet dan riwayat pemakaiannya.",
  },
];

export const STAFF_PERMISSION_KEYS = STAFF_PERMISSIONS.map((p) => p.key);

/** Boleh diakses karyawan mana pun yang masih aktif. */
export const ANY_STAFF = "*";
/** Hanya pemilik. Tidak ada izin yang bisa membukanya. */
export const OWNER_ONLY = "__owner__";

/**
 * Prefix rute -> izin yang dibutuhkan.
 *
 * Yang TIDAK terdaftar di sini ditolak untuk karyawan. Gagal-tertutup dipilih
 * dengan sadar: modul baru yang lupa didaftarkan akan terlihat sebagai
 * "karyawan tidak bisa membuka X" dan langsung dilaporkan, sedangkan
 * gagal-terbuka akan terlihat sebagai tidak ada apa-apa -- sampai seorang
 * karyawan gudang membuka menu pencairan.
 */
export const ROUTE_PERMISSIONS: Record<string, string> = {
  // Yang dilihat
  dashboard: "dashboard",
  reports: "dashboard",

  // Gudang
  resi: "scan",

  // Katalog
  products: "produk",
  catalog: "produk",
  costing: "produk",
  ai: "produk",

  materials: "bahan",
  bom: "bahan",

  shops: "toko",
  branding: "toko",
  marketing: "toko",

  payout: "pencairan",
  // Yang boleh mengaudit uang adalah yang boleh melihat uang.
  statements: "pencairan",

  orders: "order",

  wallet: "wallet",

  // Unggah berkas dipakai hampir semua modul (foto resi, bukti transfer).
  // Menguncinya ke satu izin akan mematahkan modul lain yang sudah diizinkan.
  uploads: ANY_STAFF,

  // "Saya siapa dan boleh apa" -- dibutuhkan tiap layar untuk menyembunyikan
  // menu yang memang tidak boleh dibuka.
  me: ANY_STAFF,

  // Milik pemilik sendiri: password, akun karyawan, panel admin.
  auth: OWNER_ONLY,
  staff: OWNER_ONLY,
  admin: OWNER_ONLY,

  // account punya aturan sendiri di bawah: dibaca boleh, diubah tidak.
  account: OWNER_ONLY,
};

/**
 * Prefix yang boleh DIBACA siapa saja tapi hanya boleh DIUBAH pemiliknya.
 *
 * "account" ada di sini karena cangkang web memuat /account/me dan
 * /account/nav di tiap halaman -- menolaknya membuat aplikasi karyawan mati di
 * layar pertama. Sedangkan /account/plan mengubah paket langganan dan
 * /account/me mengubah nama pemilik, dan tidak satu pun dari itu urusan
 * karyawan. Jadi yang dipisah adalah metodenya, bukan seluruh prefiksnya.
 */
const BACA_SAJA: Record<string, string> = {
  account: ANY_STAFF,
};

const METODE_BACA = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Izin yang dibutuhkan sebuah URL, atau null kalau tidak ada yang cocok.
 *
 * Dicocokkan pada segmen pertama saja, dan "payout/portal" tidak perlu diurus
 * di sini: rutenya sudah ditandai PORTAL_ONLY, yang menolak token apa pun
 * tanpa principalType -- termasuk token karyawan.
 */
export function permissionForRequest(method: string, url: string): string | null {
  const path = (url.split("?")[0] ?? "").replace(/^\/+/, "");
  const tanpaApi = path.startsWith("api/") ? path.slice(4) : path;
  const segmen = tanpaApi.split("/").filter(Boolean);
  if (!segmen.length) return null;

  const satu = segmen[0]!;
  if (METODE_BACA.has(method.toUpperCase()) && BACA_SAJA[satu]) {
    return BACA_SAJA[satu];
  }

  // Dua segmen dulu ("admin/users"), baru satu segmen -- supaya prefix yang
  // lebih spesifik menang kalau suatu saat ditambahkan.
  const dua = segmen.slice(0, 2).join("/");
  if (ROUTE_PERMISSIONS[dua]) return ROUTE_PERMISSIONS[dua];
  return ROUTE_PERMISSIONS[satu] ?? null;
}
