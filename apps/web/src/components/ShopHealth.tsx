import { useState } from "react";
import { useFetch } from "../lib/useFetch";
import { rupiah } from "../lib/fmt";
import { Icon } from "./Icon";
import { Badge, Card, CardHeader, EmptyState, InlineAlert, Select } from "./ui";

/**
 * The shop owner's view of their own shops.
 *
 * Two sources, answering different questions. Money is payout_mutations —
 * what was actually released, not what an order promised. Movement is resi
 * scans, because the marketplace APIs are not connected and a scan is the only
 * record that a parcel really left the building.
 *
 * Which is why an unmapped scan matters: it is invisible to every figure in the
 * activity column, so a shop that shipped forty parcels can read as dormant.
 */

interface ShopRow {
  id: string;
  name: string;
  marketplace: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  status: "aktif" | "melambat" | "vakum" | "belum ada data";
  idleDays: number | null;
  credit: number;
  creditPrev: number;
  creditTrendPct: number | null;
  creditPerDay: number;
  sellerShare: number;
  subSellerShare: number;
  parcels: number;
  parcelsPrev: number;
  units: number;
  variety: number;
  creditPerParcel: number | null;
  unitsPerParcel: number | null;
  topProducts: { id: string; name: string; units: number }[];
}

interface Insights {
  range: { from: string; to: string; days: number };
  totals: {
    credit: number;
    creditPerDay: number;
    creditPerMonth: number;
    parcels: number;
    parcelsPerDay: number;
    units: number;
    variety: number;
    creditPerParcel: number | null;
    unitsPerParcel: number | null;
    shops: number;
    activeShops: number;
    idleShops: number;
  };
  restock: {
    spend: number;
    purchases: number;
    unpricedPurchases: number;
    heldForMaterials: number;
    balance: number;
    shareOfCredit: number | null;
    heldVsSpent: number;
  };
  owners: {
    seller: { total: number; perDay: number; perMonth: number };
    subSellers: { id: string; name: string; total: number; perDay: number; perMonth: number }[];
  };
  highlights: {
    busiestShop: { id: string; name: string; parcels: number } | null;
    topEarningShop: { id: string; name: string; credit: number } | null;
    topProducts: { id: string; name: string; units: number; parcels: number }[];
  };
  shops: ShopRow[];
}

interface Category {
  id: string;
  name: string;
}

const STATUS_TONE = {
  aktif: "success",
  melambat: "warning",
  vakum: "danger",
  "belum ada data": "neutral",
} as const;

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{value}</div>
      {sub && <div className="text-xs text-ink-2">{sub}</div>}
    </div>
  );
}

