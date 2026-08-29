import { bacaXlsx, type LembarXlsx } from "./xlsx.js";

/**
 * Terjemahan laporan penyelesaian TikTok Shop ke bentuk yang netral.
 *
 * Yang dipetakan sengaja SEDIKIT: tanggal, nominal, jenis, nomor referensi,
 * rekening. Laporan aslinya punya lebih dari delapan puluh kolom biaya, dan
 * menyalin semuanya ke kolom-kolom sendiri berarti membangun ulang akuntansi
 * TikTok di dalam sistem ini -- yang akan usang setiap kali mereka menambah
 * satu jenis biaya. Rinciannya disimpan utuh di kolom `raw`, jadi tidak ada
 * yang hilang, tapi yang dijanjikan oleh skema hanyalah yang benar-benar
 * dipakai untuk mengaudit.
 */

export interface BarisLaporan {
  kind: "withdrawal" | "earnings" | "adjustment";
  externalRef: string | null;
  occurredOn: string;
  amount: number;
  bankAccount: string | null;
  status: string | null;
  raw: Record<string, string>;
}

export interface HasilUrai {
  marketplace: string;
  periodFrom: string | null;
  periodTo: string | null;
  currency: string | null;
  settlementAmount: number | null;
  totalIncome: number | null;
  totalFees: number | null;
  rawSummary: Record<string, string>;
  lines: BarisLaporan[];
}

/** "2026/08/29" atau "2026-08-29" jadi "2026-08-29". Selain itu null. */
function tanggal(v: string | undefined): string | null {
  if (!v) return null;
  const m = /(\d{4})[/-](\d{2})[/-](\d{2})/.exec(v.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function angka(v: string | undefined): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace(/[^\d.,-]/g, "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function sel(l: LembarXlsx, baris: number, kolom: string): string | undefined {
  return l.baris.get(baris)?.get(kolom);
}

/** Peta huruf kolom -> judul, dibaca dari baris kepala. */
function kepala(l: LembarXlsx, barisKepala = 1): Map<string, string> {
  const out = new Map<string, string>();
  const b = l.baris.get(barisKepala);
  if (b) for (const [k, v] of b) out.set(k, v.trim());
  return out;
}

function kolomBerjudul(h: Map<string, string>, ...kandidat: string[]): string | null {
  for (const c of kandidat) {
    for (const [kol, judul] of h) {
      if (judul.toLowerCase() === c.toLowerCase()) return kol;
    }
  }
  for (const c of kandidat) {
    for (const [kol, judul] of h) {
      if (judul.toLowerCase().includes(c.toLowerCase())) return kol;
    }
  }
  return null;
}

export function uraiLaporanTiktok(buf: Buffer): HasilUrai {
  const buku = bacaXlsx(buf);

  const penarikan = buku.cari("penarikan");
  if (!penarikan) {
    throw new Error(
      "Sheet \"Riwayat penarikan\" tidak ditemukan. Yang dibutuhkan adalah ekspor "
        + "penyelesaian pembayaran TikTok Shop (berisi sheet Laporan dan Riwayat penarikan). "
        + `Sheet yang ada: ${buku.lembar.map((l) => l.nama).join(", ") || "(tidak ada)"}.`,
    );
  }

  const h = kepala(penarikan);
  const kJenis = kolomBerjudul(h, "Jenis transaksi", "Transaction type");
  const kRef = kolomBerjudul(h, "ID referensi", "Reference ID");
  const kMinta = kolomBerjudul(h, "Waktu permintaan", "Request time");
  const kTotal = kolomBerjudul(h, "Total", "Amount");
  const kStatus = kolomBerjudul(h, "Status");
  const kBerhasil = kolomBerjudul(h, "Waktu keberhasilan", "Success time");
  const kBank = kolomBerjudul(h, "Rekening bank", "Bank account");

  if (!kTotal || (!kBerhasil && !kMinta)) {
    throw new Error(
      "Kolom tanggal atau nominal tidak dikenali di sheet Riwayat penarikan. "
        + `Judul yang terbaca: ${[...h.values()].join(" | ")}`,
    );
  }

  const lines: BarisLaporan[] = [];
  for (const [nomor, kolom] of [...penarikan.baris.entries()].sort((a, b) => a[0] - b[0])) {
    if (nomor === 1) continue;
    const nominal = angka(kolom.get(kTotal));
    if (nominal === null) continue;

    // Tanggal keberhasilan lebih dipercaya daripada tanggal permintaan: yang
    // dicatat manual adalah saat uangnya sampai, bukan saat dimintanya.
    const tgl = tanggal(kBerhasil ? kolom.get(kBerhasil) : undefined)
      ?? tanggal(kMinta ? kolom.get(kMinta) : undefined);
    if (!tgl) continue;

    const jenisMentah = (kJenis ? kolom.get(kJenis) : "") ?? "";
    const j = jenisMentah.trim().toLowerCase();
    const kind: BarisLaporan["kind"] =
      j.includes("withdraw") || j.includes("penarikan")
        ? "withdrawal"
        : j.includes("earning") || j.includes("pendapatan")
          ? "earnings"
          : "adjustment";

    const bank = kBank ? (kolom.get(kBank) ?? "").trim() : "";
    const raw: Record<string, string> = {};
    for (const [kol, nilai] of kolom) raw[h.get(kol) ?? kol] = nilai;

    lines.push({
      kind,
      externalRef: kRef ? (kolom.get(kRef) ?? null) : null,
      occurredOn: tgl,
      amount: nominal,
      // "/" adalah cara laporan ini menulis "tidak ada".
      bankAccount: bank && bank !== "/" ? bank : null,
      status: kStatus ? (kolom.get(kStatus) ?? null) : null,
      raw,
    });
  }

  // Ringkasan dari sheet Laporan: label bisa berada di kolom B..E tergantung
  // kedalaman rinciannya, nilainya selalu di F.
  const rawSummary: Record<string, string> = {};
  const laporan = buku.cari("laporan");
  if (laporan) {
    for (const [, kolom] of laporan.baris) {
      let label: string | null = null;
      for (const k of ["B", "C", "D", "E"]) {
        const v = kolom.get(k);
        if (v && v.trim()) {
          label = v.trim();
          break;
        }
      }
      const nilai = kolom.get("F");
      if (label && nilai !== undefined) rawSummary[label] = nilai;
    }
  }

  const periode = rawSummary["Periode"] ?? "";
  const dua = periode.split("-").map((x) => x.trim());
  const periodFrom = tanggal(dua[0]);
  // "2026/08/01-2026/08/29": pisahnya tanda hubung, sedangkan tanggalnya
  // memakai garis miring, jadi belahan kedua diambil dari sisa teksnya.
  const periodTo = tanggal(periode.slice(periode.indexOf("-") + 1));

  return {
    marketplace: "tiktok",
    periodFrom,
    periodTo,
    currency: rawSummary["Mata uang"] ?? null,
    settlementAmount: angka(rawSummary["Jumlah penyelesaian pembayaran"]),
    totalIncome: angka(rawSummary["Total Pendapatan"]),
    totalFees: angka(rawSummary["Total Biaya"]),
    rawSummary,
    lines,
  };
}
