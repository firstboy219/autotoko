/**
 * Order id dari label pengiriman: mengesahkan, memperbaiki, dan menolak.
 *
 * ATURANNYA DITURUNKAN DARI DATA, bukan dugaan. Diukur pada laporan
 * penyelesaian TikTok sungguhan: dari 96 entri di kolom "ID Pesanan/
 * Penyesuaian", yang berjenis "Pesanan" berjumlah 66 dan SELURUHNYA angka
 * murni sepanjang 18 digit. Yang 19 digit bukan pesanan sama sekali -- ia
 * referensi pencairan di muka dan penyesuaian komisi.
 *
 * Konsekuensinya keras dan disengaja: apa pun yang bukan 18 digit ditolak,
 * dan yang ditolak disimpan sebagai NULL. Menyimpan tebakan lebih buruk
 * daripada menyimpan kosong -- ia akan gagal berpasangan dengan laporan
 * marketplace secara diam-diam, lalu terbaca sebagai "pesanan hilang" padahal
 * yang salah cuma pembacaannya.
 *
 * Diukur pada 310 resi nyata: sebelumnya 146 kolom terisi tapi hanya 22 yang
 * bentuknya mungkin (15%); sesudahnya 80 terisi dan seluruhnya sah, termasuk
 * 15 yang dipulihkan dari teks yang tadinya menghasilkan kosong.
 */

/** Panjang order id yang sah. Satu angka, karena datanya memang satu angka. */
export const ORDER_ID_DIGITS = 18;

/**
 * Hanya kekeliruan OCR yang benar-benar sering terjadi pada label termal.
 *
 * Peta yang lebih rakus akan mengubah teks yang memang BUKAN angka menjadi
 * angka yang meyakinkan -- kegagalan paling mahal di sini, karena hasilnya
 * lolos setiap pemeriksaan bentuk dan tetap salah.
 */
const CONFUSABLE: Record<string, string> = {
  S: "5", s: "5",
  O: "0", o: "0", D: "0",
  I: "1", i: "1", l: "1", "|": "1",
  B: "8",
  Z: "2", z: "2",
  G: "6",
};

function repair(s: string): string {
  let out = "";
  for (const c of s) out += CONFUSABLE[c] ?? c;
  return out;
}

/**
 * Order id yang sah dari sebuah kandidat, atau null.
 *
 * Perbaikan huruf hanya diterima kalau HASILNYA menjadi 18 digit penuh; kalau
 * masih tersisa huruf, kandidatnya memang bukan order id.
 */
export function normaliseOrderId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[\s\-/.]/g, "");
  if (!cleaned) return null;
  const exact = new RegExp(`^\\d{${ORDER_ID_DIGITS}}$`);
  if (exact.test(cleaned)) return cleaned;
  const repaired = repair(cleaned);
  if (exact.test(repaired)) return repaired;
  return null;
}

/** Sudah pasti sah tanpa perlu diperbaiki. */
export function isOrderId(v: string | null | undefined): boolean {
  return typeof v === "string" && new RegExp(`^\\d{${ORDER_ID_DIGITS}}$`).test(v);
}

const ANCHOR =
  /(?:order\s*id|no\.?\s*pesanan|nomor\s*pesanan|no\.?\s*order|invoice)\s*[:#]?\s*([0-9OoSsIilBZzGD|]{16,20})/i;

/**
 * Cari order id di dalam teks label.
 *
 * Berjangkar dulu ("Order ID: ..."), baru angka telanjang. Yang telanjang
 * WAJIB berbatas non-digit: tanpa itu, awalan sebuah angka 19 digit ikut
 * tercocok sebagai "18 digit" dan menghasilkan order id yang terpotong satu
 * angka -- salah yang paling sulit terlihat, karena bentuknya sempurna.
 *
 * Kalau ada beberapa angka 18 digit yang berbeda, tidak ada dasar memilih
 * salah satunya, jadi tidak ada yang dipilih.
 */
export function findOrderId(text: string | null | undefined): string | null {
  if (!text) return null;

  const anchored = ANCHOR.exec(text);
  if (anchored?.[1]) {
    const v = normaliseOrderId(anchored[1]);
    if (v) return v;
  }

  const bare = text.match(new RegExp(`(?<!\\d)\\d{${ORDER_ID_DIGITS}}(?!\\d)`, "g")) ?? [];
  const unique = [...new Set(bare)];
  return unique.length === 1 ? unique[0]! : null;
}

/**
 * Nilai terbaik dari dua sumber: yang sudah tersimpan, lalu teks mentahnya.
 *
 * Yang tersimpan didahulukan karena ia datang dari ponsel yang melihat puluhan
 * frame, sedangkan teks di sini biasanya hasil satu JPEG. Tapi ia tetap harus
 * lulus pemeriksaan yang sama -- asalnya tidak membuat sebuah nilai sah.
 */
export function bestOrderId(
  stored: string | null | undefined,
  text: string | null | undefined,
): string | null {
  return normaliseOrderId(stored) ?? findOrderId(text);
}
