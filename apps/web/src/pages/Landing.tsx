import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * Halaman depan publik (calon seller). Diposisikan BUKAN sebagai "omnichannel
 * banyak marketplace" (itu medan Jubelio/BigSeller/Ginee), melainkan untuk
 * seller yang memproduksi sendiri: untung asli per pesanan dari HPP bahan
 * baku, gudang yang tidak mengirim paket batal, dan pencairan yang langsung
 * terbagi ke reseller/sedekah. Semua klaim fitur di sini ada di produk.
 */

type IconName = "chart" | "box" | "scan" | "users" | "split" | "tag" | "alert" | "shield" | "check" | "x" | "arrow" | "menu";

function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  const p: Record<IconName, ReactNode> = {
    chart: <path d="M4 19V5m0 14h16M8 15l3-4 3 2 4-6" />,
    box: <path d="M4 8l8-4 8 4-8 4-8-4zm0 0v8l8 4 8-4V8m-8 4v8" />,
    scan: <path d="M4 8V5h3m10 0h3v3m0 8v3h-3M7 19H4v-3m3-4h10" />,
    users: <path d="M16 19v-1a4 4 0 00-8 0v1m4-8a3 3 0 100-6 3 3 0 000 6zm7 8v-1a3 3 0 00-2-2.8M17 5.2a3 3 0 010 5.6" />,
    split: <path d="M12 4v6m0 0l-6 6m6-6l6 6M6 16v4m12-4v4M12 10v10" />,
    tag: <path d="M3 12V4h8l9 9-8 8-9-9zm5-4h.01" />,
    alert: <path d="M12 9v4m0 3h.01M10.3 4.5L2.6 18a2 2 0 001.7 3h15.4a2 2 0 001.7-3L13.7 4.5a2 2 0 00-3.4 0z" />,
    shield: <path d="M12 3l7 3v6c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6l7-3zm-3 9l2 2 4-4" />,
    check: <path d="M5 12l4 4 10-10" />,
    x: <path d="M6 6l12 12M18 6L6 18" />,
    arrow: <path d="M5 12h14m-6-6l6 6-6 6" />,
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {p[name]}
    </svg>
  );
}

const PAIN = [
  {
    title: "Omzet naik, untungnya tidak kelihatan",
    desc: "Diskon, promo, potongan marketplace, dan bahan baku menggerus margin. Laporan omzet tidak bilang order mana yang sebenarnya rugi.",
  },
  {
    title: "Paket yang sudah batal tetap dikirim",
    desc: "Pembeli membatalkan saat paket sedang dikemas. Ongkir terbuang, barang tertahan, dan untungnya hilang dua kali.",
  },
  {
    title: "Bagi hasil reseller dihitung manual",
    desc: "Saat dana cair, bagian reseller, sedekah, dan dana bahan baku dihitung di spreadsheet — lambat dan rawan salah.",
  },
];

const FEATURES: { icon: IconName; title: string; desc: string }[] = [
  {
    icon: "chart",
    title: "Profit asli tiap pesanan",
    desc: "Dihitung dari harga jual yang benar-benar dibayar pembeli, dikurangi potongan marketplace, reseller, sedekah, dan HPP.",
  },
  {
    icon: "box",
    title: "HPP dari resep bahan baku",
    desc: "Isi takaran bahan per produk sekali. HPP, kebutuhan bahan, dan saran harga jual terhitung otomatis.",
  },
  {
    icon: "tag",
    title: "Peringatan harga beda dari master",
    desc: "Produk terjual di bawah harga yang Anda tetapkan langsung ditandai, lengkap dengan selisih profitnya. Satu klik untuk terapkan harga ke toko.",
  },
  {
    icon: "scan",
    title: "Aplikasi scan resi untuk gudang",
    desc: "Packer memindai resi dari HP Android. Pesanan yang sudah dibatalkan langsung ditolak dengan peringatan merah — tidak ikut terkirim.",
  },
  {
    icon: "users",
    title: "Kenali kebiasaan pembeli",
    desc: "Pembeli yang sering batal setelah barang dikirim, pelanggan setia, dan pembeli baru ditandai di setiap pesanan.",
  },
  {
    icon: "split",
    title: "Pencairan langsung terbagi",
    desc: "Dana cair dari marketplace otomatis dibagi ke reseller, sub-reseller, sedekah, dan dana bahan baku — dengan bukti transfer.",
  },
];

const STEPS = [
  { title: "Pesanan masuk", desc: "Tersinkron dari TikTok Shop lewat API resmi, lengkap dengan profit per pesanan." },
  { title: "Dikemas", desc: "Packing list per produk beserta bahannya. Cetak resi massal dalam satu batch." },
  { title: "Dikirim", desc: "Scan resi di gudang memastikan hanya pesanan aktif yang keluar." },
  { title: "Dana cair", desc: "Saldo dicocokkan dengan laporan pencairan, lalu dibagi otomatis." },
];

