import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";
import { api } from "../lib/api";
import { rupiah } from "../lib/fmt";
import { Icon } from "../components/Icon";
import { Button, Card, CardHeader, InlineAlert, PageHeader, Skeleton } from "../components/ui";

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
    rateEfektif: number;
    perHari: number;
    pencairan: number;
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
    <Layout title="Dashboard v2">
      <PageHeader
        title="Dashboard v2"
        subtitle="Uang yang masuk, ke mana perginya, dan seberapa boleh angkanya dipercaya."
      />

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
                <CardHeader title="Kontribusi tiap toko" subtitle="Uang yang cair pada periode ini" />
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
    </Layout>
  );
}
