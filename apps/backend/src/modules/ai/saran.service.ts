import { Injectable, Logger } from "@nestjs/common";
import { AiProviderService } from "./ai-provider.service.js";

/**
 * Saran untuk pemilik toko, dibangun dari datanya SENDIRI.
 *
 * TIGA ATURAN YANG MEMBENTUK SELURUH BERKAS INI.
 *
 * 1. ANGKA TIDAK BOLEH DIKARANG. Model hanya boleh menyebut angka yang ada di
 *    dalam ringkasan yang dikirim ke sini -- ringkasan itu dibangun dari
 *    service yang sama dengan yang menggambar layarnya, jadi angka di saran
 *    dan angka di layar mustahil berbeda. Saran yang menyebut angka yang tidak
 *    ada di layar akan membuat pemiliknya berhenti percaya pada keduanya.
 *
 * 2. TREN INTERNET HARUS JUJUR ASALNYA. Permintaannya menyebut "tren dari
 *    internet, khususnya Indonesia". Itu hanya benar-benar terjadi kalau
 *    penyedia yang dipilih punya alat pencarian web. Kalau tidak, model
 *    menjawab dari pengetahuannya sendiri -- yang masih berguna, tapi BUKAN
 *    tren hari ini. Jawaban selalu membawa `caraDapatTren`, dan layar
 *    menampilkannya apa adanya. Menyebut pengetahuan model sebagai "tren
 *    internet" adalah kebohongan kecil yang persis merusak gunanya fitur ini.
 *
 * 3. TIDAK ADA KUNCI BUKAN GALAT. Belum ada satu pun API key AI di
 *    admin_settings. Melempar 502 akan membuat tiga layar menampilkan kotak
 *    merah yang tidak bisa ditindaklanjuti siapa pun. Yang dikembalikan adalah
 *    jawaban 200 yang menjelaskan persis pengaturan mana yang perlu diisi.
 */
@Injectable()
export class SaranService {
  private readonly logger = new Logger(SaranService.name);

  constructor(private readonly ai: AiProviderService) {}

  /**
   * Satu butir saran. Sengaja bukan paragraf bebas: pemilik toko yang sedang
   * sibuk membaca daftar, bukan esai, dan bidang "tindakan" memaksa saran
   * berhenti pada sesuatu yang bisa dikerjakan besok pagi.
   */
  static readonly BENTUK = `[
  {
    "judul": "kalimat pendek, maksimal 8 kata",
    "alasan": "kenapa, MENYEBUT angka dari data di atas",
    "tindakan": "satu langkah konkret yang bisa dikerjakan minggu ini",
    "dampak": "tinggi" | "sedang" | "rendah"
  }
]`;

  private sistem(peran: string): string {
    return [
      `Kamu penasihat bisnis untuk pemilik toko online di Indonesia. ${peran}`,
      "",
      "ATURAN KERAS:",
      "- Jawab HANYA dengan JSON array, tanpa teks pembuka atau penutup.",
      "- Setiap angka yang kamu sebut HARUS ada di data yang diberikan.",
      "  Kalau sebuah angka tidak ada di sana, jangan sebut angka sama sekali.",
      "- Jangan mengarang nama produk, toko, atau marketplace yang tidak ada.",
      "- Maksimal 5 butir. Urutkan dari yang paling berdampak.",
      "- Bahasa Indonesia yang lugas, seperti bicara ke pemilik toko, bukan ke analis.",
      "- Kalau datanya terlalu sedikit untuk menyimpulkan sesuatu, katakan itu",
      "  sebagai satu butir saran, jangan dipaksakan menjadi lima.",
      "",
      "Bentuk jawaban:",
      SaranService.BENTUK,
    ].join("\n");
  }

