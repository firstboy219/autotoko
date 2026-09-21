import { useState } from "react";
import { SectionTabs } from "../components/SectionTabs";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import {
  Card,
  Badge,
  Skeleton,
  Table,
  TableWrap,
  THead,
  TR,
  TH,
  TD,
} from "../components/ui";
import { Icon } from "../components/Icon";
import { FS_LABEL, STATUS_GLOSSARY } from "../lib/orderStatus";

/**
 * Kesehatan Pesanan — halaman MONITORING (web-only, sesuai doktrin: APK untuk
 * take-action, web untuk take-action + monitoring). Menyatukan sinyal dua
 * sumber (API marketplace × scan manual gudang) dalam satu tempat. Read-only:
 * tidak mengubah data apa pun, hanya menampilkan temuan yang perlu ditindak.
 */

interface Row {
  no?: string | null;
  fs?: string;
  kurir?: string | null;
  resi?: string | null;
  sku?: string;
  nama?: string;
  note?: string | null;
  harap?: number;
  terbaca?: number;
  at?: string;
}
interface Metric { total: number; contoh: Row[] }
interface Health {
  belumDiscan: Metric;
  manualTanpaApi: Metric;
  skuBelumDipetakan: Metric;
  tanpaNominal: Metric;
  isiTakCocok: Metric;
}

const tgl = (s?: string) => (s ? new Date(s).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "-");

type Tone = "neutral" | "success" | "warning" | "danger" | "info";
interface CardDef {
  key: keyof Health;
  icon: string;
  title: string;
  tone: Tone;
  desc: string;
  aksi: string;
  kolom: { k: keyof Row; label: string; render?: (r: Row) => React.ReactNode }[];
}

const CARDS: CardDef[] = [
  {
    key: "belumDiscan", icon: "warning", tone: "warning",
    title: "Terkirim di marketplace, belum discan gudang",
    desc: "Marketplace bilang paket sudah dikirim/selesai (60 hari terakhir), tapi tim gudang tak pernah scan resinya. Bisa jadi dikirim di luar alur — atau memang terlewat.",
    aksi: "Tindak: cek fisik paketnya, atau scan susulan supaya dua sumber cocok.",
    kolom: [
      { k: "no", label: "No. Pesanan" },
      { k: "fs", label: "Status", render: (r) => <Badge tone="info">{FS_LABEL[r.fs ?? ""] ?? r.fs}</Badge> },
      { k: "kurir", label: "Kurir" },
      { k: "at", label: "Waktu", render: (r) => tgl(r.at) },
    ],
  },
  {
    key: "manualTanpaApi", icon: "cart", tone: "info",
    title: "Discan gudang, tak ada order API-nya",
    desc: "Paket discan oleh tim, tapi tak ditemukan order marketplace yang cocok. Bisa order kanal lain, salah ketik nomor, atau sinkron belum menariknya.",
    aksi: "Tindak: cocokkan nomor pesanan, atau tarik sinkron ulang toko terkait.",
    kolom: [
      { k: "no", label: "No. Pesanan (dari label)" },
      { k: "resi", label: "Resi" },
      { k: "at", label: "Discan", render: (r) => tgl(r.at) },
    ],
  },
  {
    key: "skuBelumDipetakan", icon: "package", tone: "warning",
    title: "SKU varian belum dipetakan ke master produk",
    desc: "Varian ini muncul di pesanan tapi belum dikaitkan ke master produk AutoToko. Akibatnya packing list & audit jatuh ke nama postingan, dan laba per produk kabur.",
    aksi: "Tindak: petakan di Audit Pesanan / Master Produk supaya nama & HPP-nya benar.",
    kolom: [
      { k: "nama", label: "Nama (dari postingan)" },
      { k: "sku", label: "SKU ID", render: (r) => <span className="font-mono text-xs">{r.sku}</span> },
    ],
  },
  {
    key: "isiTakCocok", icon: "warning", tone: "warning",
    title: "Jumlah item terbaca ≠ pesanan",
    desc: "Saat resi discan, tim membaca daftar produk (tahap opsional). Bila jumlah item yang terbaca beda dari yang dipesan, mungkin ada yang kurang/lebih. Sifatnya advisory — bergantung daftar produk memang discan, bukan vonis.",
    aksi: "Tindak: cek fisik paket vs pesanan sebelum dikirim.",
    kolom: [
      { k: "no", label: "No. Pesanan" },
      { k: "harap", label: "Dipesan" },
      { k: "terbaca", label: "Terbaca" },
      { k: "at", label: "Discan", render: (r) => tgl(r.at) },
    ],
  },
  {
    key: "tanpaNominal", icon: "activity", tone: "neutral",
    title: "Order tanpa nominal",
    desc: "Order API yang belum punya nilai rupiah (bukan yang dibatalkan). Umumnya sementara sampai sinkron melengkapi — bukan “nol”, tapi “belum diketahui”.",
    aksi: "Tindak: biasanya cukup ditunggu; kalau menetap, cek sinkron toko.",
    kolom: [
      { k: "no", label: "No. Pesanan" },
      { k: "fs", label: "Status", render: (r) => <Badge tone="neutral">{FS_LABEL[r.fs ?? ""] ?? r.fs}</Badge> },
      { k: "at", label: "Waktu", render: (r) => tgl(r.at) },
    ],
  },
];