function Trend({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-ink-3">—</span>;
  const up = pct >= 0;
  return (
    <span className={`text-xs tabular-nums ${up ? "text-emerald-600" : "text-red-600"}`}>
      {up ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}

/** Local date as YYYY-MM-DD. toISOString would shift a Jakarta evening back a day. */
function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Where a named period starts and ends.
 *
 * "Minggu ini" is a boundary, not a duration: on a Tuesday it is two days, not
 * seven. Treating it as "the last 7 days" would answer a question nobody asked
 * and quietly include last week's Sunday.
 */
function periodRange(preset: string, customFrom: string, customTo: string) {
  const now = new Date();
  const today = ymd(now);

  if (preset === "hari") return { from: today, to: today };

  if (preset === "minggu") {
    // Monday as the first day: an Indonesian working week starts there, and a
    // Sunday-start would put yesterday's work in "last week" every Monday.
    const day = (now.getDay() + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - day);
    return { from: ymd(monday), to: today };
  }

  if (preset === "bulan") {
    return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
  }

  if (preset === "custom") {
    // Backwards dates would return nothing and look like "no sales"; swapped
    // is what the person meant.
    if (customFrom && customTo && customFrom > customTo) {
      return { from: customTo, to: customFrom };
    }
    return { from: customFrom || today, to: customTo || today };
  }

  const n = Number(preset) || 30;
  const start = new Date(now.getTime() - (n - 1) * 86_400_000);
  return { from: ymd(start), to: today };
}

export function ShopHealth() {
  const [days, setDays] = useState("30");
  const [categoryId, setCategoryId] = useState("all");
  const [customFrom, setCustomFrom] = useState(ymd(new Date()));
  const [customTo, setCustomTo] = useState(ymd(new Date()));

  const { from, to } = periodRange(days, customFrom, customTo);

  const categories = useFetch<Category[]>("/shops/categories");
  const data = useFetch<Insights>(
    `/dashboard/shop-insights?from=${from}&to=${to}&categoryId=${categoryId}`,
  );
  const d = data.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs text-ink-3">Kategori toko</label>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="all">Semua kategori</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        {days === "custom" && (
          <>
            <div>
              <label className="mb-1 block text-xs text-ink-3">Dari</label>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-9 rounded-md border border-line bg-canvas px-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink-3">Sampai</label>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-9 rounded-md border border-line bg-canvas px-2 text-sm"
              />
            </div>
          </>
        )}

        <div>
          <label className="mb-1 block text-xs text-ink-3">Periode</label>
          <Select value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="hari">Hari ini</option>
            <option value="minggu">Minggu ini</option>
            <option value="bulan">Bulan ini</option>
            <option value="7">7 hari terakhir</option>
            <option value="30">30 hari terakhir</option>
            <option value="90">90 hari terakhir</option>
            <option value="365">1 tahun terakhir</option>
            <option value="custom">Pilih tanggal…</option>
          </Select>
        </div>
      </div>

      {data.loading ? (
        <Card>
          <div className="py-6 text-center text-sm text-ink-3">Memuat…</div>
        </Card>
      ) : !d ? (
        <Card>
          <EmptyState icon="store" title="Belum ada data toko" />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Pencairan masuk"
              value={rupiah(d.totals.credit)}
              sub={`${rupiah(d.totals.creditPerDay)}/hari · ${rupiah(d.totals.creditPerMonth)}/bulan`}
            />
            <Stat
              label="Bagian Anda (seller)"
              value={rupiah(d.owners.seller.total)}
              sub={`${rupiah(d.owners.seller.perDay)}/hari`}
            />
            <Stat
              label="Paket dikirim"
              value={String(d.totals.parcels)}
              sub={`${d.totals.parcelsPerDay}/hari · ${d.totals.units} pcs produk`}
            />
            <Stat
              label="Toko"
              value={`${d.totals.activeShops} aktif`}
              sub={
                d.totals.idleShops > 0
                  ? `${d.totals.idleShops} vakum dari ${d.totals.shops}`
                  : `dari ${d.totals.shops} toko`
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {/* Variety beside volume: forty parcels of one item and forty of
                twelve are the same number and not the same business. */}
            <Stat
              label="Ragam produk terkirim"
              value={String(d.totals.variety)}
              sub="jenis produk berbeda"
            />
            <Stat
              label="Nilai per paket"
              value={d.totals.creditPerParcel != null ? rupiah(d.totals.creditPerParcel) : "—"}
              sub="pencairan ÷ paket terpetakan"
            />
            <Stat
              label="Isi per paket"
              value={d.totals.unitsPerParcel != null ? `${d.totals.unitsPerParcel} pcs` : "—"}
              sub="rata-rata isi satu paket"
            />
            <Stat
              label="Rata-rata sub-seller"
              value={
                d.owners.subSellers.length
                  ? rupiah(
                      Math.round(
                        d.owners.subSellers.reduce((n, s) => n + s.total, 0) /
                          d.owners.subSellers.length,
                      ),
                    )
                  : "—"
              }
              sub={`${d.owners.subSellers.length} sub-seller`}
            />
          </div>

          {/* Ranked separately on purpose: the shop that ships most is often
              not the one that earns most, and one "best shop" would hide
              exactly the case worth looking at — high volume, thin margin. */}
          <div className="grid gap-3 md:grid-cols-3">
            <Card>
              <div className="text-xs text-ink-3">Paling sibuk</div>
              <div className="mt-1 font-medium text-ink">
                {d.highlights.busiestShop?.name ?? "—"}
              </div>
              <div className="text-sm text-ink-2">
                {d.highlights.busiestShop
                  ? `${d.highlights.busiestShop.parcels} paket`
                  : "belum ada resi yang dipetakan ke toko"}
              </div>
            </Card>
            <Card>
              <div className="text-xs text-ink-3">Pencairan terbesar</div>
              <div className="mt-1 font-medium text-ink">
                {d.highlights.topEarningShop?.name ?? "—"}
              </div>
              <div className="text-sm text-ink-2">
                {d.highlights.topEarningShop ? rupiah(d.highlights.topEarningShop.credit) : "—"}
              </div>
            </Card>
            <Card>
              <div className="text-xs text-ink-3">Produk terlaris</div>
              {d.highlights.topProducts.length ? (
                <ol className="mt-1 space-y-0.5 text-sm">
                  {d.highlights.topProducts.slice(0, 3).map((p, i) => (
                    <li key={p.id} className="flex justify-between gap-2">
                      <span className="truncate text-ink">
                        {i + 1}. {p.name}
                      </span>
                      <span className="shrink-0 tabular-nums text-ink-2">{p.units} pcs</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="mt-1 text-sm text-ink-2">
                  belum ada isi paket yang terhubung ke toko
                </div>
              )}
            </Card>
          </div>

          {d.owners.subSellers.length > 0 && (
            <Card padded={false}>
              <CardHeader
                title="Penghasilan sub-seller"
                subtitle={`Rata-rata dihitung dari ${d.range.days} hari terakhir`}
              />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-ink-3">
                      <th className="px-4 py-2 font-medium">Nama</th>
                      <th className="px-4 py-2 text-right font-medium">Total</th>
                      <th className="px-4 py-2 text-right font-medium">Per hari</th>
                      <th className="px-4 py-2 text-right font-medium">Per bulan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.owners.subSellers.map((s) => (
                      <tr key={s.id} className="border-b border-line/60 last:border-0">
                        <td className="px-4 py-2 text-ink">{s.name}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-ink">
                          {rupiah(s.total)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-ink-2">
                          {rupiah(s.perDay)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-ink-2">
                          {rupiah(s.perMonth)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Like against like: the allowance the payout set aside for
              materials, against what was actually paid for them. Comparing
              restock to total takings answers nothing — a month's revenue
              always dwarfs a month's buying, and the ratio moves with sales
              rather than with purchasing. */}
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-xs text-ink-3">
                  Jatah bahan baku vs belanja stok
                </div>
                <div
                  className={`mt-1 text-lg font-semibold ${
                    d.restock.heldVsSpent >= 0 ? "text-emerald-600" : "text-red-600"
                  }`}
                >
                  {d.restock.heldVsSpent >= 0
                    ? `Sisa ${rupiah(d.restock.heldVsSpent)}`
                    : `Belanja lebih besar ${rupiah(Math.abs(d.restock.heldVsSpent))}`}
                </div>
                <div className="mt-1 text-sm text-ink-2">
                  Jatah {rupiah(d.restock.heldForMaterials)} · Belanja{" "}
                  {rupiah(d.restock.spend)}
                </div>
              </div>

              <div className="text-right">
                <div className="text-xs text-ink-3">Terpakai</div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-ink">
                  {d.restock.heldForMaterials > 0
                    ? `${Math.round((d.restock.spend / d.restock.heldForMaterials) * 1000) / 10}%`
                    : "—"}
                </div>
                <div className="text-xs text-ink-3">dari jatah bahan baku</div>
              </div>
            </div>

            {/* Stated rather than hidden: a delivery scanned without a COD
                amount has no price, so the spend is a floor. A figure without
                that caveat reads as a total. */}
            {(d.restock.unpricedPurchases > 0 || d.restock.purchases === 0) && (
              <div className="mt-3">
                <InlineAlert tone="warning">
                  {d.restock.purchases === 0
                    ? "Belum ada pembelian stok tercatat di periode ini, jadi angka belanja masih nol."
                    : `${d.restock.unpricedPurchases} dari ${d.restock.purchases} pembelian belum ada nominalnya, jadi belanja sebenarnya lebih besar dari angka ini. Lengkapi di menu Pembelian Stok.`}
                </InlineAlert>
              </div>
            )}

            <div className="mt-3 text-xs text-ink-3">
              Jatah bahan baku adalah potongan yang sudah diambil di pencairan. Belanja
              stok dihitung untuk seluruh bisnis dan tidak ikut filter kategori — bahan
              baku dibeli sekali lalu dipakai semua toko.
            </div>
          </Card>

          <Card padded={false}>
            <CardHeader
              title={`Kesehatan Toko (${d.shops.length})`}
              subtitle="Status dari kapan terakhir toko ini mengirim paket. Tren dibandingkan periode sebelumnya."
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-ink-3">
                    <th className="px-4 py-2 font-medium">Toko</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 text-right font-medium">Pencairan</th>
                    <th className="px-4 py-2 text-right font-medium">Tren</th>
                    <th className="px-4 py-2 text-right font-medium">Paket</th>
                    <th className="px-4 py-2 text-right font-medium">Per paket</th>
                    <th className="px-4 py-2 font-medium">Produk unggulan</th>
                  </tr>
                </thead>
                <tbody>
                  {d.shops.map((s) => (
                    <tr key={s.id} className="border-b border-line/60 last:border-0">
                      <td className="px-4 py-2">
                        <div className="font-medium text-ink">{s.name}</div>
                        <div className="flex items-center gap-1.5 text-[11px] text-ink-3">
                          <span>{s.marketplace}</span>
                          {s.categoryName && (
                            <span
                              className="rounded px-1"
                              style={
                                s.categoryColor
                                  ? { background: `${s.categoryColor}22`, color: s.categoryColor }
                                  : undefined
                              }
                            >
                              {s.categoryName}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
                        {s.idleDays !== null && s.idleDays > 7 && (
                          <div className="mt-0.5 text-[11px] text-ink-3">
                            {s.idleDays} hari lalu
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink">
                        {rupiah(s.credit)}
                        <div className="text-[11px] text-ink-3">{rupiah(s.creditPerDay)}/hari</div>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Trend pct={s.creditTrendPct} />
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink-2">
                        {s.parcels}
                        {s.units > 0 && (
                          <div className="text-[11px] text-ink-3">
                            {s.units} pcs · {s.variety} jenis
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink-2">
                        {s.creditPerParcel != null ? rupiah(s.creditPerParcel) : "—"}
                        {s.unitsPerParcel != null && (
                          <div className="text-[11px] text-ink-3">{s.unitsPerParcel} pcs</div>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {s.topProducts.length ? (
                          <div className="space-y-0.5 text-xs">
                            {s.topProducts.map((p) => (
                              <div key={p.id} className="flex justify-between gap-2">
                                <span className="truncate text-ink-2">{p.name}</span>
                                <span className="shrink-0 tabular-nums text-ink-3">
                                  {p.units}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-ink-3">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {d.totals.parcels === 0 && (
              <div className="border-t border-line px-4 py-3 text-xs text-ink-2">
                <Icon name="info" size={13} className="mr-1 inline" />
                Kolom paket dan produk unggulan terisi dari resi yang sudah dipetakan ke
                toko. Selama resi belum dipetakan, kolom ini tetap kosong meski tokonya
                aktif.
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
