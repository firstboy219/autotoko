import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { rupiah } from "../lib/fmt";
import { Icon } from "../components/Icon";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  InlineAlert,
  Input,
  PageHeader,
  SkeletonRows,
  Table,
  TableWrap,
  TD,
  TH,
  THead,
  TR,
} from "../components/ui";

interface Split {
  mutations: number;
  credit: number;
  sedekah: number;
  sellerGross: number;
  material: number;
  sellerNet: number;
  subSeller: number;
  subSubSeller: number;
}
interface SubSellerRow extends Split {
  id: string | null;
  name: string;
  effectiveRate: number;
}
interface ShopRow extends Split {
  id: string;
  name: string;
  marketplace: string | null;
  owner: string | null;
}
interface MonthRow extends Split {
  month: string;
}
interface MarketplaceRow extends Split {
  marketplace: string;
}
interface Report {
  range: { from: string | null; to: string | null; firstPayout: string | null; lastPayout: string | null };
  onlySettled: boolean;
  counts: { mutations: number; batches: number; shops: number; subSellers: number };
  totals: Split;
  bySubSeller: SubSellerRow[];
  byShop: ShopRow[];
  byMonth: MonthRow[];
  byMarketplace: MarketplaceRow[];
  truncated: boolean;
  basis: string;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
const TODAY = new Date().toISOString().slice(0, 10);

/** Months are keys, not labels: "2026-08" has to read as Agustus 2026. */
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];
function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const idx = Number(m) - 1;
  return idx >= 0 && idx < 12 ? `${MONTHS[idx]} ${y}` : key;
}

