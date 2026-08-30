/**
 * Membaca nomor pesanan dari label pengiriman dengan MENIMBANG BUKTI.
 *
 * KENAPA DITULIS ULANG. Versi sebelumnya adalah daftar bentuk yang boleh: 18
 * angka murni, titik. Aturan itu diturunkan dari data sungguhan (66 baris
 * "Pesanan" di laporan TikTok, seluruhnya 18 digit) dan memang menaikkan mutu
 * kolom ini -- tapi ia menjawab pertanyaan yang salah. Laporan penyelesaian
 * TikTok hanya memuat pesanan TikTok yang SUDAH cair; label yang dipindai di
 * meja packing datang dari Shopee, Tokopedia, Lazada, dan Blibli juga.
 *
 * Akibatnya terlihat di hasil tes: label Shopee bertuliskan harfiah
 * "No.Pesanan: 260827EXWKKVDE" terbaca sempurna -- panel bawah menampilkan
 * "Pesanan 260827EXWKKVDE (3 frame)" -- sementara panel panduan tetap berkata
 * "Belum terbaca, 154 frame, kejelasan 99%". Nomornya ada di layar, dan
 * pengesahnya menolak. Karena order id sudah diwajibkan, setiap paket Shopee
 * berhenti total di langkah pertama.
 *
 * CARA BARUNYA. Tidak ada lagi satu bentuk yang benar. Setiap kandidat di
 * dalam teks diberi SKOR dari bukti yang ada di label itu sendiri:
 *
 *   - berdampingan dengan tulisan "No. Pesanan"/"Order ID" -- bukti terkuat,
 *     karena labelnya sendiri yang menyatakan apa nilai itu;
 *   - bentuknya cocok dengan keluarga nomor pesanan yang dikenal;
 *   - untuk bentuk Shopee, enam angka pertamanya masuk akal sebagai tanggal;
 *   - berdampingan dengan "No. Resi"/"AWB", berawalan kode kurir, berbentuk
 *     nomor telepon, tanggal, berat, atau rupiah -- ditolak mutlak.
 *
 * TIGA TINGKAT, bukan dua. Yang lama hanya punya "sah" dan "ditolak", dan
 * setiap keraguan jatuh ke ditolak -- diam, tanpa memberi tahu apa yang
 * sebenarnya terbaca. Sekarang:
 *
 *   tinggi (>= 0.80) -- dipakai langsung;
 *   sedang (>= 0.45) -- DITAWARKAN ke orangnya untuk dibenarkan sekali sentuh,
 *                       tidak pernah disimpan diam-diam;
 *   rendah           -- diabaikan.
 *
 * Tingkat sedang itu inti perubahannya. Kode sortir kurir "2605149T3NJJJN"
 * bentuknya memang tidak bisa dibedakan dari nomor pesanan Shopee -- dulu itu
 * alasan menolak SEMUA bentuk Shopee dari OCR, yang berarti membuang yang
 * benar bersama yang salah. Menawarkannya untuk dibenarkan menyerahkan
 * keputusan kepada satu-satunya pihak yang memang bisa memutuskan: orang yang
 * sedang memegang labelnya.
 *
 * YANG TIDAK BERUBAH: normaliseOrderId() tetap ketat 18 digit, karena ia
 * dipakai membaca laporan marketplace (statements.service.ts) -- di sana 18
 * digit memang satu-satunya kebenaran, dan melonggarkannya akan merusak
 * pencocokan pencairan.
 */

/** Panjang order id TikTok/Tokopedia. Dipakai jalur ketat, bukan satu-satunya bentuk. */
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
 * Membersihkan sebuah kandidat.
 *
 * Batang barcode yang tersenggol bingkai OCR terbaca sebagai "|" di TEPI
 * untaian. Terukur di korpus: "260815D5EJ88X7|" dibaca, lalu "|" diubah
 * menjadi "1" oleh peta perbaikan dan hasilnya "26081505EJ88X71" -- nomor
 * pesanan Shopee yang berubah panjang dan isinya, diterima OTOMATIS dengan
 * keyakinan 0,99. Sisa garis di tepi adalah artefak; ia dibuang, bukan
 * ditafsirkan sebagai angka.
 */
