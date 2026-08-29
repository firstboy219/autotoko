import { inflateRawSync } from "node:zlib";

/**
 * Pembaca .xlsx seadanya, tanpa pustaka luar.
 *
 * Sebuah .xlsx hanyalah zip berisi XML, dan yang dibutuhkan di sini cuma dua
 * hal: nama sheet dan isi selnya. Menambah paket pihak ketiga untuk itu berarti
 * menambah sesuatu yang harus ikut dirawat bertahun-tahun demi kemampuan yang
 * muat dalam dua ratus baris -- dan berkas yang diurai di sini datang dari luar
 * (unduhan marketplace), jadi lebih sedikit kode asing yang menyentuhnya justru
 * lebih baik.
 *
 * Cukup untuk ekspor marketplace: deflate atau stored, tanpa enkripsi, tanpa
 * zip64. Berkas di luar itu ditolak dengan pesan yang menyebutkan alasannya,
 * bukan dibiarkan menghasilkan angka yang salah.
 */

interface EntriZip {
  nama: string;
  data: Buffer;
}

/** Baca seluruh entri zip lewat direktori pusatnya. */
function bukaZip(buf: Buffer): Map<string, Buffer> {
  // End of central directory: dicari dari belakang karena panjang komentarnya
  // tidak diketahui.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Berkas ini bukan .xlsx yang bisa dibaca (zip tidak utuh).");

  const jumlah = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  const hasil = new Map<string, Buffer>();
  for (let n = 0; n < jumlah; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const metode = buf.readUInt16LE(p + 10);
    const ukuranTerkompresi = buf.readUInt32LE(p + 20);
    const panjangNama = buf.readUInt16LE(p + 28);
    const panjangExtra = buf.readUInt16LE(p + 30);
    const panjangKomentar = buf.readUInt16LE(p + 32);
    const offsetLokal = buf.readUInt32LE(p + 42);
    const nama = buf.subarray(p + 46, p + 46 + panjangNama).toString("utf8");

    // Header lokal punya panjang extra-nya SENDIRI, yang sering berbeda dari
    // yang di direktori pusat. Memakai yang salah menggeser awal data.
    const namaLokal = buf.readUInt16LE(offsetLokal + 26);
    const extraLokal = buf.readUInt16LE(offsetLokal + 28);
    const mulai = offsetLokal + 30 + namaLokal + extraLokal;
    const mentah = buf.subarray(mulai, mulai + ukuranTerkompresi);

    if (!nama.endsWith("/")) {
      try {
        hasil.set(nama, metode === 0 ? Buffer.from(mentah) : inflateRawSync(mentah));
      } catch {
        // Satu entri rusak tidak boleh menggagalkan seluruh berkas; yang
        // dibutuhkan cuma beberapa entri, dan ketiadaannya ketahuan di atas.
      }
    }
    p += 46 + panjangNama + panjangExtra + panjangKomentar;
  }
  return hasil;
}

function lepasEntitas(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    // &amp; terakhir, kalau tidak "&amp;lt;" jadi "<".
    .replace(/&amp;/g, "&");
}

function teksDalam(xml: string): string {
  let out = "";
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out += lepasEntitas(m[1] ?? "");
  return out;
}

export interface LembarXlsx {
  nama: string;
  /** baris (1-based) -> kolom huruf -> nilai teks */
  baris: Map<number, Map<string, string>>;
}

export interface BukuXlsx {
  lembar: LembarXlsx[];
  cari(namaMengandung: string): LembarXlsx | null;
}

export function bacaXlsx(buf: Buffer): BukuXlsx {
  const zip = bukaZip(buf);

  const wbXml = zip.get("xl/workbook.xml");
  if (!wbXml) throw new Error("Berkas ini bukan .xlsx (xl/workbook.xml tidak ada).");

  // Teks bersama: sel bertipe "s" menyimpan indeks ke daftar ini.
  const bersama: string[] = [];
  const ssXml = zip.get("xl/sharedStrings.xml")?.toString("utf8");
  if (ssXml) {
    const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(ssXml))) bersama.push(teksDalam(m[1] ?? ""));
  }

  // rId -> berkas sheet. Urutan berkas tidak dijamin sama dengan urutan sheet,
  // jadi dipetakan lewat rels dan bukan ditebak dari nama sheet1/sheet2.
  const rels = zip.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const target = new Map<string, string>();
  {
    // Cocokkan juga yang TIDAK menutup-sendiri: penulis ekspor TikTok
    // menulis <Relationship ...></Relationship>, dan pola lama cocok nol
    // kali sehingga seluruh lembar hilang tanpa satu pun galat.
    const re = /<Relationship\b[^>]*>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rels))) {
      const id = /Id="([^"]+)"/.exec(m[0])?.[1];
      const t = /Target="([^"]+)"/.exec(m[0])?.[1];
      if (id && t) target.set(id, t.replace(/^\/?xl\//, "").replace(/^\.\//, ""));
    }
  }

  const lembar: LembarXlsx[] = [];
  const wb = wbXml.toString("utf8");
  // Sama seperti di atas: <sheet ...></sheet> juga sah. \b menjaga agar
  // <sheets>, <sheetView>, dan <sheetPr> tidak ikut tercocok.
  const reSheet = /<sheet\b[^>]*>/g;
  let ms: RegExpExecArray | null;
  while ((ms = reSheet.exec(wb))) {
    const nama = lepasEntitas(/name="([^"]*)"/.exec(ms[0])?.[1] ?? "");
    const rid = /r:id="([^"]+)"/.exec(ms[0])?.[1];
    const jalur = rid ? target.get(rid) : undefined;
    const xml = jalur ? zip.get("xl/" + jalur)?.toString("utf8") : undefined;
    if (!xml) continue;

    const baris = new Map<number, Map<string, string>>();
    const reC = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let mc: RegExpExecArray | null;
    while ((mc = reC.exec(xml))) {
      const atribut = mc[1] ?? "";
      const isi = mc[2] ?? "";
      const ref = /r="([A-Z]+)(\d+)"/.exec(atribut);
      if (!ref) continue;
      const kolom = ref[1]!;
      const nomor = Number(ref[2]);
      const tipe = /t="([^"]+)"/.exec(atribut)?.[1];

      let nilai = "";
      if (tipe === "s") {
        const v = /<v>([\s\S]*?)<\/v>/.exec(isi)?.[1];
        nilai = v ? (bersama[Number(v)] ?? "") : "";
      } else if (tipe === "inlineStr") {
        nilai = teksDalam(isi);
      } else {
        nilai = lepasEntitas(/<v>([\s\S]*?)<\/v>/.exec(isi)?.[1] ?? "");
      }
      if (nilai === "") continue;
      if (!baris.has(nomor)) baris.set(nomor, new Map());
      baris.get(nomor)!.set(kolom, nilai);
    }
    lembar.push({ nama, baris });
  }

  return {
    lembar,
    cari(namaMengandung: string) {
      const k = namaMengandung.toLowerCase();
      return lembar.find((l) => l.nama.toLowerCase().includes(k)) ?? null;
    },
  };
}
