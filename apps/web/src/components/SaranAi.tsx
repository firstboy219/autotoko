import { useState } from "react";
import { api } from "../lib/api";
import { Icon } from "./Icon";
import { Button, Card, CardHeader, InlineAlert } from "./ui";

/**
 * Panel saran AI, dipakai di Master Produk, HPP, dan Dashboard v2.
 *
 * TIGA KEPUTUSAN YANG MEMBENTUK KOMPONEN INI.
 *
 * 1. TIDAK JALAN SENDIRI SAAT HALAMAN DIBUKA. Tiap permintaan memanggil model
 *    berbayar dan memakan beberapa detik. Menjalankannya otomatis berarti
 *    setiap kali seseorang lewat halaman produk, tagihan bertambah untuk saran
 *    yang mungkin tidak dibaca siapa pun. Harus diminta.
 *
 * 2. ASAL TRENNYA DITULIS APA ADANYA. Hanya sebagian penyedia yang punya alat
 *    pencarian web. Kalau trennya datang dari pengetahuan model, panel
 *    mengatakan begitu -- bukan menyebutnya "tren internet". Pemilik toko yang
 *    mengambil keputusan berdasarkan "tren terkini" yang ternyata pengetahuan
 *    lama dirugikan dua kali: oleh sarannya, dan oleh kepercayaannya.
 *
 * 3. BELUM DIKONFIGURASI BUKAN GALAT. Sampai API key diisi, panel menjelaskan
 *    pengaturan mana yang perlu diisi -- bukan kotak merah yang tidak bisa
 *    ditindaklanjuti siapa pun.
 */

interface Butir {
  judul: string;
  alasan: string;
  tindakan: string;
  dampak: "tinggi" | "sedang" | "rendah";
}

interface Jawaban {
  tersedia: boolean;
  alasan?: string;
  caraSetel?: string;
  saran: Butir[];
  sumber: { judul: string; url: string }[];
  caraDapatTren: "pencarian_web" | "pengetahuan_model" | "tidak_ada";
}

const ASAL: Record<Jawaban["caraDapatTren"], string> = {
  pencarian_web: "Tren dibaca langsung dari internet",
  pengetahuan_model: "Tren dari pengetahuan model, bukan pencarian internet hari ini",
  tidak_ada: "",
};

/** Label kata, bukan warna saja: dampak harus terbaca tanpa membedakan warna. */
const DAMPAK: Record<Butir["dampak"], { teks: string; kelas: string }> = {
  tinggi: { teks: "dampak tinggi", kelas: "bg-ink/10 text-ink" },
  sedang: { teks: "dampak sedang", kelas: "bg-ink/5 text-ink-2" },
  rendah: { teks: "dampak rendah", kelas: "bg-ink/5 text-ink-3" },
};

export function SaranAi({
  path,
  keterangan,
}: {
  /** Rute yang menghasilkan sarannya, mis. "/products/saran". */
  path: string;
  /** Satu kalimat: saran ini membaca apa. */
  keterangan: string;
}) {
  const [data, setData] = useState<Jawaban | null>(null);
  const [muat, setMuat] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  async function minta() {
    setMuat(true);
    setGalat(null);
    try {
      setData(await api.get<Jawaban>(path));
    } catch (e) {
      setGalat((e as Error).message);
    } finally {
      setMuat(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Saran AI"
        subtitle={keterangan}
        action={
          <Button variant="filled" icon="bot" loading={muat} onClick={minta}>
            {muat ? "Menyusun..." : data ? "Minta ulang" : "Minta saran"}
          </Button>
        }
      />

      {muat && (
        <p className="px-4 pb-4 text-sm text-ink-3">
          Membaca data toko dan tren pasar. Biasanya 10–30 detik.
        </p>
      )}

      {galat && !muat && (
        <div className="px-4 pb-4">
          <InlineAlert tone="danger">{galat}</InlineAlert>
        </div>
      )}

      {data && !data.tersedia && !muat && (
        <div className="px-4 pb-4 space-y-2">
          <InlineAlert tone="warning">{data.alasan}</InlineAlert>
          {data.caraSetel && <p className="text-xs text-ink-3">{data.caraSetel}</p>}
        </div>
      )}

      {data?.tersedia && !muat && (
        <div className="px-4 pb-4 space-y-3">
          {data.saran.length === 0 && (
            <p className="text-sm text-ink-3">
              Model tidak mengembalikan saran yang bisa dibaca. Coba minta ulang.
            </p>
          )}

          {data.saran.map((s, i) => (
            <div key={i} className="rounded-lg border border-line p-3">
              <div className="flex items-start justify-between gap-3">
                <h4 className="text-sm font-medium text-ink">{s.judul}</h4>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${DAMPAK[s.dampak].kelas}`}
                >
                  {DAMPAK[s.dampak].teks}
                </span>
              </div>
              {s.alasan && <p className="mt-1.5 text-xs text-ink-2">{s.alasan}</p>}
              {s.tindakan && (
                <p className="mt-2 flex gap-1.5 text-xs text-ink">
                  <span className="text-ink-3">
                    <Icon name="chevronRight" />
                  </span>
                  {s.tindakan}
                </p>
              )}
            </div>
          ))}

          {ASAL[data.caraDapatTren] && (
            <p className="text-[11px] text-ink-3">{ASAL[data.caraDapatTren]}.</p>
          )}

          {data.sumber.length > 0 && (
            <details className="text-[11px] text-ink-3">
              <summary className="cursor-pointer">
                {data.sumber.length} sumber yang dibaca
              </summary>
              <ul className="mt-1.5 space-y-1">
                {data.sumber.map((s, i) => (
                  <li key={i}>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline underline-offset-2 hover:text-ink-2"
                    >
                      {s.judul}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}