function bersihkan(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw)
    .replace(/^[|:;,'"`]+|[|:;,'"`]+$/g, "")
    .replace(/[\s\-/.]/g, "");
}

/**
 * Perbaikan huruf hanya masuk akal pada untaian yang MEMANG angka.
 *
 * Tanpa syarat ini, "GrotbExpress" -- nama layanan kurir yang tercetak di
 * label yang sama -- diperbaiki menjadi "6R0T8EXPRE55" dan ditawarkan sebagai
 * nomor pesanan. Terukur di korpus. Sebuah kata tidak menjadi nomor hanya
 * karena hurufnya bisa dipetakan ke angka.
 */
function layakDiperbaiki(v: string): boolean {
  if (!v) return false;
  const angka = (v.match(/[0-9]/g) ?? []).length;
  return angka / v.length >= 0.6;
}

/**
 * Order id 18 digit yang sah, atau null. KETAT, dan sengaja dibiarkan ketat.
 *
 * Dipakai membaca kolom "ID Pesanan" di laporan penyelesaian marketplace, di
 * mana 18 digit murni memang satu-satunya bentuk yang ada. Melonggarkan di
 * sini akan membuat pencocokan pencairan mulai menerima nilai yang bukan
 * pesanan.
 */
export function normaliseOrderId(raw: string | null | undefined): string | null {
  const cleaned = bersihkan(raw);
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

// ---------------------------------------------------------------------------
// Keluarga bentuk nomor pesanan
// ---------------------------------------------------------------------------

export type Keyakinan = "tinggi" | "sedang" | "rendah";

export interface BacaanOrderId {
  /** Nilai sesudah dirapikan; inilah yang disimpan kalau diterima. */
  nilai: string;
  /** 0..1. Ambang: >= 0.80 dipakai langsung, >= 0.45 ditawarkan. */
  skor: number;
  keyakinan: Keyakinan;
  /** Nama keluarga bentuknya, untuk ditampilkan dan dicatat. */
  keluarga: string;
  /** Nilai ini tercetak tepat di sebelah tulisan "No. Pesanan"/"Order ID". */
  berjangkar: boolean;
  /** Kenapa skornya sekian. Ditampilkan supaya penolakan tidak pernah bisu. */
  alasan: string[];
}

interface Keluarga {
  nama: string;
  cocok: (v: string) => boolean;
  skor: number;
}

/**
 * Enam angka pertama masuk akal sebagai tanggal YYMMDD yang belum lewat jauh.
 *
 * Inilah yang memisahkan nomor pesanan Shopee sungguhan dari untaian
 * huruf-angka mana pun yang kebetulan panjangnya mirip. Tahun dibatasi 24-35
 * supaya angka acak seperti "849213..." tidak lolos sebagai tanggal.
 */
function tanggalMasukAkal(v: string): boolean {
  if (!/^\d{6}/.test(v)) return false;
  const th = Number(v.slice(0, 2));
  const bl = Number(v.slice(2, 4));
  const hr = Number(v.slice(4, 6));
  return th >= 24 && th <= 35 && bl >= 1 && bl <= 12 && hr >= 1 && hr <= 31;
}

/**
 * Urut dari yang paling menentukan ke yang paling umum; yang pertama cocok
 * itulah keluarganya.
 *
 * Skornya adalah keyakinan TANPA jangkar. Yang berjangkar mendapat tambahan
 * besar di bawah, karena tulisan "No. Pesanan" di sebelahnya adalah pernyataan
 * dari labelnya sendiri -- bukti yang tidak bisa ditandingi tebakan bentuk.
 */
const KELUARGA: Keluarga[] = [
  {
    // TikTok & Tokopedia. Dari 66 baris "Pesanan" di laporan sungguhan,
    // seluruhnya bentuk ini. Sendirian sudah cukup untuk dipakai langsung.
    nama: "18 digit",
    cocok: (v) => /^\d{18}$/.test(v),
    skor: 0.85,
  },
  {
    // Shopee: enam angka tanggal lalu huruf/angka. Sendirian belum cukup --
    // kode sortir kurir berbentuk persis sama -- jadi ia masuk tingkat sedang
    // dan ditawarkan untuk dibenarkan, bukan ditolak diam-diam.
    nama: "Shopee",
    cocok: (v) => /^\d{6}[A-Z0-9]{6,12}$/.test(v) && tanggalMasukAkal(v),
    skor: 0.62,
  },
  {
    // Nomor penyesuaian/pencairan di muka TikTok juga 19 digit, jadi tanpa
    // jangkar ini nyaris tidak berarti apa-apa. Dengan jangkar, labelnya
    // sendiri yang menyatakannya, dan itu lebih kuat daripada contoh saya.
    nama: "19 digit",
    cocok: (v) => /^\d{19}$/.test(v),
    skor: 0.34,
  },
  {
    // Tokopedia menuliskan invoice sebagai INV/20260827/MPL/1234567890.
    nama: "Invoice Tokopedia",
    cocok: (v) => /^INV\d{8}MPL\d{6,14}$/.test(v),
    skor: 0.6,
  },
  {
    // Lazada & Blibli: angka murni 12-16.
    nama: "angka panjang",
    cocok: (v) => /^\d{12,16}$/.test(v),
    skor: 0.3,
  },
  {
    // Apa pun yang bercampur huruf dan angka dengan panjang yang masuk akal.
    // Hampir tidak berarti sendirian; berarti kalau berjangkar.
    nama: "huruf-angka",
    cocok: (v) => /^[A-Z0-9]{10,24}$/.test(v) && /\d/.test(v) && /[A-Z]/.test(v),
    skor: 0.18,
  },
];

/**
 * Awalan nomor pengiriman kurir Indonesia. Ini BUKAN nomor pesanan, pernah
 * tersimpan sebagai nomor pesanan, dan itulah kekacauan yang dulu memaksa
 * aturan 18-digit yang kaku.
 */
const AWALAN_KURIR =
  /^(SPX|SPXID|JX|JP|JD|JT|JNE|JOB|CM|TKP|SICEPAT|SOCP|IDEXP|NCS|LEX|ANT|BLIB|GK|GKX|SAP|POS|TIKI)/;

/** Kata yang, kalau berdiri tepat sebelum sebuah nilai, membuktikan itu BUKAN order id. */
const JANGKAR_BUKAN =
  /(?:no\.?\s*resi|nomor\s*resi|resi|awb|air\s*way\s*bill|tracking|no\.?\s*telp|telepon|hp|berat|weight|kode\s*pos|batas\s*kirim)\s*[:#]?\s*$/i;

/** Kata yang, kalau berdiri tepat sebelum sebuah nilai, menyatakan itu order id. */
const JANGKAR_ADALAH =
  /(?:order\s*id|order\s*no\.?|no\.?\s*order|no\.?\s*pesanan|nomor\s*pesanan|kode\s*pesanan|id\s*pesanan|invoice|no\.?\s*invoice)\s*[:#]?\s*$/i;

/** Bentuk yang sudah pasti bukan nomor pesanan, sekuat apa pun jangkarnya. */
function jelasBukanOrderId(v: string): boolean {
  if (AWALAN_KURIR.test(v)) return true;
  if (/^0\d{8,12}$/.test(v)) return true;       // nomor telepon
  if (/^62\d{8,13}$/.test(v)) return true;      // nomor telepon +62
  if (/^\d{5}$/.test(v)) return true;           // kode pos
  if (/^\d{1,4}$/.test(v)) return true;         // terlalu pendek untuk apa pun
  if (/^(RP|IDR)/.test(v)) return true;         // nominal
  if (/^\d{2}\d{2}\d{4}$/.test(v) && Number(v.slice(0, 2)) <= 31) return true; // tanggal
  return false;
}

/**
 * Semua kandidat di dalam teks, dari yang skornya tertinggi.
 *
 * Pemenggalannya sengaja memakai teks MENTAH, bukan teks yang sudah dibuang
 * spasi dan strip-nya: yang menentukan sebuah nilai berjangkar adalah apa yang
 * tercetak persis di sebelah kirinya, dan itu hilang begitu teksnya diratakan.
 */
export function bacaSemuaOrderId(text: string | null | undefined): BacaanOrderId[] {
  if (!text) return [];

  const hasil = new Map<string, BacaanOrderId>();
  const token = /[A-Za-z0-9|][A-Za-z0-9|/\-.]{4,30}/g;
  let m: RegExpExecArray | null;

  while ((m = token.exec(text)) !== null) {
    const mentah = m[0];
    const sebelum = text.slice(Math.max(0, m.index - 24), m.index);

    if (JANGKAR_BUKAN.test(sebelum)) continue;

    const berjangkar = JANGKAR_ADALAH.test(sebelum);
    const alasan: string[] = [];

    // Diperiksa SEBELUM perbaikan huruf, bukan sesudah. "SPXID0641..." yang
    // diperbaiki menjadi "5PX10064..." tidak lagi berawalan kode kurir dan
    // akan lolos -- padahal yang tercetak di kertas itu tetap nomor
    // pengiriman. Yang sudah jelas bukan, tetap bukan.
    if (jelasBukanOrderId(bersihkan(mentah).toUpperCase())) continue;

    // Dua bacaan: apa adanya, dan yang huruf-miripnya diperbaiki. Yang apa
    // adanya didahulukan -- perbaikan yang tidak mengubah keluarga hanya
    // menambah kemungkinan salah.
    for (const kandidat of kandidatDari(mentah)) {
      if (jelasBukanOrderId(kandidat.v)) continue;

      const kel = KELUARGA.find((k) => k.cocok(kandidat.v));
      if (!kel) continue;

      let skor = kel.skor;
      const sebab = [...alasan, `bentuk ${kel.nama}`];

      if (berjangkar) {
        // Bukti terkuat yang bisa ada di sehelai label: tulisan di sebelahnya
        // menyatakan bahwa nilai ini adalah nomor pesanan.
        skor += 0.45;
        sebab.push('tertulis di sebelah "No. Pesanan"');
      }
      if (kandidat.diperbaiki) {
        // BATAS KERAS, bukan potongan kecil. Diukur pada korpus: dari 19
        // untaian yang punya padanan order id sungguhan, perbaikan huruf
        // menghasilkan nilai benar 5 kali dan nilai yang bentuknya sempurna
        // tapi SALAH 13 kali. Nilai yang salah dan berbentuk sempurna adalah
        // kegagalan termahal di sini: ia lolos setiap pemeriksaan, gagal
        // berpasangan dengan laporan marketplace secara diam-diam, lalu
        // terbaca sebagai "pesanan hilang" padahal yang salah pembacaannya.
        //
        // Jadi hasil perbaikan boleh DITAWARKAN, tidak pernah dipakai sendiri.
        skor = Math.min(skor, 0.79);
        sebab.push("ada huruf yang dibaca sebagai angka — perlu dibenarkan");
      }

      skor = Math.min(1, Math.max(0, skor));
      const lama = hasil.get(kandidat.v);
      if (!lama || skor > lama.skor) {
        hasil.set(kandidat.v, {
          nilai: kandidat.v,
          skor,
          keyakinan: skor >= 0.8 ? "tinggi" : skor >= 0.45 ? "sedang" : "rendah",
          keluarga: kel.nama,
          berjangkar,
          alasan: sebab,
        });
      }
      // TIDAK berhenti di kandidat pertama yang cocok.
      //
      // Yang apa adanya sering hanya menyentuh keluarga terlemah: terukur di
      // korpus, "S85367823326934914" berhenti sebagai huruf-angka (0,63)
      // sementara bentuk 18-angkanya tidak pernah dilihat, sehingga yang
      // ditawarkan ke orang untaian berhuruf S di depan alih-alih nomor yang
      // bisa dikenali sekali lihat. Keduanya dinilai; yang tertinggi menang.
      // Batas 0,79 untuk hasil perbaikan tetap berlaku, jadi ini menaikkan
      // mutu yang DITAWARKAN tanpa menambah satu pun yang diterima otomatis.
    }
  }

  return [...hasil.values()]
    .filter((b) => b.keyakinan !== "rendah")
    .sort((a, b) => b.skor - a.skor);
}

function kandidatDari(mentah: string): { v: string; diperbaiki: boolean }[] {
  const bersih = bersihkan(mentah).toUpperCase();
  if (!bersih) return [];
  const out = [{ v: bersih, diperbaiki: false }];
  if (!layakDiperbaiki(bersih)) return out;
  const diperbaiki = repair(bersih);
  if (diperbaiki !== bersih) out.push({ v: diperbaiki, diperbaiki: true });
  return out;
}

/**
 * Bacaan terbaik, atau null.
 *
 * Kalau dua kandidat sama kuatnya dan nilainya berbeda, tidak ada dasar
 * memilih salah satunya, jadi keduanya diturunkan ke "sedang" -- biar orangnya
 * yang menunjuk. Diam-diam memilih yang pertama adalah cara menghasilkan
 * nomor yang bentuknya sempurna dan isinya salah.
 */
export function bacaOrderId(text: string | null | undefined): BacaanOrderId | null {
  const semua = bacaSemuaOrderId(text);
  if (semua.length === 0) return null;
  const teratas = semua[0]!;
  if (semua.length > 1 && semua[1]!.skor === teratas.skor) {
    return { ...teratas, keyakinan: "sedang", skor: Math.min(teratas.skor, 0.7),
             alasan: [...teratas.alasan, "ada kandidat lain yang sama kuatnya"] };
  }
  return teratas;
}

/**
 * Order id yang boleh dipakai TANPA dibenarkan orang.
 *
 * Hanya keyakinan tinggi. Yang sedang bukan ditolak -- ia ditawarkan lewat
 * bacaOrderId() ke lapisan yang punya orang di depannya.
 */
export function findOrderId(text: string | null | undefined): string | null {
  const b = bacaOrderId(text);
  return b && b.keyakinan === "tinggi" ? b.nilai : null;
}

/**
 * Order id yang DIKETIK atau DIBENARKAN orang.
 *
 * Jauh lebih longgar, dan itu disengaja: orang yang mengetiknya sedang
 * memegang labelnya. Yang ditolak di sini hanyalah yang jelas-jelas bukan
 * nomor pesanan -- nomor pengiriman kurir, telepon, nominal.
 */
export function normaliseOrderIdTyped(raw: string | null | undefined): string | null {
  const bersih = bersihkan(raw).toUpperCase();
  if (!bersih) return null;
  if (isOrderId(bersih)) return bersih;
  if (jelasBukanOrderId(bersih)) return null;
  if (bersih.length < 8 || bersih.length > 26) return null;
  return /^[A-Z0-9]+$/.test(bersih) ? bersih : null;
}

/**
 * Nilai terbaik dari dua sumber: yang sudah tersimpan, lalu teks mentahnya.
 *
 * Yang tersimpan didahulukan karena ia datang dari ponsel yang melihat puluhan
 * frame, sedangkan teks di sini biasanya hasil satu JPEG.
 */
export function bestOrderId(
  stored: string | null | undefined,
  text: string | null | undefined,
): string | null {
  return normaliseOrderIdTyped(stored) ?? findOrderId(text);
}