  /**
   * Menjalankan satu permintaan saran.
   *
   * `tren` menyalakan pencarian web kalau penyedianya mendukung; kalau tidak,
   * jalannya tetap lanjut lewat jalur teks biasa dan hasilnya menandai bahwa
   * trennya datang dari pengetahuan model.
   */
  async dariBrief(opsi: {
    peran: string;
    permintaan: string;
    data: unknown;
    tren?: boolean;
  }): Promise<SaranJawaban> {
    const siap = await this.ai.kunciTersedia("saran_bisnis");
    if (!siap.ada) {
      return {
        tersedia: false,
        alasan:
          `Saran AI belum bisa jalan: API key untuk penyedia "${siap.provider}" ` +
          "belum diisi.",
        caraSetel:
          `Isi pengaturan "${siap.pengaturan}" di Admin CMS → AI Autopilot. ` +
          "Penyedia dan model bisa dipilih per fitur di halaman yang sama.",
        saran: [],
        sumber: [],
        caraDapatTren: "tidak_ada",
      };
    }

    const pesan = [
      opsi.permintaan,
      "",
      "DATA TOKO INI (satu-satunya sumber angka yang boleh kamu sebut):",
      "```json",
      JSON.stringify(opsi.data, null, 1),
      "```",
    ].join("\n");

    try {
      const hasil = await this.ai.lengkapiDenganTren(
        "saran_bisnis",
        {
          system: this.sistem(opsi.peran),
          messages: [{ role: "user", content: pesan }],
          maxTokens: 4000,
        },
        {
          cariTren: opsi.tren === true,
          // Dipersempit ke Indonesia lewat kalimatnya, bukan lewat daftar
          // domain: tren dagang Indonesia tersebar di marketplace, media, dan
          // media sosial, dan daftar domain yang saya karang akan memotong
          // justru sumber yang paling relevan.
          petunjukCari:
            "Cari tren produk dan perilaku belanja online di INDONESIA dalam " +
            "3 bulan terakhir yang relevan dengan produk toko ini. " +
            "Utamakan sumber Indonesia.",
        },
      );

      return {
        tersedia: true,
        saran: uraikan(hasil.teks),
        sumber: hasil.sumber,
        caraDapatTren: hasil.caraDapatTren,
      };
    } catch (e) {
      this.logger.error(`Saran gagal: ${(e as Error).message}`);
      return {
        tersedia: false,
        alasan: `Saran AI gagal dijalankan: ${(e as Error).message}`,
        saran: [],
        sumber: [],
        caraDapatTren: "tidak_ada",
      };
    }
  }
}

export interface SaranButir {
  judul: string;
  alasan: string;
  tindakan: string;
  dampak: "tinggi" | "sedang" | "rendah";
}

export interface SaranJawaban {
  tersedia: boolean;
  alasan?: string;
  caraSetel?: string;
  saran: SaranButir[];
  sumber: { judul: string; url: string }[];
  caraDapatTren: "pencarian_web" | "pengetahuan_model" | "tidak_ada";
}

/**
 * Mengambil JSON dari jawaban model.
 *
 * Model diminta menjawab JSON saja, dan biasanya menurut -- tapi "biasanya"
 * bukan jaminan, dan satu kalimat pembuka tidak boleh membuat seluruh saran
 * hilang. Karena itu yang dicari kurung siku pertama sampai terakhir, lalu
 * tiap butir diperiksa bentuknya satu per satu.
 */
function uraikan(teks: string): SaranButir[] {
  const mulai = teks.indexOf("[");
  const habis = teks.lastIndexOf("]");
  if (mulai < 0 || habis <= mulai) return [];
  let mentah: unknown;
  try {
    mentah = JSON.parse(teks.slice(mulai, habis + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(mentah)) return [];

  const keluar: SaranButir[] = [];
  for (const b of mentah) {
    if (!b || typeof b !== "object") continue;
    const o = b as Record<string, unknown>;
    const judul = typeof o.judul === "string" ? o.judul.trim() : "";
    if (!judul) continue;
    const dampak = o.dampak === "tinggi" || o.dampak === "rendah" ? o.dampak : "sedang";
    keluar.push({
      judul: judul.slice(0, 120),
      alasan: (typeof o.alasan === "string" ? o.alasan : "").slice(0, 600),
      tindakan: (typeof o.tindakan === "string" ? o.tindakan : "").slice(0, 600),
      dampak,
    });
    if (keluar.length >= 5) break;
  }
  return keluar;
}