type Cell = boolean | string;
const COMPARE: { row: string; us: Cell; them: Cell }[] = [
  { row: "Profit bersih per pesanan dari harga jual asli", us: true, them: "Laporan laba umum" },
  { row: "HPP dihitung dari resep bahan baku", us: true, them: "Isi HPP manual" },
  { row: "Peringatan produk terjual di bawah harga master", us: true, them: false },
  { row: "Tolak paket yang sudah batal saat scan resi", us: true, them: "Sebagian" },
  { row: "Tanda pembeli berisiko batal / COD gagal", us: true, them: false },
  { row: "Pencairan terbagi ke reseller & sedekah", us: true, them: false },
  { row: "Jumlah marketplace terhubung", us: "Fokus TikTok Shop", them: "Banyak marketplace" },
  { row: "Akuntansi & kasir (POS) toko offline", us: false, them: "Tersedia di sebagian" },
];

const FAQ = [
  {
    q: "Marketplace apa saja yang didukung?",
    a: "Saat ini AutoToko terhubung ke TikTok Shop melalui API resmi. Kami sengaja fokus pada satu ekosistem agar perhitungan profit, pembatalan, dan pencairannya akurat.",
  },
  {
    q: "Bagaimana profit per pesanan dihitung?",
    a: "Harga jual yang benar-benar dibayar pembeli, dikurangi potongan marketplace, bagian reseller, sedekah, biaya iklan, dan HPP (bahan baku + packing) yang Anda atur di Master Produk.",
  },
  {
    q: "Apakah tim gudang perlu perangkat khusus?",
    a: "Tidak. Cukup HP Android. Aplikasi scan resi AutoToko membaca resi, mencatat packing, dan menolak pesanan yang sudah dibatalkan.",
  },
  {
    q: "Apakah data toko saya aman?",
    a: "Setiap akun terisolasi di tingkat database, dan token akses marketplace disimpan terenkripsi. Anda bisa memutus koneksi toko kapan saja.",
  },
  {
    q: "Berapa biayanya?",
    a: "Anda bisa mulai gratis. Paket berbayar dihitung sesuai aktivitas toko — tim kami akan menjelaskan pilihan yang paling pas setelah Anda mendaftar.",
  },
];

