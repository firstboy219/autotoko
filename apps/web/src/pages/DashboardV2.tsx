import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";
import { api } from "../lib/api";
import { rupiah } from "../lib/fmt";
import { Icon, type IconName } from "../components/Icon";
import { Button, Card, CardHeader, InlineAlert, PageHeader, Select, Skeleton, useToast } from "../components/ui";
import { useFetch } from "../lib/useFetch";

import { SaranAi } from "../components/SaranAi";
/* ─────────────────────────────────────────────────────────────────────────
   Palet
   ─────────────────────────────────────────────────────────────────────────
   Empat slot kategorikal pertama dari palet acuan, divalidasi terhadap surface
   kartu aplikasi ini (#ffffff, mode terang): pita lightness LULUS, lantai
   chroma LULUS, pemisahan CVD terburuk ΔE 9,1 (protan) LULUS, lantai
   penglihatan normal ΔE 22,9 LULUS. Aqua dan kuning di bawah kontras 3:1,
   yang MEWAJIBKAN label terlihat — dipenuhi lewat legenda berlabel nilai dan
   tampilan tabel, bukan lewat warna saja.

   Urutan slot tetap dan mengikuti ENTITAS, bukan peringkatnya: menyaring atau
   mengurutkan ulang tidak pernah mengecat ulang yang tersisa.               */
const WARNA = {
  sellerBersih: "#2a78d6",
  bahanBaku: "#eb6834",
  subSeller: "#1baf7a",
  sedekah: "#eda100",
  /** Satu seri = satu warna. Batang nominal tidak diberi ramp nilai. */
  batang: "#2a78d6",
  grid: "#e1e0d9",
  sumbu: "#c3c2b7",
  tinta: "#0b0b0b",
  tintaKedua: "#52514e",
  tintaRedup: "#898781",
  baik: "#0ca30c",
  peringatan: "#fab219",
  serius: "#ec835a",
  kritis: "#d03b3b",
} as const;

interface Titik {
  tanggal: string;
  kredit: number;
  paket: number;
}

interface Data {
  range: { from: string; to: string; hari: number; bandingFrom: string; bandingTo: string };
  uang: {
    kredit: number;
    sedekah: number;
    subSeller: number;
    bahanBaku: number;
    sellerBersih: number;
    sellerKotor: number;
    rateEfektif: number;
    perHari: number;
    pencairan: number;
  };
  /**
   * Biaya yang BENAR-BENAR keluar, bukan cadangan.
   *
   * uang.bahanBaku adalah persentase yang disisihkan; biaya.bahanBaku adalah
   * uang yang sudah pindah rekening. Keduanya ditampilkan berdampingan supaya
   * selisihnya terlihat.
   */
  biaya: {
    bahanBaku: number;
    pembelianBahan: number;
    upahPacking: number;
    feeAdmin: number;
    selisihCadangan: number;
    labaBersih: number;
    rateBersih: number;
  };
  belumCair: { paket: number; umurTertua: number; umurRata: number };
  stokMenipis: {
    total: number;
    teratas: { id: string; nama: string; satuan: string | null; stok: number; ambang: number }[];
  };
  /**
   * Dua hal yang tidak menurunkan angka mana pun sampai terlambat.
   *
   * walletRendah null berarti saldonya cukup -- peringatan yang selalu muncul
   * berhenti dibaca.
   */
  peringatan: {
    walletRendah: { saldo: number; ambang: number } | null;
    tokenHabis: { id: string; nama: string; kadaluarsa: string | null }[];
  };
  banding: { kredit: number; sellerBersih: number; paket: number };
  volume: { paket: number; pcs: number; tokoAktif: number; tokoTotal: number; perHari: number };
  seri: Titik[];
  toko: { id: string; nama: string; marketplace: string; kredit: number; sellerBersih: number; paket: number }[];
  produk: { id: string; nama: string; pcs: number; paket: number }[];
  keandalan: {
    scan: number;
    berToko: number;
    berOrderId: number;
    isiPasti: number;
    persenToko: number;
    persenOrderId: number;
    persenIsi: number;
  };
  tindakan: {
    total: number;
    tinggi: number;
    tugas: { key: string; title: string; count: number; severity: string; href: string }[];
  };
  penjualanHariIni: {
    pesanan: number;
    nominal: number;
    profitBersih: number | null;
    perToko: { shopId: string | null; nama: string; pesanan: number; nominal: number; profit?: number | null }[];
  };
}

const RENTANG = [
  { hari: 7, label: "7 hari" },
  { hari: 30, label: "30 hari" },
  { hari: 90, label: "90 hari" },
];