function pct(part: number, whole: number): string {
  if (!whole) return "—";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Where the money went, read off the payout ledger.
 *
 * The page says "bagian yang diterima" and not "laba" everywhere it can,
 * because a payout row carries no link to the products inside it — there is
 * nothing to subtract a cost of goods from. Calling this profit would present
 * revenue-after-commission as though the goods were free, which is the one
 * number a seller must not be handed wrong.
 */
export function PencairanProfit() {
  const [from, setFrom] = useState(isoDaysAgo(90));
  const [to, setTo] = useState(TODAY);
  const [onlySettled, setOnlySettled] = useState(false);

  const qs = new URLSearchParams({ from, to });
  if (onlySettled) qs.set("onlySettled", "1");
  const { data, loading, error } = useFetch<Report>(`/payout/profit?${qs.toString()}`);

  const t = data?.totals;

  const cards = useMemo(() => {
    if (!t) return [];
    return [
      { label: "Total Kredit Masuk", value: t.credit, share: null as string | null, tone: "brand" },
      { label: "Sedekah", value: t.sedekah, share: pct(t.sedekah, t.credit), tone: "neutral" },
      { label: "Seller (bersih)", value: t.sellerNet, share: pct(t.sellerNet, t.credit), tone: "success" },
      { label: "Bahan Baku", value: t.material, share: pct(t.material, t.credit), tone: "warning" },
      { label: "Komisi Sub-seller", value: t.subSeller + t.subSubSeller, share: pct(t.subSeller + t.subSubSeller, t.credit), tone: "info" },
    ];
  }, [t]);

  function downloadCsv() {
    if (!data) return;
    const lines: string[][] = [];
    lines.push(["LAPORAN BAGIAN DARI PENCAIRAN DANA"]);
    lines.push([`Periode`, from, "s/d", to]);
    lines.push([data.basis]);
    lines.push([]);
    lines.push(["RINGKASAN"]);
    lines.push(["Total Kredit", String(data.totals.credit)]);
    lines.push(["Sedekah", String(data.totals.sedekah)]);
    lines.push(["Seller (kotor)", String(data.totals.sellerGross)]);
    lines.push(["Bahan Baku", String(data.totals.material)]);
    lines.push(["Seller (bersih)", String(data.totals.sellerNet)]);
    lines.push(["Komisi Sub-seller", String(data.totals.subSeller)]);
    lines.push(["Komisi Sub-sub-seller", String(data.totals.subSubSeller)]);
    lines.push([]);
    lines.push(["PER SUB-SELLER", "Pencairan", "Kredit", "Komisi", "Rate Efektif"]);
    for (const r of data.bySubSeller) {
      lines.push([r.name, String(r.mutations), String(r.credit), String(r.subSeller + r.subSubSeller),
        `${(r.effectiveRate * 100).toFixed(1)}%`]);
    }
    lines.push([]);
    lines.push(["PER TOKO", "Marketplace", "Pemilik", "Pencairan", "Kredit", "Seller bersih", "Komisi"]);
    for (const r of data.byShop) {
      lines.push([r.name, r.marketplace ?? "-", r.owner ?? "-", String(r.mutations),
        String(r.credit), String(r.sellerNet), String(r.subSeller + r.subSubSeller)]);
    }
    lines.push([]);
    lines.push(["PER BULAN", "Kredit", "Sedekah", "Seller bersih", "Bahan baku", "Komisi"]);
    for (const r of data.byMonth) {
      lines.push([monthLabel(r.month), String(r.credit), String(r.sedekah), String(r.sellerNet),
        String(r.material), String(r.subSeller + r.subSubSeller)]);
    }
    const csv = lines.map((r) => r.map(csvEscape).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `laporan-pencairan-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Coerced: `data &&` yields null when the fetch has not landed, and a
  // null cannot be handed to a boolean prop.
  const empty = !loading && !!data && data.counts.mutations === 0;

  return (
    <Layout title="Laporan Bagian & Komisi">
      <PageHeader
        title="Laporan Bagian & Komisi"
        subtitle="Dihitung dari pencairan dana yang sudah direkam."
        back={
          <Link
            to="/pencairan"
            className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink mb-3"
          >
            <Icon name="arrowLeft" size={16} /> Kembali ke Pencairan
          </Link>
        }
        actions={
          <Button variant="outline" onClick={downloadCsv} disabled={!data || empty}>
            <Icon name="download" className="w-3.5 h-3.5" />
            Unduh CSV
          </Button>
        }
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <label>
            <span className="block text-xs text-ink-2 mb-1">Dari tanggal</span>
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            <span className="block text-xs text-ink-2 mb-1">Sampai tanggal</span>
            <Input type="date" value={to} min={from} max={TODAY} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={onlySettled}
              onChange={(e) => setOnlySettled(e.target.checked)}
            />
            Hanya batch yang sudah selesai
          </label>
          {data && !empty && (
            <div className="ml-auto text-xs text-ink-3 tabular-nums">
              {data.counts.mutations} pencairan · {data.counts.batches} batch ·{" "}
              {data.counts.shops} toko · {data.counts.subSellers} sub-seller
            </div>
          )}
        </div>
      </Card>

      {error && <InlineAlert tone="danger">{error}</InlineAlert>}

      {data && (
        <div className="mb-4">
          <InlineAlert tone="info">{data.basis}</InlineAlert>
        </div>
      )}

      {data?.truncated && (
        <div className="mb-4">
          <InlineAlert tone="warning">
            Data terlalu banyak untuk satu laporan — persempit rentang tanggalnya.
          </InlineAlert>
        </div>
      )}

      {loading ? (
        <Card>
          <div className="text-sm text-ink-3">Menghitung…</div>
        </Card>
      ) : empty ? (
        <Card padded={false}>
          <EmptyState
            icon="banknote"
            title="Belum ada pencairan di rentang ini"
            description="Ubah tanggalnya, atau rekam pencairan lebih dulu di menu Pencairan Dana."
          />
        </Card>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
            {cards.map((c) => (
              <div key={c.label} className="bg-white rounded-lg border border-line px-4 py-3">
                <div className="text-xs text-ink-3 truncate">{c.label}</div>
                <div className="text-base text-ink tabular-nums mt-1">{rupiah(c.value)}</div>
                {c.share && (
                  <div className="text-[11px] text-ink-3 tabular-nums">{c.share} dari kredit</div>
                )}
              </div>
            ))}
          </div>

          {/* Gross beside net, because the reserve is the seller's own money
              set aside rather than paid away, and a report that showed only
              one of the two would answer a different question than the reader
              had. */}
          <Card className="mb-5">
            <div className="text-xs text-ink-2 mb-2">Bagian seller</div>
            <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <span className="text-ink-2">
                Kotor <span className="text-ink tabular-nums">{rupiah(t!.sellerGross)}</span>
              </span>
              <span className="text-ink-2">
                − Bahan baku <span className="text-ink tabular-nums">{rupiah(t!.material)}</span>
              </span>
              <span className="text-ink-2">
                = Bersih <span className="text-ink font-medium tabular-nums">{rupiah(t!.sellerNet)}</span>
              </span>
            </div>
          </Card>

          <Card padded={false} className="mb-5">
            <CardHeader
              title="Per Sub-seller"
              subtitle="“Toko sendiri” = pencairan dari toko yang tidak dipegang sub-seller."
            />
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Sub-seller</TH>
                    <TH className="text-right">Pencairan</TH>
                    <TH className="text-right">Kredit</TH>
                    <TH className="text-right">Komisi</TH>
                    <TH className="text-right">Rate Efektif</TH>
                  </TR>
                </THead>
                <tbody>
                  {data.bySubSeller.map((r) => (
                    <TR key={r.id ?? "sendiri"}>
                      <TD>
                        {r.name}
                        {r.id === null && (
                          <span className="ml-2">
                            <Badge tone="neutral">tanpa komisi</Badge>
                          </span>
                        )}
                      </TD>
                      <TD className="text-right tabular-nums text-ink-2">{r.mutations}</TD>
                      <TD className="text-right tabular-nums">{rupiah(r.credit)}</TD>
                      <TD className="text-right tabular-nums">
                        {rupiah(r.subSeller + r.subSubSeller)}
                      </TD>
                      <TD className="text-right tabular-nums text-ink-2">
                        {r.credit > 0 ? `${(r.effectiveRate * 100).toFixed(1)}%` : "—"}
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </Card>

          <Card padded={false} className="mb-5">
            <CardHeader title="Per Toko" />
            <TableWrap>
              <Table className="min-w-[760px]">
                <THead>
                  <TR>
                    <TH>Toko</TH>
                    <TH>Pemilik</TH>
                    <TH className="text-right">Pencairan</TH>
                    <TH className="text-right">Kredit</TH>
                    <TH className="text-right">Seller Bersih</TH>
                    <TH className="text-right">Komisi</TH>
                  </TR>
                </THead>
                <tbody>
                  {data.byShop.map((r) => (
                    <TR key={r.id}>
                      <TD>
                        <div className="text-ink">{r.name}</div>
                        {r.marketplace && (
                          <div className="text-[11px] text-ink-3 capitalize">{r.marketplace}</div>
                        )}
                      </TD>
                      <TD className="text-ink-2">{r.owner ?? "—"}</TD>
                      <TD className="text-right tabular-nums text-ink-2">{r.mutations}</TD>
                      <TD className="text-right tabular-nums">{rupiah(r.credit)}</TD>
                      <TD className="text-right tabular-nums">{rupiah(r.sellerNet)}</TD>
                      <TD className="text-right tabular-nums">
                        {rupiah(r.subSeller + r.subSubSeller)}
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </Card>

          <Card padded={false}>
            <CardHeader title="Per Bulan" />
            <TableWrap>
              <Table className="min-w-[680px]">
                <THead>
                  <TR>
                    <TH>Bulan</TH>
                    <TH className="text-right">Kredit</TH>
                    <TH className="text-right">Sedekah</TH>
                    <TH className="text-right">Seller Bersih</TH>
                    <TH className="text-right">Bahan Baku</TH>
                    <TH className="text-right">Komisi</TH>
                  </TR>
                </THead>
                <tbody>
                  {data.byMonth.length === 0 ? (
                    <TR>
                      <TD colSpan={6}>
                        <SkeletonRows n={1} cols={6} />
                      </TD>
                    </TR>
                  ) : (
                    data.byMonth.map((r) => (
                      <TR key={r.month}>
                        <TD>{monthLabel(r.month)}</TD>
                        <TD className="text-right tabular-nums">{rupiah(r.credit)}</TD>
                        <TD className="text-right tabular-nums">{rupiah(r.sedekah)}</TD>
                        <TD className="text-right tabular-nums">{rupiah(r.sellerNet)}</TD>
                        <TD className="text-right tabular-nums">{rupiah(r.material)}</TD>
                        <TD className="text-right tabular-nums">
                          {rupiah(r.subSeller + r.subSubSeller)}
                        </TD>
                      </TR>
                    ))
                  )}
                </tbody>
              </Table>
            </TableWrap>
          </Card>
        </>
      ) : null}
    </Layout>
  );
}
