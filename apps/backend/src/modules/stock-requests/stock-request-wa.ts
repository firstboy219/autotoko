/**
 * Isi pesan WhatsApp permintaan pembelian stok.
 *
 * Pure, tanpa apa pun dari Nest atau basis data, supaya bisa diuji: yang
 * dikirim ke pemasok tidak bisa ditarik kembali, dan salah satu angka di sini
 * berarti barang yang salah datang seminggu kemudian.
 *
 * SATUAN DITULIS DUA KALI, dan itu disengaja. Pemasok menjual "2 botol", rak
 * menghitung "2.000 ml". Menulis hanya yang pertama membuat catatan gudang
 * tidak bisa dicocokkan; menulis hanya yang kedua membuat pemasok harus
 * menerjemahkan sendiri -- dan di situlah pesanan berubah jadi salah.
 */

export interface ItemRequest {
  /** Nama di master bahan baku, atau apa yang tertulis di tangkapan layar. */
  nama: string;
  qtyPack: number;
  packLabel: string | null;
  contentPerPack: number | null;
  contentUnit: string | null;
  qtyBase: number | null;
  baseUnit: string | null;
  unitPrice: number | null;
  totalPrice: number | null;
}

export function rupiah(v: number): string {
  return "Rp " + new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(v);
}

/** Angka tanpa nol desimal yang tidak berguna: 2 bukan 2,000. */
export function angkaRapi(v: number): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 }).format(v);
}

/**
 * Satu baris permintaan, apa adanya.
 *
 * Contoh keluaran:
 *   1. Aquades — 2 botol × 1 liter (= 2.000 ml)
 *      Rp 15.000/botol · Rp 30.000
 */
export function barisItem(i: ItemRequest, nomor: number): string[] {
  const baris: string[] = [];
  const kemasan = i.packLabel?.trim() || "pcs";
  let judul = `${nomor}. ${i.nama} — ${angkaRapi(i.qtyPack)} ${kemasan}`;
  if (i.contentPerPack != null && i.contentUnit) {
    judul += ` × ${angkaRapi(i.contentPerPack)} ${i.contentUnit}`;
  }
  if (i.qtyBase != null && i.baseUnit) {
    judul += ` (= ${angkaRapi(i.qtyBase)} ${i.baseUnit})`;
  }
  baris.push(judul);

  const harga: string[] = [];
  if (i.unitPrice != null && i.unitPrice > 0) harga.push(`${rupiah(i.unitPrice)}/${kemasan}`);
  if (i.totalPrice != null && i.totalPrice > 0) harga.push(rupiah(i.totalPrice));
  // Baris harga hanya muncul kalau ada harganya. Menulis "Rp 0" untuk barang
  // yang harganya belum diketahui membuat pemasok mengira itu gratis.
  if (harga.length) baris.push(`   ${harga.join(" · ")}`);
  return baris;
}

export function pesanRequest(opsi: {
  items: ItemRequest[];
  catatan?: string | null;
  /** Tautan tangkapan layar, absolut. */
  tautanBukti?: string | null;
  tanggal?: Date | null;
}): string {
  const BULAN = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
  ];
  const d = opsi.tanggal ?? new Date();
  const tgl = `${d.getUTCDate()} ${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

  const baris: string[] = ["*Permintaan Pembelian Stok*", `Tanggal: ${tgl}`, ""];

  let n = 0;
  let total = 0;
  for (const i of opsi.items) {
    n += 1;
    baris.push(...barisItem(i, n));
    total += i.totalPrice ?? 0;
  }
  if (n === 0) baris.push("(belum ada bahan yang dipilih)");

  if (total > 0) {
    baris.push("", `*Total: ${rupiah(total)}*`);
  } else {
    // Dikatakan, bukan didiamkan: total yang hilang tanpa penjelasan terbaca
    // sebagai pesan yang terpotong.
    baris.push("", "_Harga belum diisi seluruhnya._");
  }

  // Pembayaran disebut di pesannya sendiri. Fitur ini memang untuk pembelian
  // non-COD, dan pemasok yang mengira COD akan mengirim kurir penagih.
  baris.push("", "Pembayaran: transfer (non-COD).");

  if (opsi.catatan && opsi.catatan.trim()) {
    baris.push("", `Catatan: ${opsi.catatan.trim()}`);
  }
  if (opsi.tautanBukti) {
    baris.push("", `Tangkapan layar: ${opsi.tautanBukti}`);
  }
  return baris.join("\n");
}

/** Total yang dipakai menyimpan, dihitung dari baris -- bukan dari layar. */
export function totalDari(items: ItemRequest[]): number {
  return items.reduce((a, i) => a + (i.totalPrice ?? 0), 0);
}