const ringkas = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)} jt`
    : n >= 1_000
      ? `${Math.round(n / 1_000)} rb`
      : String(Math.round(n));

const tglPendek = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

/* ───────────────────────────────────────────── delta terhadap periode lalu */

/**
 * Perubahan terhadap periode sebelumnya.
 *
 * Ikon dan kata, bukan warna saja: panah hijau tanpa tulisan tidak terbaca
 * oleh sebagian pembaca, dan "naik" tidak selalu berarti baik.
 */
function Delta({ kini, lalu, terbalik = false }: { kini: number; lalu: number; terbalik?: boolean }) {
  if (!lalu) {
    return <span className="text-xs text-ink-3">belum ada pembanding</span>;
  }
  const pct = ((kini - lalu) / Math.abs(lalu)) * 100;
  const naik = pct >= 0;
  const bagus = terbalik ? !naik : naik;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs"
      style={{ color: bagus ? "#006300" : WARNA.kritis }}
    >
      {/* Ikon mewarisi warna lewat currentColor dari span di atas. */}
      <Icon name={naik ? "trending" : "chevronDown"} size={13} />
      {naik ? "+" : ""}
      {pct.toFixed(0)}% dari periode sebelumnya
    </span>
  );
}

/* ─────────────────────────────────────────────────────────── grafik deret */

/**
 * Satu ukuran, satu sumbu.
 *
 * Uang dan paket sengaja jadi DUA grafik bertumpuk yang berbagi sumbu waktu,
 * bukan satu grafik dua sumbu-y. Dua skala pada satu bidang menciptakan
 * korelasi yang tidak ada di datanya — kesalahan grafik yang paling sering
 * dan paling meyakinkan.
 */
function Deret({
  titik,
  ambil,
  warna,
  format,
  tinggi = 132,
}: {
  titik: Titik[];
  ambil: (t: Titik) => number;
  warna: string;
  format: (n: number) => string;
  tinggi?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const W = 720;
  const H = tinggi;
  const PAD = { atas: 10, kanan: 8, bawah: 22, kiri: 52 };
  const nilai = titik.map(ambil);
  const maks = Math.max(1, ...nilai);
  const plotW = W - PAD.kiri - PAD.kanan;
  const plotH = H - PAD.atas - PAD.bawah;

  const x = (i: number) => PAD.kiri + (titik.length <= 1 ? plotW / 2 : (i * plotW) / (titik.length - 1));
  const y = (v: number) => PAD.atas + plotH - (v / maks) * plotH;

  const garis = nilai.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ");
  const area = `${garis} L ${x(nilai.length - 1)} ${PAD.atas + plotH} L ${x(0)} ${PAD.atas + plotH} Z`;

  // Tiga garis bantu saja; kisi yang ramai menenggelamkan datanya sendiri.
  const kisi = [0, 0.5, 1].map((f) => ({ v: maks * f, y: y(maks * f) }));

  function gerak(e: React.MouseEvent<SVGSVGElement>) {
    const kotak = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - kotak.left) / kotak.width) * W;
    const i = Math.round(((px - PAD.kiri) / plotW) * (titik.length - 1));
    setHover(i >= 0 && i < titik.length ? i : null);
  }

  const t = hover != null ? titik[hover] : null;

  return (
    <div ref={wrap} className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: H }}
        onMouseMove={gerak}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Grafik deret waktu"
      >
        {kisi.map((g, i) => (
          <g key={i}>
            <line
              x1={PAD.kiri}
              x2={W - PAD.kanan}
              y1={g.y}
              y2={g.y}
              stroke={WARNA.grid}
              strokeWidth={1}
            />
            <text x={PAD.kiri - 8} y={g.y + 3} textAnchor="end" fontSize={10} fill={WARNA.tintaRedup}>
              {format(g.v)}
            </text>
          </g>
        ))}

        <path d={area} fill={warna} opacity={0.12} />
        <path d={garis} fill="none" stroke={warna} strokeWidth={2} strokeLinejoin="round" />

        {/* Titik terakhir diberi tanda dan label — satu label yang berarti,
            bukan angka di setiap titik. */}
        {nilai.length > 0 && (
          <circle
            cx={x(nilai.length - 1)}
            cy={y(nilai[nilai.length - 1]!)}
            r={4}
            fill={warna}
            stroke="#ffffff"
            strokeWidth={2}
          />
        )}

        {hover != null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={PAD.atas}
            y2={PAD.atas + plotH}
            stroke={WARNA.sumbu}
            strokeWidth={1}
          />
        )}

        <line
          x1={PAD.kiri}
          x2={W - PAD.kanan}
          y1={PAD.atas + plotH}
          y2={PAD.atas + plotH}
          stroke={WARNA.sumbu}
          strokeWidth={1}
        />
        {titik.map((p, i) =>
          i % Math.max(1, Math.ceil(titik.length / 6)) === 0 ? (
            <text
              key={p.tanggal}
              x={x(i)}
              y={H - 6}
              textAnchor="middle"
              fontSize={10}
              fill={WARNA.tintaRedup}
            >
              {tglPendek(p.tanggal)}
            </text>
          ) : null,
        )}
      </svg>

      {t && (
        <div
          className="pointer-events-none absolute top-1 rounded-md border border-line bg-white px-2 py-1 text-xs shadow-sm"
          style={{
            left: `min(calc(${((x(hover!) / W) * 100).toFixed(2)}% + 8px), calc(100% - 150px))`,
          }}
        >
          <div className="text-ink-3">{tglPendek(t.tanggal)}</div>
          <div className="text-ink tabular-nums">{format(ambil(t))}</div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────── batang horizontal */

/**
 * Perbandingan besaran antar hal yang tidak punya urutan alami.
 *
 * Satu warna untuk semua batang. Mewarnai makin gelap makin besar akan
 * mengkodekan panjang batang dua kali dan membakar satu-satunya kanal yang
 * masih bebas untuk informasi yang sudah terlihat.
 */
function Batang({
  baris,
}: {
  baris: { id: string; label: string; sub?: string; nilai: number; teks: string }[];
}) {
  const maks = Math.max(1, ...baris.map((b) => b.nilai));
  if (!baris.length) {
    return <p className="px-5 py-4 text-sm text-ink-3">Belum ada datanya pada periode ini.</p>;
  }
  return (
    <div className="px-5 py-3">
      {baris.map((b) => (
        <div key={b.id} className="py-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-sm text-ink">{b.label}</span>
            <span className="shrink-0 text-sm text-ink tabular-nums">{b.teks}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-canvas">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.max(2, (b.nilai / maks) * 100)}%`, background: WARNA.batang }}
              />
            </div>
            {b.sub && <span className="w-24 shrink-0 text-right text-xs text-ink-3">{b.sub}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── meteran */

function Meter({ label, nilai, dari, persen, catatan }: {
  label: string;
  nilai: number;
  dari: number;
  persen: number;
  catatan: string;
}) {
  const p = Math.round(persen * 100);
  const tone = p >= 85 ? WARNA.baik : p >= 50 ? WARNA.peringatan : WARNA.kritis;
  return (
    <div className="py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-ink">{label}</span>
        <span className="text-sm text-ink tabular-nums">
          {p}% <span className="text-xs text-ink-3">({nilai}/{dari})</span>
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-canvas">
        <div className="h-full rounded-full" style={{ width: `${p}%`, background: tone }} />
      </div>
      <p className="mt-1 text-xs text-ink-3">{catatan}</p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════ halaman */

/**
 * Dashboard v2.
 *
 * Dashboard lama dibangun di sekitar "order dan revenue" — order hari ini,
 * omzet hari ini, tren order, tabel order terbaru. Toko ini tidak memakai satu
 * pun dari itu: tabel orders berisi data uji dan angkanya nol selamanya. Jadi
 * ruang paling berharga di layar menampilkan nol, sementara uang yang
 * sebenarnya bergerak lewat pencairan dan paket yang sebenarnya dikirim lewat
 * scan resi tidak muncul sama sekali.
 *
 * Halaman ini menjawab urutan pertanyaan yang benar-benar ditanyakan pemilik
 * toko: berapa yang masuk → berapa yang jadi milik saya → dari mana → apa yang
 * harus dikerjakan → dan seberapa boleh saya percaya semua angka di atas.
 *
 * Yang terakhir itu jarang ada di dashboard mana pun, dan justru paling
 * menentukan: grafik per toko yang rapi tidak berarti apa-apa kalau sebagian
 * paketnya tidak terpetakan ke toko mana pun.
 */
export default function DashboardV2() {
  const [hari, setHari] = useState(30);
  const [data, setData] = useState<Data | null>(null);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);
  const [tabelKomposisi, setTabelKomposisi] = useState(false);

  useEffect(() => {
    let hidup = true;
    setMemuat(true);
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - (hari - 1) * 86400000).toISOString().slice(0, 10);
    api
      .get<Data>(`/dashboard/v2?from=${from}&to=${to}`)
      .then((d) => {
        if (hidup) {
          setData(d);
          setGalat(null);
        }
      })
      .catch((e) => hidup && setGalat((e as Error).message))
      .finally(() => hidup && setMemuat(false));
    return () => {
      hidup = false;
    };
  }, [hari]);

  const komposisi = useMemo(() => {
    if (!data) return [];
    const u = data.uang;
    return [
      { key: "sellerBersih", label: "Bagian saya (bersih)", nilai: u.sellerBersih, warna: WARNA.sellerBersih },
      { key: "bahanBaku", label: "Jatah bahan baku", nilai: u.bahanBaku, warna: WARNA.bahanBaku },
      { key: "subSeller", label: "Sub-seller", nilai: u.subSeller, warna: WARNA.subSeller },
      { key: "sedekah", label: "Sedekah", nilai: u.sedekah, warna: WARNA.sedekah },
    ].filter((k) => k.nilai > 0);
  }, [data]);

  const totalKomposisi = komposisi.reduce((a, b) => a + b.nilai, 0) || 1;

  return (
    <Layout title="Dashboard">
      <PageHeader
        title="Dashboard"
        subtitle="Uang yang masuk, ke mana perginya, dan seberapa boleh angkanya dipercaya."
      />

      <PenjualanBlok />

      {/* Akses cepat: pintasan ke tugas yang paling sering dibuka dari dashboard. */}
      <div className="mb-4">
        <div className="text-xs font-medium text-ink-3 mb-1.5">Akses cepat</div>
        <div className="flex flex-wrap gap-2">
          {([
            { to: "/orders", label: "Proses order", icon: "cart" },
            { to: "/master-postingan", label: "Master Postingan", icon: "package" },
            { to: "/promo", label: "Promosi", icon: "tag" },
            { to: "/pencairan", label: "Pencairan", icon: "banknote" },
            { to: "/wallet", label: "Isi saldo", icon: "wallet" },
          ] as { to: string; label: string; icon: IconName }[]).map((q) => (
            <Link
              key={q.to}
              to={q.to}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3.5 h-9 text-sm font-medium text-ink-2 hover:bg-canvas hover:text-ink transition"
            >
              <Icon name={q.icon} size={16} />
              {q.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Satu baris filter di atas segalanya yang dicakupnya. */}
      <div className="flex flex-wrap items-center gap-2">
        {RENTANG.map((r) => (
          <Button
            key={r.hari}
            size="sm"
            variant={r.hari === hari ? "filled" : "outline"}
            onClick={() => setHari(r.hari)}
          >
            {r.label}
          </Button>
        ))}
        {data && (
          <span className="ml-1 text-xs text-ink-3">
            {tglPendek(data.range.from)} — {tglPendek(data.range.to)} · dibandingkan dengan{" "}
            {tglPendek(data.range.bandingFrom)} — {tglPendek(data.range.bandingTo)}
          </span>
        )}
      </div>

      {galat && (
        <div className="mt-4">
          <InlineAlert tone="danger">{galat}</InlineAlert>
        </div>
      )}

      {/* Refetch menahan render sebelumnya dengan opasitas turun — tidak ada
          kedipan kerangka dan tidak ada lompatan tata letak. */}
      <div className={memuat && data ? "opacity-60 transition-opacity" : ""}>
        {!data && memuat && (
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Card key={i}>
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-3 h-7 w-32" />
              </Card>
            ))}
          </div>
        )}

        {data && (
          <>
            {/* ── angka utama ─────────────────────────────────────────── */}
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <Card className="lg:col-span-1">
                <div className="text-xs font-medium text-ink-2">Uang masuk</div>
                <div className="mt-1 text-4xl font-semibold leading-tight text-ink">
                  {rupiah(data.uang.kredit)}
                </div>
                <div className="mt-1">
                  <Delta kini={data.uang.kredit} lalu={data.banding.kredit} />
                </div>
                <p className="mt-2 text-xs text-ink-3">
                  {data.uang.pencairan} pencairan · {rupiah(data.uang.perHari)} per hari
                </p>
              </Card>

              <div className="grid gap-3 sm:grid-cols-3 lg:col-span-2">
                <Card>
                  <div className="text-xs font-medium text-ink-2">Bagian saya (bersih)</div>
                  <div className="mt-1.5 text-2xl font-semibold text-ink">
                    {rupiah(data.uang.sellerBersih)}
                  </div>
                  <div className="mt-1">
                    <Delta kini={data.uang.sellerBersih} lalu={data.banding.sellerBersih} />
                  </div>
                  <p className="mt-1 text-xs text-ink-3">sesudah jatah bahan baku</p>
                </Card>
                <Card>
                  <div className="text-xs font-medium text-ink-2">Rate efektif</div>
                  <div className="mt-1.5 text-2xl font-semibold text-ink">
                    {(data.uang.rateEfektif * 100).toFixed(1)}%
                  </div>
                  <p className="mt-1 text-xs text-ink-3">
                    dari tiap Rp 100 yang cair, {Math.round(data.uang.rateEfektif * 100)} tinggal
                  </p>
                </Card>
                <Card>
                  <div className="text-xs font-medium text-ink-2">Paket terkirim</div>
                  <div className="mt-1.5 text-2xl font-semibold text-ink">{data.volume.paket}</div>
                  <div className="mt-1">
                    <Delta kini={data.volume.paket} lalu={data.banding.paket} />
                  </div>
                  <p className="mt-1 text-xs text-ink-3">
                    {data.volume.perHari.toFixed(1)}/hari · {data.volume.tokoAktif} dari{" "}
                    {data.volume.tokoTotal} toko bergerak
                  </p>
                </Card>
              </div>
            </div>

            {/* Ditaruh di atas angka, bukan di bawah: yang perlu
                ditindaklanjuti hari ini kalah cepat terbaca kalau harus
                digulung dulu melewati grafik. */}
            {(data.peringatan.walletRendah || data.peringatan.tokenHabis.length > 0) && (
              <div className="mt-3 space-y-2">
                {data.peringatan.walletRendah && (
                  <InlineAlert tone="warning">
                    Saldo wallet {rupiah(data.peringatan.walletRendah.saldo)} — di bawah{" "}
                    {rupiah(data.peringatan.walletRendah.ambang)}.{" "}
                    <Link to="/wallet" className="underline underline-offset-2">
                      Isi saldo
                    </Link>
                  </InlineAlert>
                )}
                {data.peringatan.tokenHabis.length > 0 && (
                  <InlineAlert tone="danger">
                    {data.peringatan.tokenHabis.length} toko tokennya habis dalam 3 hari —{" "}
                    {data.peringatan.tokenHabis.map((t) => t.nama).join(", ")}. Kalau lewat,
                    toko terputus dari marketplace dan pesanan berhenti masuk tanpa pesan
                    galat.{" "}
                    <Link to="/toko" className="underline underline-offset-2">
                      Sambungkan ulang
                    </Link>
                  </InlineAlert>
                )}
              </div>
            )}

            {/* ── sesudah semua biaya yang benar-benar keluar ──────────── */}
            <div className="mt-3 grid gap-3 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <div className="text-xs font-medium text-ink-2">
                  Laba bersih, sesudah biaya yang benar-benar keluar
                </div>
                <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3">
                  <span className="text-2xl font-semibold text-ink tabular-nums">
                    {rupiah(data.biaya.labaBersih)}
                  </span>
                  <span className="text-xs text-ink-3">
                    {(data.biaya.rateBersih * 100).toFixed(1)}% dari uang yang cair
                  </span>
                </div>

                {/* Rincian sebagai daftar, bukan grafik: enam angka berurut
                    yang saling mengurangi dibaca lebih cepat sebagai baris
                    daripada sebagai batang. */}
                <dl className="mt-3 space-y-1 text-xs">
                  {[
                    ["Bagian seller (sesudah sedekah & sub-seller)", data.uang.sellerKotor, false],
                    ["Belanja bahan baku", -data.biaya.bahanBaku, true],
                    ["Upah packing", -data.biaya.upahPacking, true],
                    ["Fee admin", -data.biaya.feeAdmin, true],
                  ].map(([label, nilai, kurang]) => (
                    <div key={String(label)} className="flex justify-between gap-3">
                      <dt className={kurang ? "text-ink-3" : "text-ink-2"}>{String(label)}</dt>
                      <dd className="tabular-nums text-ink-2">{rupiah(Number(nilai))}</dd>
                    </div>
                  ))}
                  <div className="flex justify-between gap-3 border-t border-line pt-1 font-medium">
                    <dt className="text-ink">Laba bersih</dt>
                    <dd className="tabular-nums text-ink">{rupiah(data.biaya.labaBersih)}</dd>
                  </div>
                </dl>

                {/* Pertanyaan yang sebenarnya dijawab angka ini: cadangannya
                    kurang atau kelebihan. */}
                <p className="mt-2 text-xs text-ink-3">
                  Cadangan bahan baku {rupiah(data.uang.bahanBaku)} ·{" "}
                  {data.biaya.selisihCadangan >= 0
                    ? `${rupiah(data.biaya.selisihCadangan)} lebih besar daripada belanja`
                    : `${rupiah(-data.biaya.selisihCadangan)} kurang dari belanja`}{" "}
                  ({data.biaya.pembelianBahan} pembelian tercatat)
                </p>
              </Card>

              <div className="grid gap-3">
                <Card>
                  <div className="text-xs font-medium text-ink-2">Belum cair</div>
                  <div className="mt-1.5 text-2xl font-semibold text-ink tabular-nums">
                    {data.belumCair.paket}
                  </div>
                  <p className="mt-1 text-xs text-ink-3">
                    paket sudah dikirim, pesanannya belum muncul di laporan mana pun
                  </p>
                  {data.belumCair.paket > 0 && (
                    <p className="mt-1 text-xs text-ink-3">
                      tertua {data.belumCair.umurTertua} hari · rata-rata{" "}
                      {data.belumCair.umurRata.toFixed(0)} hari
                    </p>
                  )}
                </Card>
                <Card>
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-xs font-medium text-ink-2">Bahan baku menipis</div>
                    <Link to="/bom" className="text-xs text-brand-ink">
                      Lihat
                    </Link>
                  </div>
                  <div className="mt-1.5 text-2xl font-semibold text-ink tabular-nums">
                    {data.stokMenipis.total}
                  </div>
                  {data.stokMenipis.teratas.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {data.stokMenipis.teratas.map((m) => (
                        <li key={m.id} className="text-xs text-ink-3">
                          {m.nama}{" "}
                          <span className="tabular-nums">
                            {m.stok.toLocaleString("id-ID")} {m.satuan ?? ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            </div>

            {/* ── dua deret, satu sumbu waktu, DUA grafik ──────────────── */}
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <Card padded={false}>
                <CardHeader title="Uang masuk per hari" subtitle="Pencairan yang tercatat" />
                <div className="px-3 pb-2">
                  <Deret
                    titik={data.seri}
                    ambil={(t) => t.kredit}
                    warna={WARNA.sellerBersih}
                    format={(n) => (n >= 1000 ? ringkas(n) : String(Math.round(n)))}
                  />
                </div>
              </Card>
              <Card padded={false}>
                <CardHeader
                  title="Paket terkirim per hari"
                  subtitle="Resi yang discan dan diserahkan ke kurir"
                />
                <div className="px-3 pb-2">
                  <Deret
                    titik={data.seri}
                    ambil={(t) => t.paket}
                    warna={WARNA.subSeller}
                    format={(n) => String(Math.round(n))}
                  />
                </div>
              </Card>
            </div>

            {/* ── ke mana uang pergi ──────────────────────────────────── */}
            <Card className="mt-3" padded={false}>
              <CardHeader
                title="Ke mana uang itu pergi"
                subtitle={`Dari ${rupiah(data.uang.kredit)} yang cair`}
                action={
                  <Button size="sm" variant="outline" onClick={() => setTabelKomposisi((v) => !v)}>
                    {tabelKomposisi ? "Lihat grafik" : "Lihat tabel"}
                  </Button>
                }
              />
              <div className="px-5 pb-5">
                {!tabelKomposisi ? (
                  <>
                    <div className="flex h-7 w-full gap-[2px] overflow-hidden rounded-md">
                      {komposisi.map((k) => (
                        <div
                          key={k.key}
                          title={`${k.label}: ${rupiah(k.nilai)}`}
                          style={{
                            width: `${(k.nilai / totalKomposisi) * 100}%`,
                            background: k.warna,
                          }}
                        />
                      ))}
                    </div>
                    {/* Legenda berlabel nilai. Wajib: dua dari empat warna ini
                        di bawah kontras 3:1 pada latar putih, jadi identitas
                        tidak boleh dibawa warna saja. */}
                    <div className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                      {komposisi.map((k) => (
                        <div key={k.key} className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-sm"
                            style={{ background: k.warna }}
                          />
                          <span className="flex-1 truncate text-sm text-ink">{k.label}</span>
                          <span className="text-sm text-ink tabular-nums">{rupiah(k.nilai)}</span>
                          <span className="w-10 text-right text-xs text-ink-3 tabular-nums">
                            {((k.nilai / totalKomposisi) * 100).toFixed(0)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs text-ink-3">
                        <th className="py-2">Bagian</th>
                        <th className="py-2 text-right">Nominal</th>
                        <th className="py-2 text-right">Porsi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {komposisi.map((k) => (
                        <tr key={k.key} className="border-b border-line">
                          <td className="py-2 text-ink">{k.label}</td>
                          <td className="py-2 text-right text-ink tabular-nums">{rupiah(k.nilai)}</td>
                          <td className="py-2 text-right text-ink-3 tabular-nums">
                            {((k.nilai / totalKomposisi) * 100).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                      <tr>
                        <td className="py-2 font-medium text-ink">Total</td>
                        <td className="py-2 text-right font-medium text-ink tabular-nums">
                          {rupiah(totalKomposisi)}
                        </td>
                        <td className="py-2 text-right text-ink-3">100%</td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>
            </Card>

            {/* ── siapa yang menopang ─────────────────────────────────── */}
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <Card padded={false}>
                <CardHeader title="Kontribusi tiap toko" subtitle="Uang yang cair pada periode ini" action={<Link to="/laporan-bagian" className="text-xs text-brand-ink hover:underline whitespace-nowrap">Laba & komisi per bagian →</Link>} />
                <Batang
                  baris={data.toko.map((s) => ({
                    id: s.id,
                    label: s.nama,
                    sub: `${s.paket} paket`,
                    nilai: s.kredit,
                    teks: rupiah(s.kredit),
                  }))}
                />
              </Card>
              <Card padded={false}>
                <CardHeader title="Produk paling banyak keluar" subtitle="Dihitung dari isi paket" />
                <Batang
                  baris={data.produk.map((p) => ({
                    id: p.id,
                    label: p.nama,
                    sub: `${p.paket} paket`,
                    nilai: p.pcs,
                    teks: `${p.pcs} pcs`,
                  }))}
                />
              </Card>
            </div>

            {/* ── tindakan & keandalan ────────────────────────────────── */}
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <Card padded={false}>
                <CardHeader
                  title="Perlu dikerjakan"
                  subtitle={`${data.tindakan.total} hal, ${data.tindakan.tinggi} berdampak ke angka di atas`}
                />
                <div className="px-5 pb-4">
                  {data.tindakan.tugas.length === 0 && (
                    <p className="py-3 text-sm text-ink-3">Tidak ada yang menggantung.</p>
                  )}
                  {data.tindakan.tugas.map((t) => (
                    <Link
                      key={t.key}
                      to={t.href}
                      className="flex items-center gap-3 rounded-lg py-2.5 transition hover:bg-canvas"
                    >
                      {/* Ikon + kata, tidak pernah warna saja. Warna diberikan
                          lewat pembungkus karena Icon memakai currentColor. */}
                      <span
                        style={{
                          color: t.severity === "high" ? WARNA.kritis : WARNA.serius,
                          display: "inline-flex",
                        }}
                      >
                        <Icon name={t.severity === "high" ? "warning" : "info"} size={16} />
                      </span>
                      <span className="flex-1 text-sm text-ink">{t.title}</span>
                      <span className="text-sm text-ink tabular-nums">{t.count}</span>
                    </Link>
                  ))}
                </div>
              </Card>

              <Card padded={false}>
                <CardHeader
                  title="Seberapa boleh angka ini dipercaya"
                  subtitle={`Dari ${data.keandalan.scan} resi pada periode ini`}
                />
                <div className="px-5 pb-4">
                  <Meter
                    label="Resi yang tahu tokonya"
                    nilai={data.keandalan.berToko}
                    dari={data.keandalan.scan}
                    persen={data.keandalan.persenToko}
                    catatan="Yang tidak tahu tokonya tidak masuk hitungan per toko di atas."
                  />
                  <Meter
                    label="Resi yang order id-nya terbaca"
                    nilai={data.keandalan.berOrderId}
                    dari={data.keandalan.scan}
                    persen={data.keandalan.persenOrderId}
                    catatan="Kunci untuk mencocokkan dengan laporan marketplace di Audit Pesanan."
                  />
                  <Meter
                    label="Paket yang isinya sudah dipastikan"
                    nilai={data.keandalan.isiPasti}
                    dari={data.keandalan.scan}
                    persen={data.keandalan.persenIsi}
                    catatan="Menentukan benar-tidaknya angka produk dan pemakaian bahan baku."
                  />
                </div>
              </Card>
            </div>

            <p className="mt-4 text-xs text-ink-3">
              Dashboard lama masih ada dan tidak berubah. Halaman ini memakai
              sumber angka yang berbeda: pencairan dan scan resi, bukan tabel order.
            </p>
          </>
        )}
      </div>
      <div className="mt-4">
        <SaranAi path="/dashboard/v2/saran" keterangan="Membaca seluruh angka pada rentang tanggal yang sedang dipilih." />
      </div>
    </Layout>
  );
}

interface MasterOpt {
  id: string;
  sku: string;
  name: string;
}
interface TodayProd {
  skuId: string;
  nama: string;
  varian?: string;
  masterId?: string | null;
  productId: string | null;
  qty: number;
  mapped: boolean;
  masterName: string | null;
  profitBersih: number | null;
}
interface TodayResp {
  total: number;
  belum: number;
  produk: TodayProd[];
}

/**
 * Kartu "Produk terjual hari ini": tiap produk yang laku hari ini. Kalau sudah
 * dikenali ke master -> tampilkan profit bersihnya; kalau belum -> minta user
 * memetakannya (dropdown master + Petakan) agar profitnya ikut terhitung.
 */
function ProdukTerjualHariIni({ from, to }: { from: string; to: string }) {
  const data = useFetch<TodayResp>(`/orders/today-products?date=${from}&to=${to}`);
  const masters = useFetch<MasterOpt[]>("/master-postings/master-products");
  const toast = useToast();
  const [sel, setSel] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Set<string>>(new Set());

  if (data.loading || !data.data || data.data.total === 0) return null;

  async function petakan(skuId: string) {
    const mid = sel[skuId];
    if (!mid) return;
    setBusy(skuId);
    try {
      await api.post("/products/variants/link", { skuId, masterId: mid });
      toast("Mapping disimpan — profit produk ini ikut terhitung", "success");
      setEditing((st) => {
        const ns = new Set(st);
        ns.delete(skuId);
        return ns;
      });
      await data.reload();
    } catch (e) {
      toast((e as Error).message || "Gagal memetakan", "danger");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="mb-4">
      <CardHeader
        title={`Produk terjual ${from === to ? (from === todayJak() ? "hari ini" : from) : `${from} s/d ${to}`} (${data.data.total})`}
        subtitle={
          data.data.belum > 0
            ? `${data.data.belum} produk belum dipetakan — petakan agar profit bersihnya ikut terhitung.`
            : "Semua produk hari ini sudah dipetakan; profit bersihnya terhitung."
        }
      />
      <div className="divide-y divide-line">
        {data.data.produk.map((p) => (
          <div key={p.skuId} className="flex flex-wrap items-center gap-2 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-ink" title={p.nama}>{p.nama}</div>
              <div className="text-[11px] text-ink-3">
                {p.qty}x terjual{p.varian ? ` · varian: ${p.varian}` : ""}
                {p.masterName ? ` · ${p.masterName}` : ""}
              </div>
            </div>
            {p.mapped && !editing.has(p.skuId) ? (
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs font-semibold tabular-nums ${
                    (p.profitBersih ?? 0) < 0 ? "text-red-600" : "text-emerald-700"
                  }`}
                  title="Estimasi profit bersih (logika menu HPP)."
                >
                  {p.profitBersih != null ? `profit ${rupiah(p.profitBersih)}` : "profit —"}
                </span>
                <Button
                  size="sm"
                  variant="text"
                  onClick={() => {
                    setEditing((st) => new Set(st).add(p.skuId));
                    setSel((st) => ({ ...st, [p.skuId]: p.masterId ?? "" }));
                  }}
                >
                  Ubah
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Select
                  className="w-auto min-w-[190px]"
                  value={sel[p.skuId] ?? ""}
                  onChange={(e) => setSel((st) => ({ ...st, [p.skuId]: e.target.value }))}
                >
                  <option value="">Pilih master…</option>
                  {(masters.data ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.sku})
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  icon="link"
                  loading={busy === p.skuId}
                  disabled={!sel[p.skuId]}
                  onClick={() => petakan(p.skuId)}
                >
                  {p.mapped ? "Simpan" : "Petakan"}
                </Button>
                {p.mapped && (
                  <Button
                    size="sm"
                    variant="text"
                    disabled={busy === p.skuId}
                    onClick={() =>
                      setEditing((st) => {
                        const ns = new Set(st);
                        ns.delete(p.skuId);
                        return ns;
                      })
                    }
                  >
                    Batal
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}


interface SalesByDate {
  tanggal?: string;
  pesanan: number;
  nominal: number;
  profitBersih: number | null;
  perToko: { shopId: string | null; nama: string; pesanan: number; nominal: number; profit?: number | null }[];
  perMaster?: { nama: string; nominal: number; qty: number; profit: number }[];
}
interface TimelineResp {
  tanggal?: string;
  hariIni: number[];
  profitHariIni?: number[];
  rataBulan: number[];
  puncakBulan: number;
  activeDays: number;
}
interface OrderLite {
  id: string;
  marketplaceOrderId: string;
  buyerName: string | null;
  totalAmount: string | null;
  estPencairan?: string | null;
  fulfillmentStatus: string;
  items?: { name?: string; masterName?: string | null; qty?: number }[] | null;
}
function todayJak(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}
/** Rupiah ringkas: 45rb, 1,2jt. */
function rpShort(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1_000_000) return sign + (a / 1_000_000).toFixed(1).replace(".0", "") + "jt";
  if (a >= 1_000) return sign + Math.round(a / 1_000) + "rb";
  return String(Math.round(v));
}

/** Pesanan satu toko pada tanggal terpilih (lazy saat baris toko di-expand). */
function ShopOrders({ shopId, from, to }: { shopId: string; from: string; to: string }) {
  const start = new Date(`${from}T00:00:00+07:00`);
  const end = new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 24 * 3600 * 1000);
  const orders = useFetch<OrderLite[]>(
    `/orders?shopId=${shopId}&dateFrom=${encodeURIComponent(start.toISOString())}&dateTo=${encodeURIComponent(end.toISOString())}&limit=300`,
  );
  if (orders.loading) return <div className="pb-2 pl-5 text-[11px] text-ink-3">Memuat pesanan…</div>;
  const list = orders.data ?? [];
  if (!list.length) return <div className="pb-2 pl-5 text-[11px] text-ink-3">Tak ada pesanan pada tanggal ini.</div>;
  return (
    <div className="space-y-1 pb-2 pl-5">
      {list.map((o) => (
        <div key={o.id} className="flex items-center justify-between gap-2 text-[11px]">
          <span className="truncate text-ink-2">
            #{o.marketplaceOrderId} · {o.buyerName ?? "—"}
            {Array.isArray(o.items) && o.items.length > 0 && (
              <span className="text-ink-3">
                {" · "}
                {o.items
                  .map((it) => `${it.masterName ?? it.name ?? ""}${it.qty ? ` x${it.qty}` : ""}`)
                  .join(", ")
                  .slice(0, 60)}
              </span>
            )}
          </span>
          <span className="whitespace-nowrap tabular-nums text-right">
            <span className="text-ink">{o.totalAmount != null ? rupiah(o.totalAmount) : "—"}</span>
            {o.estPencairan != null && (
              <span className={`ml-2 ${Number(o.estPencairan) < 0 ? "text-red-600" : "text-emerald-700"}`}>
                profit {rupiah(o.estPencairan)}
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Kartu Penjualan: bisa pilih tanggal lain + expand pesanan per toko. */
interface BucketResp {
  granularity: "day" | "month";
  from?: string;
  to?: string;
  buckets: { key: string; label: string; pesanan: number; nominal: number; profit: number; compare?: number }[];
  busiestDay?: { label: string; pesanan: number; nominal: number } | null;
}
function deltaPct(cur: number, prev: number | null | undefined): number | null {
  if (prev == null) return null;
  if (prev === 0) return cur > 0 ? 100 : 0;
  return Math.round(((cur - prev) / prev) * 100);
}
/** Geser tanggal YYYY-MM-DD (WIB) sebanyak n hari. */
function shiftDays(dateStr: string, n: number): string {
  const base = new Date(`${dateStr}T00:00:00+07:00`).getTime() + n * 86400000;
  return new Date(base + 7 * 3600 * 1000).toISOString().slice(0, 10);
}
function Kpi({ label, value, pct, tone, cmp }: { label: string; value: string; pct: number | null; tone?: "profit"; cmp?: string }) {
  const up = (pct ?? 0) >= 0;
  const lbl = cmp ?? "vs kemarin";
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-ink-3">{label}</div>
      <div className={`mt-0.5 text-base font-semibold tabular-nums sm:text-lg ${tone === "profit" ? "text-emerald-700" : "text-ink"}`}>{value}</div>
      <div className="mt-0.5 text-[10px]">
        {pct == null ? (
          <span className="text-ink-3">{lbl}: —</span>
        ) : (
          <span className={up ? "text-emerald-700" : "text-red-600"}>
            {up ? "▲" : "▼"} {Math.abs(pct)}% <span className="text-ink-3">{lbl}</span>
          </span>
        )}
      </div>
    </div>
  );
}
function PenjualanHarian({
  from,
  to,
  setFrom,
  setTo,
}: {
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
}) {
  const sameDay = from === to;
  const sales = useFetch<SalesByDate>(`/dashboard/sales-range?from=${from}&to=${to}`);
  const timeline = useFetch<TimelineResp>(sameDay ? `/dashboard/sales-timeline?date=${from}` : null);
  const buckets = useFetch<BucketResp>(sameDay ? null : `/dashboard/sales-buckets?from=${from}&to=${to}`);
  const lenDays =
    Math.round(
      (new Date(`${to}T00:00:00+07:00`).getTime() - new Date(`${from}T00:00:00+07:00`).getTime()) / 86400000,
    ) + 1;
  const prevTo = shiftDays(from, -1);
  const prevFrom = shiftDays(prevTo, -(lenDays - 1));
  const prev = useFetch<SalesByDate>(`/dashboard/sales-range?from=${prevFrom}&to=${prevTo}`);
  const [expand, setExpand] = useState<string | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(true);
  const d = sales.data;
  const p = prev.data;
  const T = todayJak();
  const rugi = (d?.perMaster ?? []).filter((m) => m.profit < 0);
  const sepi = (() => {
    if (!sameDay) return [] as number[];
    const tl = timeline.data;
    if (!tl) return [] as number[];
    const cand: { h: number; v: number }[] = [];
    for (let h = 8; h <= 21; h++) cand.push({ h, v: tl.rataBulan?.[h] ?? 0 });
    cand.sort((a, b) => a.v - b.v);
    return cand.slice(0, 2).map((c) => c.h);
  })();
  const pad2 = (h: number) => String(h).padStart(2, "0");
  const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  function exportCsv() {
    if (!d) return;
    const rows: string[] = [];
    rows.push(`Ringkasan Penjualan,${from} s/d ${to}`);
    rows.push("");
    rows.push("Metrik,Nilai");
    rows.push(`Pesanan,${d.pesanan}`);
    rows.push(`Omzet,${d.nominal}`);
    rows.push(`Profit bersih,${d.profitBersih ?? 0}`);
    rows.push("");
    rows.push("Toko,Pesanan,Omzet,Profit");
    for (const t of d.perToko) rows.push(`${csv(t.nama)},${t.pesanan},${t.nominal},${t.profit ?? ""}`);
    rows.push("");
    rows.push("Master Produk,Qty,Omzet,Profit");
    for (const m of d.perMaster ?? []) rows.push(`${csv(m.nama)},${m.qty},${m.nominal},${m.profit}`);
    const blob = new Blob(["\ufeff" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `penjualan-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const presets: { label: string; from: string; to: string }[] = [
    { label: "Hari ini", from: T, to: T },
    { label: "7 hari", from: shiftDays(T, -6), to: T },
    { label: "30 hari", from: shiftDays(T, -29), to: T },
    { label: "3 bulan", from: shiftDays(T, -89), to: T },
    { label: "6 bulan", from: shiftDays(T, -179), to: T },
    { label: "12 bulan", from: shiftDays(T, -364), to: T },
  ];
  const judul = sameDay ? (from === T ? "Penjualan hari ini" : `Penjualan ${from}`) : `Penjualan ${from} s/d ${to}`;
  const cmpLabel = sameDay ? "vs kemarin" : "vs periode sblm";
  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium text-ink">{judul}</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {presets.map((ps) => {
            const active = ps.from === from && ps.to === to;
            return (
              <button
                key={ps.label}
                type="button"
                onClick={() => {
                  setFrom(ps.from);
                  setTo(ps.to);
                  setExpand(null);
                }}
                className={`rounded-md px-2 py-0.5 text-[11px] ${active ? "bg-brand text-white" : "border border-line text-ink-2 hover:bg-canvas"}`}
              >
                {ps.label}
              </button>
            );
          })}
          {d && (
            <button
              type="button"
              onClick={exportCsv}
              className="rounded-md border border-line px-2 py-0.5 text-[11px] text-ink-2 hover:bg-canvas"
              title="Ekspor ringkasan rentang ini ke CSV"
            >
              CSV
            </button>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
        <input
          type="date"
          value={from}
          max={to}
          onChange={(e) => {
            const v = e.target.value || T;
            setFrom(v);
            if (v > to) setTo(v);
            setExpand(null);
          }}
          className="rounded-md border border-line px-2 py-1"
        />
        <span>s/d</span>
        <input
          type="date"
          value={to}
          min={from}
          max={T}
          onChange={(e) => {
            setTo(e.target.value || T);
            setExpand(null);
          }}
          className="rounded-md border border-line px-2 py-1"
        />
      </div>
      {sales.loading || !d ? (
        <div className="mt-3 text-sm text-ink-3">Memuat…</div>
      ) : (
        <>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Kpi label="Omzet" value={rupiah(d.nominal)} pct={deltaPct(d.nominal, p?.nominal)} cmp={cmpLabel} />
            <Kpi label="Pesanan" value={String(d.pesanan)} pct={deltaPct(d.pesanan, p?.pesanan)} cmp={cmpLabel} />
            <Kpi
              label="Profit bersih"
              value={rupiah(d.profitBersih ?? 0)}
              pct={deltaPct(d.profitBersih ?? 0, p?.profitBersih ?? null)}
              tone="profit"
              cmp={cmpLabel}
            />
          </div>
          {rugi.length > 0 && (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50/60 px-3 py-2 text-[11px] text-red-700">
              ⚠ {rugi.length} produk RUGI (di bawah HPP):{" "}
              {rugi
                .slice(0, 3)
                .map((m) => `${m.nama} (${rupiah(m.profit)})`)
                .join(", ")}
              {rugi.length > 3 ? ` +${rugi.length - 3} lagi` : ""}
            </div>
          )}
          {sepi.length > 0 && (
            <div className="mt-2 text-[11px] text-ink-3">
              💡 Jam sepi (kandidat promo/flash sale):{" "}
              <b className="text-ink-2">{sepi.map((h) => pad2(h) + ".00").join(", ")}</b>
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowAnalytics((v) => !v)}
            className="mt-3 flex items-center gap-1 text-[11px] font-medium text-brand-ink"
          >
            <Icon name="chevronDown" size={12} className={showAnalytics ? "" : "-rotate-90"} />
            {showAnalytics ? "Sembunyikan analitik" : "Tampilkan analitik"}
          </button>
          {showAnalytics && (
            <>
              {sameDay ? (
                timeline.data && (
                  <div className="mt-2 border-t border-line pt-3">
                    <TimelineChart data={timeline.data} />
                  </div>
                )
              ) : buckets.data ? (
                <div className="mt-2 border-t border-line pt-3">
                  <BucketChart data={buckets.data} />
                </div>
              ) : (
                <div className="mt-2 border-t border-line pt-3 text-sm text-ink-3">Memuat grafik…</div>
              )}
              {(d.perToko.length > 0 || (d.perMaster?.length ?? 0) > 0) && (
                <div className="mt-3 flex flex-wrap gap-6 border-t border-line pt-3">
                  <KomposisiPie title="Komposisi penjualan per toko" rows={d.perToko} />
                  <KomposisiPie title="Komposisi penjualan per master produk" rows={d.perMaster ?? []} />
                </div>
              )}
              <ProfitRanking rows={d.perMaster ?? []} />
              {d.perToko.length === 0 ? (
                <div className="mt-3 text-xs text-ink-3">Belum ada pesanan pada rentang ini.</div>
              ) : (
                <div className="mt-3 border-t border-line pt-2">
                  <div className="mb-1 text-[11px] font-medium text-ink-3">Rincian per toko (klik untuk lihat pesanan)</div>
                  {d.perToko.map((t) => {
                    const key = t.shopId ?? t.nama;
                    const open = expand === key;
                    return (
                      <div key={key} className="border-b border-line last:border-0">
                        <button
                          type="button"
                          onClick={() => setExpand(open ? null : key)}
                          className="flex w-full items-center justify-between gap-3 py-1.5 text-left text-xs hover:bg-canvas"
                        >
                          <span className="flex min-w-0 flex-1 items-center gap-1 text-ink-2">
                            <Icon name="chevronDown" size={12} className={`shrink-0 ${open ? "" : "-rotate-90"}`} />
                            <span className="truncate">{t.nama}</span>
                          </span>
                          <span className="shrink-0 text-right tabular-nums text-ink">
                            {t.pesanan} pesanan · {rupiah(t.nominal)}
                            {t.profit != null && <span className="text-emerald-700"> · profit {rupiah(t.profit)}</span>}
                          </span>
                        </button>
                        {open && t.shopId && <ShopOrders shopId={t.shopId} from={from} to={to} />}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </>
      )}
    </Card>
  );
}
/** Satukan rentang tanggal kartu Penjualan & Produk terjual. */
function PenjualanBlok() {
  const [from, setFrom] = useState(todayJak());
  const [to, setTo] = useState(todayJak());
  return (
    <>
      <PenjualanHarian from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <ProdukTerjualHariIni from={from} to={to} />
    </>
  );
}
/** Grafik batang per-hari / per-bulan untuk rentang lintas waktu. */
function BucketChart({ data }: { data: BucketResp }) {
  const [hover, setHover] = useState<number | null>(null);
  const b = data.buckets ?? [];
  if (!b.length) return <div className="text-[11px] text-ink-3">Tidak ada data pada rentang ini.</div>;
  const max = Math.max(1, ...b.map((x) => x.nominal), ...b.map((x) => x.compare ?? 0));
  const scaleMax = max * 1.14;
  const W = 480;
  const H = 158;
  const padL = 8;
  const padR = 8;
  const padT = 24;
  const padB = 20;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const bw = plotW / b.length;
  const bx = (i: number) => padL + i * bw;
  const totalNominal = b.reduce((a, x) => a + x.nominal, 0);
  const totalProfit = b.reduce((a, x) => a + x.profit, 0);
  const totalPesanan = b.reduce((a, x) => a + x.pesanan, 0);
  let bestI = 0;
  for (let i = 1; i < b.length; i++) if ((b[i]?.profit ?? 0) > (b[bestI]?.profit ?? 0)) bestI = i;
  const sel = hover ?? bestI;
  const cur = b[sel];
  const showLabels = b.length <= 16;
  const labelEvery = Math.max(1, Math.ceil(b.length / 12));
  const hasCompare = b.some((x) => (x.compare ?? 0) > 0);
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-medium text-ink-3">Penjualan per {data.granularity === "day" ? "hari" : "bulan"}</div>
        <div className="flex items-center gap-3 text-[10px] text-ink-3">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2 rounded-sm" style={{ background: "linear-gradient(#5a9be6,#2a78d6)" }} /> Omzet
          </span>
          {data.granularity === "day" && (
            <span className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-3" style={{ background: "#eb6834" }} /> Biasanya / hari (4 mgg)
            </span>
          )}
          <span className="text-emerald-700">profit bersih (angka di atas bar)</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none" onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="bkBar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5a9be6" />
            <stop offset="100%" stopColor="#2a78d6" />
          </linearGradient>
          <linearGradient id="bkBarHi" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8fc0f5" />
            <stop offset="100%" stopColor="#1e63b8" />
          </linearGradient>
        </defs>
        {[0.5, 1].map((f, k) => (
          <line
            key={k}
            x1={padL}
            y1={padT + plotH - f * plotH}
            x2={W - padR}
            y2={padT + plotH - f * plotH}
            stroke="currentColor"
            className="text-line"
            strokeWidth="1"
            strokeDasharray="2 3"
            opacity="0.6"
          />
        ))}
        {b.map((x, i) => {
          const h = (x.nominal / scaleMax) * plotH;
          const top = padT + plotH - h;
          const on = i === sel;
          return (
            <g key={i}>
              <rect x={bx(i) + bw * 0.16} y={top} width={bw * 0.68} height={Math.max(0, h)} rx="1.5" fill={on ? "url(#bkBarHi)" : "url(#bkBar)"} />
              {showLabels && x.nominal > 0 && (
                <text x={bx(i) + bw / 2} y={top - 2.5} textAnchor="middle" style={{ fontSize: "6.5px" }} fill={x.profit < 0 ? "#dc2626" : "#059669"}>
                  {rpShort(x.profit)}
                </text>
              )}
            </g>
          );
        })}
        <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke="currentColor" className="text-line" strokeWidth="1" />
        {hasCompare && (
          <polyline
            points={b
              .map(
                (x, i) =>
                  `${(bx(i) + bw / 2).toFixed(1)},${(padT + plotH - Math.min(plotH, ((x.compare ?? 0) / scaleMax) * plotH)).toFixed(1)}`,
              )
              .join(" ")}
            fill="none"
            stroke="#eb6834"
            strokeWidth="1.5"
            strokeLinejoin="round"
            opacity="0.9"
          />
        )}
        {b.map((x, i) =>
          i % labelEvery === 0 || i === b.length - 1 ? (
            <text key={i} x={bx(i) + bw / 2} y={H - 6} textAnchor="middle" className="fill-current text-ink-3" style={{ fontSize: "7px" }}>
              {x.label}
            </text>
          ) : null,
        )}
        {b.map((_, i) => (
          <rect key={i} x={bx(i)} y={padT} width={bw} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      <div className="mt-1.5 text-[11px]">
        {hover == null ? (
          <div className="text-ink-2">
            Total: <b className="text-ink tabular-nums">{totalPesanan}</b> pesanan · <b className="text-ink">{rupiah(totalNominal)}</b> omzet ·{" "}
            <span className={`font-semibold ${totalProfit < 0 ? "text-red-600" : "text-emerald-700"}`}>profit {rupiah(totalProfit)}</span>
            <span className="text-ink-3">
              {" "}· ter-untung: {cur?.label}
              {data.busiestDay ? ` · hari teramai: ${data.busiestDay.label} (~${data.busiestDay.pesanan} pesanan)` : ""}
            </span>
          </div>
        ) : (
          <div className="text-ink-2">
            <b className="text-ink">{cur?.label}</b> · {cur?.pesanan} pesanan · {rupiah(cur?.nominal ?? 0)} ·{" "}
            <span className={`font-semibold ${(cur?.profit ?? 0) < 0 ? "text-red-600" : "text-emerald-700"}`}>profit {rupiah(cur?.profit ?? 0)}</span>
            {cur?.compare ? <span className="text-ink-3"> · biasanya hari ini {rupiah(cur.compare)}</span> : null}
          </div>
        )}
      </div>
    </div>
  );
}

const PIE_COLORS = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#9b5de5",
  "#ef476f",
  "#06d6a0",
  "#118ab2",
];

/** Grafik komposisi (donut) proporsional per entri (nominal) + legenda nilai & %. */
function KomposisiPie({ title, rows }: { title: string; rows: { nama: string; nominal: number }[] }) {
  const sorted = rows.filter((r) => r.nominal > 0).sort((a, b) => b.nominal - a.nominal);
  if (!sorted.length) return null;
  // Gabung sisanya jadi "Lainnya" supaya donut tak terlalu ramai.
  const top = sorted.slice(0, 7);
  const sisa = sorted.slice(7);
  const data =
    sisa.length > 0
      ? [...top, { nama: "Lainnya", nominal: sisa.reduce((a, r) => a + r.nominal, 0) }]
      : top;
  const total = data.reduce((a, r) => a + r.nominal, 0) || 1;
  const C = 2 * Math.PI * 42;
  let acc = 0;
  return (
    <div className="min-w-[220px] flex-1">
      <div className="mb-2 text-[11px] font-medium text-ink-3">
        {title} <span className="text-ink-2">· {rupiah(total)}</span>
      </div>
      <div className="flex items-center gap-3">
        <svg viewBox="0 0 100 100" className="h-24 w-24 shrink-0 -rotate-90" role="img" aria-label={title}>
          {data.map((r, i) => {
            const frac = r.nominal / total;
            const dash = Math.max(0, frac * C - 1.2); // 1.2 gap antar segmen
            const seg = (
              <circle
                key={i}
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke={PIE_COLORS[i % PIE_COLORS.length]}
                strokeWidth="15"
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={-acc * C}
              />
            );
            acc += frac;
            return seg;
          })}
        </svg>
        <div className="min-w-0 flex-1 space-y-0.5">
          {data.map((r, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11px]">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
              />
              <span className="truncate text-ink-2" title={r.nama}>
                {r.nama}
              </span>
              <span className="ml-auto whitespace-nowrap tabular-nums text-ink-3">
                {rupiah(r.nominal)} · {Math.round((r.nominal / total) * 100)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Grafik timeline pesanan per jam (0-23 WIB) — interaktif: bar hari terpilih
 *  (hover tampilkan pesanan + profit bersih HPP) + area rata-rata bulan. */
function TimelineChart({ data }: { data: TimelineResp }) {
  const [hover, setHover] = useState<number | null>(null);
  const hari = data.hariIni ?? [];
  const profit = data.profitHariIni ?? [];
  const bulan = data.rataBulan ?? [];
  const max = Math.max(1, ...hari, ...bulan);
  const scaleMax = max * 1.12;
  const W = 480;
  const H = 150;
  const padL = 20;
  const padR = 8;
  const padT = 26;
  const padB = 20;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const bw = plotW / 24;
  const x = (i: number) => padL + i * bw;
  const yv = (v: number) => padT + plotH - (v / scaleMax) * plotH;
  const cx = (i: number) => x(i) + bw / 2;
  const areaLine = bulan.map((v, i) => `${cx(i).toFixed(1)},${yv(v).toFixed(1)}`).join(" L ");
  const area = `M ${cx(0).toFixed(1)},${(padT + plotH).toFixed(1)} L ${areaLine} L ${cx(23).toFixed(1)},${(padT + plotH).toFixed(1)} Z`;
  const sel = hover ?? data.puncakBulan;
  const jam2 = (h: number) => String(h).padStart(2, "0");
  const gridLines = [0.5, 1];
  const totalProfit = profit.reduce((a, b) => a + b, 0);
  const totalPesanan = hari.reduce((a, b) => a + b, 0);
  const isToday = (data.tanggal ?? "") === todayJak();
  const nowWib = new Date(Date.now() + 7 * 3600 * 1000);
  const nowFrac = nowWib.getUTCHours() + nowWib.getUTCMinutes() / 60;
  const curHour = Math.min(23, Math.floor(nowFrac));
  const todayCum = hari.slice(0, curHour + 1).reduce((a, b) => a + b, 0);
  const avgCum = bulan.slice(0, curHour + 1).reduce((a, b) => a + b, 0);
  const pacePct = avgCum > 0 ? Math.round((todayCum / avgCum - 1) * 100) : null;
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-medium text-ink-3">Timeline pesanan per jam</div>
        <div className="flex items-center gap-3 text-[10px] text-ink-3">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2 rounded-sm bg-gradient-to-b from-[#4f93e0] to-[#2a78d6]" /> Hari ini
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 bg-[#eb6834]" /> Rata² bulan ini
          </span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full select-none"
        role="img"
        aria-label="Timeline pesanan per jam"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="tlBar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5a9be6" />
            <stop offset="100%" stopColor="#2a78d6" />
          </linearGradient>
          <linearGradient id="tlBarHi" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8fc0f5" />
            <stop offset="100%" stopColor="#1e63b8" />
          </linearGradient>
        </defs>
        {gridLines.map((f, k) => (
          <line
            key={k}
            x1={padL}
            y1={padT + plotH - f * plotH}
            x2={W - padR}
            y2={padT + plotH - f * plotH}
            stroke="currentColor"
            className="text-line"
            strokeWidth="1"
            strokeDasharray="2 3"
            opacity="0.6"
          />
        ))}
        {/* highlight kolom terpilih */}
        <rect x={x(sel)} y={padT} width={bw} height={plotH} rx="2" className="fill-current text-canvas" opacity="0.8" />
        {/* area + garis rata-rata bulan */}
        <path d={area} fill="#eb6834" opacity="0.12" />
        <polyline points={bulan.map((v, i) => `${cx(i).toFixed(1)},${yv(v).toFixed(1)}`).join(" ")} fill="none" stroke="#eb6834" strokeWidth="1.5" strokeLinejoin="round" />
        {/* bars hari ini */}
        {hari.map((v, i) => {
          const h = (v / scaleMax) * plotH;
          const on = i === sel;
          return (
            <rect
              key={i}
              x={x(i) + bw * 0.16}
              y={padT + plotH - h}
              width={bw * 0.68}
              height={Math.max(0, h)}
              rx="1.5"
              fill={on ? "url(#tlBarHi)" : "url(#tlBar)"}
            />
          );
        })}
        {hari.map((v, i) => {
          if (v <= 0) return null;
          const top = padT + plotH - (v / scaleMax) * plotH;
          return (
            <g key={`lbl${i}`}>
              <text x={cx(i)} y={top - 9} textAnchor="middle" className="fill-current text-ink-2" style={{ fontSize: "7px", fontWeight: 600 }}>
                {v}
              </text>
              <text x={cx(i)} y={top - 2.5} textAnchor="middle" style={{ fontSize: "6.5px" }} fill={(profit[i] ?? 0) < 0 ? "#dc2626" : "#059669"}>
                {rpShort(profit[i] ?? 0)}
              </text>
            </g>
          );
        })}
        <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke="currentColor" className="text-line" strokeWidth="1" />
        {[0, 3, 6, 9, 12, 15, 18, 21, 23].map((hh) => (
          <text key={hh} x={cx(hh)} y={H - 5} textAnchor="middle" className="fill-current text-ink-3" style={{ fontSize: "8px" }}>
            {hh}
          </text>
        ))}
        {/* hover capture per jam */}
        {hari.map((_, i) => (
          <rect key={i} x={x(i)} y={padT} width={bw} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
        {isToday && (
          <g pointerEvents="none">
            <line
              x1={padL + nowFrac * bw}
              y1={padT - 5}
              x2={padL + nowFrac * bw}
              y2={padT + plotH}
              stroke="currentColor"
              className="text-ink-2"
              strokeWidth="1"
              strokeDasharray="3 2"
              opacity="0.7"
            />
            <text
              x={Math.max(26, Math.min(W - 2, padL + nowFrac * bw - 1))}
              y={padT - 7}
              textAnchor="end"
              className="fill-current text-ink-2"
              style={{ fontSize: "7px", fontWeight: 600 }}
            >
              sekarang
            </text>
          </g>
        )}
      </svg>
      <div className="mt-1.5 text-[11px]">
        {hover == null ? (
          <div>
            <div className="text-ink-2">
              Hari ini: <b className="text-ink tabular-nums">{totalPesanan}</b> pesanan ·{" "}
              <span className={`font-semibold tabular-nums ${totalProfit < 0 ? "text-red-600" : "text-emerald-700"}`}>
                profit {rupiah(totalProfit)}
              </span>
              <span className="text-ink-3"> · jam teramai bln {jam2(data.puncakBulan)}.00</span>
            </div>
            {isToday && pacePct != null ? (
              <div className="text-[10px] text-ink-3">
                Sampai jam {jam2(curHour)}.00: {todayCum} pesanan (biasanya ~{avgCum.toFixed(1)}) —{" "}
                <span className={pacePct >= 0 ? "font-medium text-emerald-700" : "font-medium text-amber-700"}>
                  {pacePct >= 0 ? `lebih ramai ${pacePct}%` : `lebih sepi ${Math.abs(pacePct)}%`}
                </span>{" "}
                dari rata-rata bulan ini
              </div>
            ) : (
              <div className="text-[10px] text-ink-3">Arahkan kursor ke bar untuk rincian per jam.</div>
            )}
          </div>
        ) : (
          <div className="text-ink-2">
            <b className="text-ink">{jam2(sel)}.00</b> · {hari[sel] ?? 0} pesanan ·{" "}
            <span className={`font-semibold tabular-nums ${(profit[sel] ?? 0) < 0 ? "text-red-600" : "text-emerald-700"}`}>
              profit {rupiah(profit[sel] ?? 0)}
            </span>
            <span className="text-ink-3"> · rata² bln {data.rataBulan?.[sel] ?? 0} pesanan/jam</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Grafik produk paling menguntungkan (profit bersih dari HPP), bar horizontal. */
function ProfitRanking({ rows }: { rows: { nama: string; profit: number; qty?: number; nominal?: number }[] }) {
  const data = rows
    .filter((r) => r.profit !== 0)
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 6);
  if (!data.length) return null;
  const max = Math.max(1, ...data.map((r) => Math.abs(r.profit)));
  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="mb-1.5 text-[11px] font-medium text-ink-3">Produk paling menguntungkan (profit bersih)</div>
      <div className="space-y-1.5">
        {data.map((r, i) => (
          <div key={i}>
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate text-ink-2" title={r.nama}>
                {i + 1}. {r.nama}
                {r.qty ? <span className="text-ink-3"> · {r.qty} pcs</span> : null}
              </span>
              <span
                className={`whitespace-nowrap tabular-nums font-medium ${r.profit < 0 ? "text-red-600" : "text-emerald-700"}`}
              >
                {rupiah(r.profit)}
                {r.nominal && r.nominal > 0 ? (
                  <span className="font-normal text-ink-3"> · {Math.round((r.profit / r.nominal) * 100)}% margin</span>
                ) : null}
              </span>
            </div>
            <div className="mt-0.5 h-1.5 rounded-full bg-canvas">
              <div
                className={`h-1.5 rounded-full ${r.profit < 0 ? "bg-red-500" : "bg-emerald-500"}`}
                style={{ width: `${Math.max(3, (Math.abs(r.profit) / max) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