function CompareCell({ v, strong }: { v: Cell; strong?: boolean }) {
  if (v === true)
    return (
      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${strong ? "bg-brand text-navy" : "bg-mn-green-tint text-mn-green-ink"}`}>
        <Icon name="check" className="h-4 w-4" />
        <span className="sr-only">Ya</span>
      </span>
    );
  if (v === false)
    return (
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <Icon name="x" className="h-4 w-4" />
        <span className="sr-only">Tidak</span>
      </span>
    );
  return <span className="text-[13px] text-ink-2">{v}</span>;
}

/** Contoh tampilan dashboard — angka ilustrasi, bukan data pelanggan. */
function DashboardMock() {
  const bars = [62, 88, 54, 47, 40, 30, 36];
  const batal = [18, 0, 0, 0, 0, 0, 22];
  return (
    <div className="relative">
      <div className="absolute -inset-4 rounded-[28px] bg-brand/20 blur-2xl" aria-hidden="true" />
      <div className="relative rounded-2xl border border-white/10 bg-white p-5 text-ink shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="font-display text-[15px] font-semibold">Penjualan 7 hari</div>
          <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-medium text-ink-3">Contoh tampilan</span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            { k: "Omzet", v: "Rp 3,62 jt", c: "text-ink" },
            { k: "Pesanan", v: "52", c: "text-ink" },
            { k: "Profit bersih", v: "Rp 584 rb", c: "text-mn-green-ink" },
          ].map((s) => (
            <div key={s.k} className="rounded-lg border border-line px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-ink-3">{s.k}</div>
              <div className={`mt-0.5 font-display text-[15px] font-semibold tabular-nums ${s.c}`}>{s.v}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex h-28 items-end gap-2 border-b border-line pb-px">
          {bars.map((h, i) => (
            <div key={i} className="flex h-full flex-1 items-end gap-0.5">
              <div className="w-full rounded-t-sm bg-[#2a78d6]" style={{ height: `${h}%` }} />
              {(batal[i] ?? 0) > 0 && <div className="w-1/2 rounded-t-sm bg-[#ef6a6a]" style={{ height: `${batal[i] ?? 0}%` }} />}
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] text-ink-3">
          {["4/10", "5/10", "6/10", "7/10", "8/10", "9/10", "10/10"].map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-mn-amber/40 bg-mn-amber-tint px-3 py-2 text-[12px] text-mn-amber-ink">
          <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <b>3 produk</b> terjual di bawah harga master — profit <span className="tabular-nums">Rp 35.369</span> → jadi{" "}
            <span className="tabular-nums">Rp 14.292</span>
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          <span className="rounded-full bg-mn-red-tint px-2 py-0.5 font-medium text-mn-red-ink">Sering batal COD stlh kirim (2)</span>
          <span className="rounded-full bg-mn-green-tint px-2 py-0.5 font-medium text-mn-green-ink">Pelanggan setia</span>
          <span className="rounded-full bg-mn-teal-tint px-2 py-0.5 font-medium text-mn-teal">Pelanggan baru</span>
        </div>
      </div>
    </div>
  );
}

function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand font-display text-lg font-bold text-navy">A</span>
      <span className={`font-display text-lg font-semibold ${dark ? "text-white" : "text-ink"}`}>AutoToko</span>
    </span>
  );
}

export function Landing() {
  const [open, setOpen] = useState<number | null>(0);
  const [nav, setNav] = useState(false);
  const links = [
    { href: "#fitur", label: "Fitur" },
    { href: "#cara-kerja", label: "Cara kerja" },
    { href: "#perbandingan", label: "Perbandingan" },
    { href: "#faq", label: "FAQ" },
  ];

  return (
    <div className="min-h-screen bg-canvas font-sans text-ink">
      {/* ---------------- hero ---------------- */}
      <div className="bg-navy text-white">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/welcome" aria-label="AutoToko">
            <Logo dark />
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-white/70 md:flex">
            {links.map((l) => (
              <a key={l.href} href={l.href} className="transition hover:text-white">
                {l.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/login" className="hidden rounded-lg px-4 py-2 text-sm font-medium text-white/80 transition hover:text-white sm:inline-block">
              Masuk
            </Link>
            <Link to="/signup" className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-navy transition hover:bg-brand-dark">
              Daftar gratis
            </Link>
            <button
              type="button"
              onClick={() => setNav((v) => !v)}
              className="rounded-lg p-2 text-white/80 hover:bg-white/10 md:hidden"
              aria-label="Buka menu"
              aria-expanded={nav}
            >
              <Icon name="menu" />
            </button>
          </div>
        </header>
        {nav && (
          <div className="border-t border-white/10 px-4 pb-4 md:hidden">
            {links.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setNav(false)} className="block py-2.5 text-sm text-white/80">
                {l.label}
              </a>
            ))}
            <Link to="/login" className="block py-2.5 text-sm text-white/80">
              Masuk
            </Link>
          </div>
        )}

        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-10 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pb-28 lg:pt-16">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-xs font-medium text-brand">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              Untuk seller TikTok Shop yang memproduksi sendiri
            </span>
            <h1 className="mt-5 font-display text-4xl font-bold leading-[1.08] tracking-tight [text-wrap:balance] sm:text-5xl lg:text-[56px]">
              Tahu untung asli tiap pesanan, <span className="text-brand">bukan cuma omzet.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/70">
              AutoToko menghitung profit bersih dari harga jual yang benar-benar dibayar pembeli dan resep bahan baku Anda,
              menjaga gudang agar tidak mengirim paket yang sudah batal, dan membagi dana cair ke reseller secara otomatis.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/signup"
                className="inline-flex items-center gap-2 rounded-lg bg-brand px-6 py-3 font-semibold text-navy transition hover:bg-brand-dark"
              >
                Mulai gratis <Icon name="arrow" className="h-4 w-4" />
              </Link>
              <a href="#perbandingan" className="rounded-lg border border-white/20 px-6 py-3 font-semibold text-white transition hover:bg-white/5">
                Bandingkan
              </a>
            </div>
            <ul className="mt-8 grid max-w-lg gap-2 text-sm text-white/70 sm:grid-cols-2">
              {["Terhubung lewat API resmi TikTok Shop", "Aplikasi scan resi Android", "Tanpa kartu kredit untuk mulai", "Data tiap akun terisolasi"].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <Icon name="check" className="h-4 w-4 text-brand" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <DashboardMock />
        </section>
      </div>

      {/* ---------------- masalah ---------------- */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-ink">Masalah yang kami selesaikan</p>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight [text-wrap:balance] sm:text-4xl">
            Jualan makin ramai, tapi uangnya bocor di tempat yang tidak terlihat.
          </h2>
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {PAIN.map((p) => (
            <div key={p.title} className="rounded-xl border border-line bg-white p-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mn-red-tint text-mn-red-ink">
                <Icon name="alert" />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold">{p.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{p.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- fitur ---------------- */}
      <section id="fitur" className="scroll-mt-8 bg-white py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-ink">Fitur</p>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight [text-wrap:balance] sm:text-4xl">
              Dibuat dari operasional seller yang benar-benar memproduksi barangnya.
            </h2>
          </div>
          <div className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title}>
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-navy text-brand">
                  <Icon name={f.icon} />
                </div>
                <h3 className="mt-4 font-display text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- cara kerja ---------------- */}
      <section id="cara-kerja" className="scroll-mt-8 mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-ink">Cara kerja</p>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight [text-wrap:balance] sm:text-4xl">
            Satu alur dari pesanan masuk sampai dana dibagi.
          </h2>
        </div>
        <ol className="mt-12 grid gap-5 md:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative rounded-xl border border-line bg-white p-6">
              <span className="font-display text-sm font-semibold text-brand-ink">Langkah {i + 1}</span>
              <h3 className="mt-2 font-display text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{s.desc}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------------- perbandingan ---------------- */}
      <section id="perbandingan" className="scroll-mt-8 bg-navy py-20 text-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand">Perbandingan jujur</p>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight [text-wrap:balance] sm:text-4xl">
              Aplikasi omnichannel unggul di jumlah marketplace. AutoToko unggul di profit.
            </h2>
            <p className="mt-4 text-white/70">
              Kalau Anda butuh satu dashboard untuk puluhan marketplace sekaligus, aplikasi omnichannel adalah pilihan tepat.
              Kalau Anda ingin tahu persis pesanan mana yang menguntungkan, di situlah AutoToko dibuat.
            </p>
          </div>
          <div className="mt-10 overflow-x-auto rounded-xl bg-white text-ink">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="px-5 py-4 font-medium text-ink-2">Kemampuan</th>
                  <th className="w-44 bg-brand-light px-5 py-4 text-center font-display font-semibold">AutoToko</th>
                  <th className="w-48 px-5 py-4 text-center font-medium text-ink-2">Aplikasi omnichannel umum</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map((c) => (
                  <tr key={c.row} className="border-b border-line last:border-0">
                    <td className="px-5 py-4">{c.row}</td>
                    <td className="bg-brand-light/60 px-5 py-4 text-center">
                      <CompareCell v={c.us} strong />
                    </td>
                    <td className="px-5 py-4 text-center">
                      <CompareCell v={c.them} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-white/50">
            Kolom "aplikasi omnichannel umum" merangkum kemampuan yang lazim ditawarkan; fitur tiap produk bisa berbeda.
          </p>
        </div>
      </section>

      {/* ---------------- keamanan ---------------- */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="grid items-center gap-10 rounded-2xl border border-line bg-white p-8 md:grid-cols-[auto_1fr] md:p-10">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-navy text-brand">
            <Icon name="shield" className="h-7 w-7" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight">Data toko Anda tetap milik Anda.</h2>
            <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-ink-2">
              Setiap akun terisolasi di tingkat database sehingga tidak bisa saling melihat data. Token akses marketplace disimpan
              terenkripsi, dan Anda bisa memutus koneksi toko kapan pun.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------- faq ---------------- */}
      <section id="faq" className="scroll-mt-8 bg-white py-20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <h2 className="text-center font-display text-3xl font-bold tracking-tight sm:text-4xl">Pertanyaan yang sering diajukan</h2>
          <div className="mt-10 divide-y divide-line rounded-xl border border-line">
            {FAQ.map((f, i) => (
              <div key={f.q}>
                <button
                  type="button"
                  onClick={() => setOpen(open === i ? null : i)}
                  aria-expanded={open === i}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-medium hover:bg-canvas"
                >
                  {f.q}
                  <span className={`text-xl text-ink-3 transition ${open === i ? "rotate-45" : ""}`} aria-hidden="true">
                    +
                  </span>
                </button>
                {open === i && <p className="px-5 pb-5 text-[15px] leading-relaxed text-ink-2">{f.a}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- CTA ---------------- */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="rounded-2xl bg-navy px-6 py-14 text-center text-white sm:px-12">
          <h2 className="mx-auto max-w-2xl font-display text-3xl font-bold tracking-tight [text-wrap:balance] sm:text-4xl">
            Lihat pesanan mana yang benar-benar menguntungkan — mulai hari ini.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-white/70">Hubungkan toko TikTok Shop Anda dalam beberapa menit. Gratis untuk mulai.</p>
          <Link
            to="/signup"
            className="mt-8 inline-flex items-center gap-2 rounded-lg bg-brand px-7 py-3.5 font-semibold text-navy transition hover:bg-brand-dark"
          >
            Daftar gratis <Icon name="arrow" className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-ink-2 sm:flex-row sm:px-6">
          <Logo />
          <div className="flex gap-5">
            <Link to="/terms" className="hover:text-ink">
              Ketentuan
            </Link>
            <Link to="/privacy" className="hover:text-ink">
              Privasi
            </Link>
            <Link to="/login" className="hover:text-ink">
              Masuk
            </Link>
          </div>
          <span className="text-ink-3">© {new Date().getFullYear()} AutoToko</span>
        </div>
      </footer>
    </div>
  );
}
