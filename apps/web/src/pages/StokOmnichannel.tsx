import { useMemo, useState } from "react";
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

/**
 * Stok Omnichannel — halaman MONITORING (web-only). Menyatukan stok tiap SKU
 * marketplace lintas toko/channel: mana yang HABIS, MENIPIS, TAK-TAHU, dan mana
 * yang stoknya TAK-SINKRON antar listing dari master produk yang sama.
 *
 * Read-only. Tidak menulis apa pun ke marketplace. Push stok/harga ke listing
 * live adalah aksi keluar tersendiri (manual + konfirmasi) dan belum ada di
 * layar ini — ini murni pemantauan.
 */

type StatusStok = "habis" | "menipis" | "aman" | "tak_tahu";

interface Item {
  id: string;
  marketplace: string;
  shopId: string | null;
  shopName: string;
  productId: string | null;
  productName: string | null;
  skuId: string;
  skuName: string | null;
  sellerSku: string | null;
  price: number | null;
  stock: number | null;
  status: StatusStok;
  masterId: string | null;
  masterName: string | null;
  takSinkron: boolean;
  syncedAt: string | null;
}
interface PerToko {
  shopId: string;
  shopName: string;
  marketplace: string;
  total: number;
  habis: number;
  menipis: number;
  takTahu: number;
}
interface Data {
  ringkasan: {
    totalSku: number;
    habis: number;
    menipis: number;
    takTahu: number;
    terpetakan: number;
    takSinkron: number;
    ambangMenipis: number;
  };
  perToko: PerToko[];
  items: Item[];
}

const rupiah = (n: number | null) =>
  n == null ? "—" : "Rp" + n.toLocaleString("id-ID");
const tgl = (s: string | null) =>
  s ? new Date(s).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "-";

const STATUS_META: Record<StatusStok, { label: string; tone: "neutral" | "success" | "warning" | "danger" | "info" }> = {
  habis: { label: "Habis", tone: "danger" },
  menipis: { label: "Menipis", tone: "warning" },
  tak_tahu: { label: "Tak tahu", tone: "neutral" },
  aman: { label: "Aman", tone: "success" },
};

type Filter = "semua" | StatusStok | "tak_sinkron";

