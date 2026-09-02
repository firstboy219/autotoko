/**
 * Produk apa saja yang ada di dalam satu nomor pesanan.
 *
 * DARI MANA. Laporan penyelesaian TikTok membawa kolom "Detail produk
 * terjual", dan pada laporan sungguhan toko ini kolom itu terisi untuk 143
 * dari 143 pesanan. Isinya bukan nama, melainkan ID SKU marketplace dikali
 * jumlah:
 *
 *     "1731350028413076965 * 1;"
 *     "1731335317582218725 * 2;\n1731335307116840421 * 1;"
 *     "/"                              <- pesanan tanpa produk (batal/retur)
 *
 * KENAPA NAMANYA TIDAK LANGSUNG ADA. ID SKU itu tidak muncul di mana pun
 * selain laporannya sendiri -- sudah dicari ke seluruh kolom teks di basis
 * data. Katalog menyimpan judul iklan di master_products.marketplace_aliases,
 * bukan ID-nya. Jadi terjemahan ID -> produk harus dipetakan sekali oleh
 * penggunanya, dan itulah yang disimpan di tabel marketplace_sku_map.
 *
 * KENAPA TIDAK DITEBAK DARI HARGA. Menggoda, dan salah. Pada katalog ini
 * harga 39.300 dipakai oleh "Inhaler Regular Peppermint" DAN "Siwak Spray
 * 50ml"; harga 49.300 dipakai tiga produk sekaligus. Tebakan harga akan
 * menghasilkan nama yang rapi tapi keliru, dan di layar audit salah menyebut
 * produk lebih berbahaya daripada tidak menyebutnya sama sekali -- orang
 * bertindak atas nama yang terbaca. Harga tetap dipakai, tapi hanya untuk
 * MENYARANKAN calon yang harus dikonfirmasi, tidak pernah untuk memutuskan.
 */

/** Satu baris produk di dalam sebuah pesanan, sebagaimana tertulis di laporan. */
export interface ItemPesanan {
  /** ID SKU marketplace, apa adanya. */
  sku: string;
  qty: number;
}

/** Sama, setelah dicocokkan ke katalog. */
export interface ItemProdukPesanan extends ItemPesanan {
  /** Null berarti SKU ini belum dipetakan ke master produk. */
  nama: string | null;
  produkId: string | null;
}

/** Peta ID SKU -> produk di katalog. */
export type PetaSku = ReadonlyMap<string, { id: string; nama: string }>;

/**
 * Penanda "tidak ada produk" yang dipakai laporan.
 *
 * TikTok menulis "/" untuk baris yang bukan penjualan -- penyesuaian, retur,
 * penarikan dana. Diperlakukan sebagai daftar kosong, bukan sebagai SKU
 * bernama "/".
 */
const KOSONG = new Set(["", "/", "-", "n/a", "null", "undefined"]);

/**
 * Sependek ini sebuah potongan teks tidak dianggap ID SKU.
 *
 * Menjaga agar sisa pemisahan yang aneh (satu tanda baca, satu huruf) tidak
 * masuk sebagai produk hantu ke layar audit.
 */
const MIN_PANJANG_SKU = 3;

/**
 * Mengurai isi kolom "Detail produk terjual" menjadi daftar SKU dan jumlahnya.
 *
 * Pemisah antar produk bisa titik koma, baris baru, atau keduanya sekaligus --
 * ketiganya benar-benar muncul di laporan yang sama.
 */
export function uraikanDetailProduk(v: unknown): ItemPesanan[] {
  const teks = String(v ?? "").trim();
  if (KOSONG.has(teks.toLowerCase())) return [];

  const hasil: ItemPesanan[] = [];
  // Digabung supaya urutan penulisannya tidak penting: dua produk boleh
  // dipisah ";", boleh baris baru, boleh ";\n".
  for (const bagian of teks.split(/[;\n\r]+/)) {
    const p = bagian.trim();
    if (KOSONG.has(p.toLowerCase())) continue;

    const bintang = p.indexOf("*");
    const sku = (bintang >= 0 ? p.slice(0, bintang) : p).trim();
    if (sku.length < MIN_PANJANG_SKU || KOSONG.has(sku.toLowerCase())) continue;

    let qty = 1;
    if (bintang >= 0) {
      const n = parseInt(p.slice(bintang + 1).replace(/[^0-9-]/g, ""), 10);
      // Jumlah yang tidak masuk akal (nol, negatif, tak terbaca) dianggap
      // satu: produknya jelas ada di pesanan itu, hanya jumlahnya yang rusak.
      if (Number.isFinite(n) && n > 0) qty = n;
    }

    const sudah = hasil.find((x) => x.sku === sku);
    if (sudah) sudah.qty += qty;
    else hasil.push({ sku, qty });
  }
  return hasil;
}

/** Menempelkan nama katalog ke tiap SKU; yang belum dipetakan tetap null. */
export function cocokkanKeKatalog(
  item: readonly ItemPesanan[],
  peta?: PetaSku,
): ItemProdukPesanan[] {
  return item.map((x) => {
    const p = peta?.get(x.sku);
    return { sku: x.sku, qty: x.qty, nama: p?.nama ?? null, produkId: p?.id ?? null };
  });
}