const TONE_ACCENT: Record<Tone, string> = {
  neutral: "var(--ink-3, #9AA0A6)", success: "#1B7F4B", warning: "#B3261E", danger: "#B3261E", info: "#256FB0",
};

export function KesehatanPesanan() {
  const { data, loading } = useFetch<Health>("/orders/health");
  const [buka, setBuka] = useState<string | null>(null);

  return (
    <Layout title="Kesehatan Pesanan">
      <SectionTabs tabs={[{ to: "/audit-pesanan", label: "Audit Pesanan" }, { to: "/kesehatan-pesanan", label: "Kesehatan Pesanan" }]} />
      <p className="text-sm text-ink-2 mb-4 max-w-2xl">
        Satu tempat untuk melihat di mana dua sumber data — API marketplace &amp; scan manual gudang —
        belum cocok. Halaman ini hanya membaca; tidak mengubah pesanan apa pun.
      </p>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 mb-4">
            {CARDS.map((c) => {
              const m = data?.[c.key] ?? { total: 0, contoh: [] };
              const aktif = buka === c.key;
              const sehat = m.total === 0;
              return (
                <Card key={c.key} className="p-0 overflow-hidden">
                  <button
                    onClick={() => setBuka(aktif ? null : c.key)}
                    className="w-full text-left p-4 flex items-start gap-3 hover:bg-canvas transition"
                    style={{ borderLeft: `4px solid ${sehat ? "#1B7F4B" : TONE_ACCENT[c.tone]}` }}
                  >
                    <Icon name={sehat ? "check" : (c.icon as never)} size={20} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl font-bold tabular-nums text-ink">{m.total}</span>
                        {sehat && <Badge tone="success">Bersih</Badge>}
                      </div>
                      <div className="text-sm font-medium text-ink mt-0.5">{c.title}</div>
                      <div className="text-xs text-ink-2 mt-1">{c.desc}</div>
                      {m.total > 0 && (
                        <div className="text-xs text-brand-ink mt-2 inline-flex items-center gap-1">
                          {aktif ? "Sembunyikan" : "Lihat contoh"}
                          <span style={{ display: "inline-flex", transform: aktif ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
                            <Icon name="chevronDown" size={13} />
                          </span>
                        </div>
                      )}
                    </div>
                  </button>
                  {aktif && m.total > 0 && (
                    <div className="border-t border-line">
                      <div className="px-4 py-2 text-xs text-ink-3 bg-canvas flex flex-wrap items-center gap-2 justify-between">
                        <span>{c.aksi}</span>
                        {c.key === "skuBelumDipetakan" && (
                          <a href="/produk" className="text-brand-ink font-medium whitespace-nowrap inline-flex items-center gap-1">
                            Petakan di Master Produk <Icon name="chevronRight" size={12} />
                          </a>
                        )}
                      </div>
                      <TableWrap>
                        <Table>
                          <THead><tr>{c.kolom.map((k) => <TH key={String(k.k)}>{k.label}</TH>)}</tr></THead>
                          <tbody>
                            {m.contoh.map((r, i) => (
                              <TR key={i}>
                                {c.kolom.map((k) => (
                                  <TD key={String(k.k)}>{k.render ? k.render(r) : (r[k.k] ?? "-")}</TD>
                                ))}
                              </TR>
                            ))}
                          </tbody>
                        </Table>
                      </TableWrap>
                      {m.total > m.contoh.length && (
                        <div className="px-4 py-2 text-xs text-ink-3">
                          Menampilkan {m.contoh.length} dari {m.total}.
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-line">
              <div className="text-sm font-medium text-ink">Panduan status pesanan</div>
              <div className="text-xs text-ink-2 mt-0.5">
                Tahap <b>Menunggu Dicetak/Dipacking/Dipickup</b> adalah rincian internal AutoToko —
                di marketplace ketiganya masih “Siap Kirim”. Yang sama persis dengan marketplace hanya
                Menunggu Disetujui, Dalam Pengiriman, Dibatalkan, dan Selesai.
              </div>
            </div>
            <TableWrap>
              <Table>
                <THead><tr><TH>Status di AutoToko</TH><TH>Artinya</TH><TH>Di marketplace</TH></tr></THead>
                <tbody>
                  {STATUS_GLOSSARY.map((g) => (
                    <TR key={g.key}>
                      <TD><Badge tone={g.marketplace.startsWith("=") ? "info" : "neutral"}>{g.internal}</Badge></TD>
                      <TD className="text-ink-2">{g.arti}</TD>
                      <TD className="text-ink-3">{g.marketplace}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </Card>
        </>
      )}
    </Layout>
  );
}