export function StokOmnichannel() {
  const { data, loading } = useFetch<Data>("/inventory/omnichannel");
  const [filter, setFilter] = useState<Filter>("semua");
  const [toko, setToko] = useState<string>("semua");
  const [cari, setCari] = useState("");

  const items = data?.items ?? [];
  const r = data?.ringkasan;

  const tampil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return items.filter((it) => {
      if (toko !== "semua" && (it.shopId ?? "?") !== toko) return false;
      if (filter === "tak_sinkron" && !it.takSinkron) return false;
      if (filter !== "semua" && filter !== "tak_sinkron" && it.status !== filter) return false;
      if (q) {
        const hay = `${it.skuName ?? ""} ${it.productName ?? ""} ${it.sellerSku ?? ""} ${it.skuId} ${it.masterName ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, filter, toko, cari]);

  const tiles: { key: Filter; label: string; val: number; tone: string; hint?: string }[] = [
    { key: "semua", label: "Total SKU", val: r?.totalSku ?? 0, tone: "var(--ink-3, #9AA0A6)" },
    { key: "habis", label: "Habis (0)", val: r?.habis ?? 0, tone: "#B3261E" },
    { key: "menipis", label: `Menipis (≤${r?.ambangMenipis ?? 5})`, val: r?.menipis ?? 0, tone: "#B36A00" },
    { key: "tak_tahu", label: "Tak tahu (null)", val: r?.takTahu ?? 0, tone: "#9AA0A6", hint: "Marketplace tak melaporkan stok" },
    { key: "tak_sinkron", label: "Tak sinkron", val: r?.takSinkron ?? 0, tone: "#256FB0", hint: "Master dgn stok beda antar listing" },
  ];

  return (
    <Layout title="Stok Omnichannel">
      <p className="text-sm text-ink-2 mb-4 max-w-2xl">
        Kesehatan stok tiap SKU marketplace lintas toko, dari sinkronisasi API. Klik kartu untuk
        menyaring. Halaman ini hanya membaca — tidak mengubah stok di marketplace.
      </p>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : (
        <>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 mb-4">
            {tiles.map((t) => {
              const aktif = filter === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setFilter(aktif && t.key !== "semua" ? "semua" : t.key)}
                  className="text-left"
                >
                  <div
                    className="bg-white border border-line rounded-lg p-4 h-full transition"
                    style={{
                      borderLeft: `4px solid ${t.tone}`,
                      outline: aktif ? "2px solid var(--brand, #256FB0)" : "none",
                    }}
                  >
                    <div className="text-2xl font-bold tabular-nums text-ink">{t.val}</div>
                    <div className="text-xs font-medium text-ink mt-0.5">{t.label}</div>
                    {t.hint && <div className="text-[10px] text-ink-3 mt-1 leading-tight">{t.hint}</div>}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Rincian per toko */}
          {(data?.perToko?.length ?? 0) > 1 && (
            <Card className="p-0 overflow-hidden mb-4">
              <div className="px-4 py-2.5 border-b border-line text-sm font-medium text-ink">Per toko</div>
              <TableWrap>
                <Table>
                  <THead><tr><TH>Toko</TH><TH>Channel</TH><TH align="right">SKU</TH><TH align="right">Habis</TH><TH align="right">Menipis</TH><TH align="right">Tak tahu</TH></tr></THead>
                  <tbody>
                    {data!.perToko.map((t) => (
                      <TR key={t.shopId}>
                        <TD>
                          <button
                            className="text-brand-ink hover:underline"
                            onClick={() => setToko(toko === t.shopId ? "semua" : t.shopId)}
                          >
                            {t.shopName}
                          </button>
                        </TD>
                        <TD className="text-ink-3 capitalize">{t.marketplace}</TD>
                        <TD align="right" className="tabular-nums">{t.total}</TD>
                        <TD align="right" className="tabular-nums" style={{ color: t.habis ? "#B3261E" : undefined }}>{t.habis}</TD>
                        <TD align="right" className="tabular-nums" style={{ color: t.menipis ? "#B36A00" : undefined }}>{t.menipis}</TD>
                        <TD align="right" className="tabular-nums text-ink-3">{t.takTahu}</TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            </Card>
          )}

          {/* Tabel SKU */}
          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-line flex flex-wrap items-center gap-2 justify-between">
              <div className="text-sm font-medium text-ink">
                Daftar SKU
                {(filter !== "semua" || toko !== "semua") && (
                  <button className="ml-2 text-xs text-brand-ink font-normal hover:underline" onClick={() => { setFilter("semua"); setToko("semua"); }}>
                    reset saringan
                  </button>
                )}
              </div>
              <input
                value={cari}
                onChange={(e) => setCari(e.target.value)}
                placeholder="Cari nama / SKU / seller SKU…"
                className="text-sm border border-line rounded-md px-2.5 py-1.5 bg-canvas text-ink w-full sm:w-64"
              />
            </div>
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>Produk / Varian</TH>
                    <TH>Toko</TH>
                    <TH>Master</TH>
                    <TH align="right">Harga</TH>
                    <TH align="right">Stok</TH>
                    <TH>Status</TH>
                    <TH>Sinkron</TH>
                  </tr>
                </THead>
                <tbody>
                  {tampil.map((it) => (
                    <TR key={it.id}>
                      <TD>
                        <div className="text-ink">{it.skuName || it.productName || "(tanpa nama)"}</div>
                        <div className="text-[11px] text-ink-3">
                          {it.productName && it.skuName ? it.productName + " · " : ""}
                          {it.sellerSku ? <span className="font-mono">{it.sellerSku}</span> : <span className="font-mono">{it.skuId}</span>}
                        </div>
                      </TD>
                      <TD className="text-ink-2">{it.shopName}</TD>
                      <TD>
                        {it.masterName
                          ? <span className="text-ink-2">{it.masterName}{it.takSinkron && <>{" "}<Badge tone="info">tak sinkron</Badge></>}</span>
                          : <span className="text-ink-3 text-xs">belum dipetakan</span>}
                      </TD>
                      <TD align="right" className="tabular-nums">{rupiah(it.price)}</TD>
                      <TD align="right" className="tabular-nums font-medium" style={{ color: it.status === "habis" ? "#B3261E" : it.status === "menipis" ? "#B36A00" : undefined }}>
                        {it.stock == null ? "—" : it.stock}
                      </TD>
                      <TD><Badge tone={STATUS_META[it.status].tone}>{STATUS_META[it.status].label}</Badge></TD>
                      <TD className="text-ink-3 text-[11px]">{tgl(it.syncedAt)}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
            {tampil.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-ink-3">
                <Icon name="package" size={22} />
                <div className="mt-1">Tidak ada SKU yang cocok dengan saringan.</div>
              </div>
            )}
            <div className="px-4 py-2 text-xs text-ink-3 border-t border-line">
              Menampilkan {tampil.length} dari {items.length} SKU
              {r ? ` · ${r.terpetakan} terpetakan ke master` : ""}.
            </div>
          </Card>
        </>
      )}
    </Layout>
  );
}
