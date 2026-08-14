import { useState } from "react";
import { useFetch } from "../lib/useFetch";
import { rupiah } from "../lib/fmt";
import { Icon } from "./Icon";
import { Badge, Card, CardHeader, EmptyState, InlineAlert, Select } from "./ui";
import { ShopDetailModal } from "./ShopDetailModal";

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

/**
 * Belanja stok as a share of the listed price, next to what was planned.
 *
 * Separated out because it carries more caveats than figures, and every one of
 * them changes how the number should be read.
 */
function PersenHargaPublish({
  v,
}: {
  v: Insights["restock"]["vsPublish"];
}) {
  const [open, setOpen] = useState(false);

  if (v.plannedPct == null || v.actualPct == null) {
    return (
      <div className="text-xs text-ink-3">
        Belum bisa dihitung: perlu paket terkirim dari produk yang sudah punya
        harga publish. {v.unitsNoPrice > 0
          ? `${v.unitsNoPrice} pcs terkirim dari produk tanpa harga publish.`
          : "Belum ada paket terkirim di periode ini."}
      </div>
    );
  }

  const over = v.gapPct != null && v.gapPct > 0;

  return (
    <div>
      <div className="text-xs text-ink-3">Belanja stok vs harga publish</div>

      <div className="mt-2 flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <div className="text-[11px] text-ink-3">Rencana (dari resep)</div>
          <div className="text-lg font-semibold tabular-nums text-ink">
            {v.plannedPct}%
          </div>
          <div className="text-[11px] text-ink-3">
            bahan {v.plannedRecipePct}% + packing {v.plannedPackingPct}%
          </div>
        </div>

        <div>
          <div className="text-[11px] text-ink-3">Nyata (belanja stok)</div>
          <div
            className={`text-lg font-semibold tabular-nums ${
              over ? "text-red-600" : "text-emerald-600"
            }`}
          >
            {v.actualPct}%
          </div>
          <div className="text-[11px] text-ink-3">
            {rupiah(v.publishValue)} nilai publish terkirim
          </div>
        </div>

        <div>
          <div className="text-[11px] text-ink-3">Selisih</div>
          <div
            className={`text-lg font-semibold tabular-nums ${
              over ? "text-red-600" : "text-emerald-600"
            }`}
          >
            {v.gapPct != null && v.gapPct > 0 ? "+" : ""}
            {v.gapPct} poin
          </div>
          <div className="text-[11px] text-ink-3">
            {over ? "belanja di atas resep" : "belanja di bawah resep"}
          </div>
        </div>
      </div>

      {/* Said before the number can be over-read. Buying is lumpy and using is
          smooth: a drum bought this week is used for months, so a short range
          measures when an order was placed, not what a product eats. */}
      <div className="mt-3 text-xs text-ink-3">
        Dihitung dari {v.units.toLocaleString("id-ID")} pcs terkirim di periode ini.
        Belanja stok itu <strong>pembelian</strong>, bukan pemakaian — sekali beli
        dipakai berbulan-bulan, jadi angka “nyata” baru bisa dipercaya pada rentang
        panjang (misal 3–12 bulan). “Rencana” adalah pemakaian sebenarnya menurut
        resep, dan itu yang berlaku untuk rentang pendek.
      </div>

      {(v.unitsNoPrice > 0 || v.unitsNoRecipe > 0 || v.productsMissingCost > 0) && (
        <div className="mt-2">
          <InlineAlert tone="warning">
            {[
              v.unitsNoPrice > 0
                ? `${v.unitsNoPrice} pcs terkirim dari produk tanpa harga publish — tidak ikut dihitung.`
                : null,
              v.unitsNoRecipe > 0
                ? `${v.unitsNoRecipe} pcs dari produk yang belum punya resep, jadi angka rencana lebih rendah dari seharusnya.`
                : null,
              v.productsMissingCost > 0
                ? `${v.productsMissingCost} produk punya bahan yang belum ada harganya.`
                : null,
            ]
              .filter(Boolean)
              .join(" ")}
          </InlineAlert>
        </div>
      )}

      {/* Named rather than ranked. A product that costs more in materials
          than it sells for is a wrong price or a wrong recipe, and putting it
          at the top of a percentage list buries everything worth reading. */}
      {v.needsReview.length > 0 && (
        <div className="mt-2">
          <InlineAlert tone="danger">
            {v.needsReviewCount} produk berharga jual lebih rendah dari biaya
            bahannya sendiri, jadi tidak masuk peringkat di bawah:{" "}
            {v.needsReview.map((p) => `${p.name} (${rupiah(p.publishPrice)})`).join(", ")}.
            Periksa harga publish atau resepnya di menu HPP.
          </InlineAlert>
        </div>
      )}

      {v.perProduct.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            className="text-xs text-brand hover:underline"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Sembunyikan" : "Lihat"} rincian per produk ({v.perProduct.length})
          </button>

          {/* Only the plan can be split per product. What was spent cannot:
              one purchase of glycerine serves every recipe that uses it, and
              apportioning it would be an invented number. */}
          {open && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-ink-3">
                    <th className="py-1 pr-3 font-normal">Produk</th>
                    <th className="py-1 pr-3 text-right font-normal">Terkirim</th>
                    <th className="py-1 pr-3 text-right font-normal">Harga publish</th>
                    <th className="py-1 pr-3 text-right font-normal">Bahan/pcs</th>
                    <th className="py-1 text-right font-normal">% harga</th>
                  </tr>
                </thead>
                <tbody>
                  {v.perProduct.map((p) => (
                    <tr key={p.id} className="border-t border-line">
                      <td className="py-1 pr-3">{p.name}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{p.units}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">
                        {rupiah(p.publishPrice)}
                      </td>
                      <td className="py-1 pr-3 text-right tabular-nums">
                        {rupiah(p.materialPerPcs + p.packingMaterialPerPcs)}
                      </td>
                      <td
                        className={`py-1 text-right font-medium tabular-nums ${
                          v.plannedPct != null && p.pct > v.plannedPct
                            ? "text-amber-600"
                            : "text-ink-2"
                        }`}
                      >
                        {p.pct}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2 text-[11px] text-ink-3">
                Urut dari yang paling berat. Angka ini rencana menurut resep — belanja
                nyata tidak bisa dipecah per produk, karena satu kali beli glycerin
                dipakai banyak resep sekaligus.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** "6 Agu" — short enough for a bar label, unambiguous within one range. */
function hariPendek(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * What the numbers on this page can and cannot support.
 *
 * Placed above the tables it qualifies, because the order matters: a rate
 * without its spread and a ranking without its coverage are not smaller
 * truths, they are different claims. Everything here is one series at a time,
 * so no chart carries identity by colour — the daily bars are a single hue and
 * the coverage bars are a magnitude, not a set of categories.
 */
function BacaanStatistik({ s }: { s: Insights["statistics"] }) {
  const { span, coverage, rate, concentration, daily } = s;

  if (!span.parcels) {
    return (
      <Card>
        <div className="text-xs text-ink-3">Bacaan data</div>
        <div className="mt-2 text-sm text-ink-2">
          Belum ada paket terscan di periode ini, jadi tidak ada yang bisa dibaca.
        </div>
      </Card>
    );
  }

  const maxBar = Math.max(...daily.map((d) => d.parcels), 1);
  const puncak = daily.reduce((a, b) => (b.parcels > a.parcels ? b : a), daily[0]!);
  const terakhir = daily[daily.length - 1]!;
  /**
   * Six days fit their labels; thirty do not.
   *
   * Past ten bars only the ends and the peak keep a written date — the rest
   * would overlap into an unreadable smear, and the shape of the row is the
   * point anyway. Every bar still answers on hover.
   */
  const padat = daily.length > 10;
  const berlabel = (iso: string) =>
    !padat || iso === daily[0]!.date || iso === terakhir.date || iso === puncak.date;

  // Above ~1,5 the days clump instead of trickling, and one day stops
  // predicting the next. Worth saying in words, not just as a ratio.
  const menggumpal = rate.dispersion != null && rate.dispersion > 1.5;
  const kosong = span.windowDays - span.spanDays;

  const baris: { label: string; pct: number | null; n: number; catatan?: string }[] = [
    { label: "Isi paket", pct: coverage.itemsPct, n: coverage.withItems },
    {
      label: "Toko",
      pct: coverage.shopPct,
      n: coverage.withShop,
      catatan: "dipakai tabel Kesehatan Toko di bawah",
    },
    { label: "Marketplace", pct: coverage.marketplacePct, n: coverage.withMarketplace },
    { label: "Kurir", pct: coverage.courierPct, n: coverage.withCourier },
  ];

  const belum: string[] = [];
  if (span.spanDays < 28) {
    belum.push(
      `Tren naik/turun — perlu sekitar 4 minggu data, sekarang baru ${span.spanDays} hari.`,
    );
  }
  if (concentration.topTwoDistinguishable === false) {
    belum.push(
      "Toko mana yang paling laris — selisih dua teratas masih lebih kecil dari " +
        "goyangan acaknya sendiri, jadi urutannya belum berarti.",
    );
  }
  if ((coverage.courierPct ?? 0) < 50) {
    belum.push(
      `Perbandingan kurir — baru ${coverage.withCourier} dari ${coverage.scans} paket punya kurir.`,
    );
  }
  if ((coverage.shopPct ?? 0) < 80) {
    belum.push(
      `Angka per toko hanya melihat ${coverage.withShop} dari ${coverage.scans} paket ` +
        `(${coverage.shopPct}%). Sisanya belum dipetakan tokonya.`,
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-xs text-ink-3">Bacaan data</div>
        <div className="text-[11px] text-ink-3">
          {span.parcels} paket · {span.units} unit ·{" "}
          {span.firstDay ? hariPendek(span.firstDay) : "—"}
          {span.lastDay && span.lastDay !== span.firstDay
            ? ` – ${hariPendek(span.lastDay)}`
            : ""}{" "}
          ({span.spanDays} hari)
        </div>
      </div>

      <div className="mt-3 grid gap-5 lg:grid-cols-2">
        {/* --------------------------------------------------- laju */}
        <div>
          <div className="text-[11px] text-ink-3">Paket per hari, saat toko jalan</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums text-ink">
              {rate.parcelsPerDay}
            </span>
            {rate.parcelsPerDayLow != null && (
              <span className="text-sm tabular-nums text-ink-2">
                kemungkinan {rate.parcelsPerDayLow}–{rate.parcelsPerDayHigh}
              </span>
            )}
          </div>

          {/* Single series, single hue: no legend, the heading names it. Only
              the tallest and the newest bar carry a number; the rest answer
              on hover, so the row stays readable. */}
          <div className="mt-3 flex items-end gap-[2px]" role="img"
               aria-label={
                 `Paket per hari, ${daily.length} hari. ` +
                 `Tertinggi ${hariPendek(puncak.date)} ${puncak.parcels} paket, ` +
                 `terakhir ${hariPendek(terakhir.date)} ${terakhir.parcels} paket.`
               }>
            {daily.map((d) => (
              <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <span className="h-4 text-[10px] tabular-nums text-ink-2">
                  {d.date === puncak.date ||
                  d.date === terakhir.date ||
                  (puncak.date === terakhir.date && d.date === daily[0]!.date)
                    ? d.parcels
                    : ""}
                </span>
                <div
                  className="w-full rounded-t bg-brand"
                  style={{ height: `${Math.max(3, (d.parcels / maxBar) * 40)}px` }}
                  title={`${hariPendek(d.date)}: ${d.parcels} paket, ${d.units} unit`}
                />
                <span className="truncate text-[10px] text-ink-3">
                  {berlabel(d.date) ? hariPendek(d.date) : ""}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-3 text-xs text-ink-3">
            {menggumpal ? (
              <>
                Harian Anda <strong>tidak rata</strong> ({Math.min(...daily.map((d) => d.parcels))}–
                {maxBar} paket). Rentang di atas dihitung dari goyangan itu, bukan dari
                rata-ratanya saja — itu sebabnya lebar.
              </>
            ) : (
              <>Harian Anda cukup rata, jadi rata-rata di atas cukup bisa dipegang.</>
            )}
          </div>

          {rate.monthlyLow != null && (
            <div className="mt-2 text-xs text-ink-2">
              Kalau laju ini bertahan:{" "}
              <strong className="tabular-nums">
                {rate.monthlyLow}–{rate.monthlyHigh}
              </strong>{" "}
              paket per 30 hari (tengah {rate.monthlyMid}).{" "}
              {span.spanDays < 14 && (
                <span className="text-ink-3">
                  {span.spanDays} hari belum cukup untuk memastikan laju ini bertahan.
                </span>
              )}
            </div>
          )}

          {kosong > 0 && (
            <div className="mt-2 text-xs text-ink-3">
              Filter periode Anda {span.windowDays} hari, tapi datanya cuma {span.spanDays} hari.
              Kalau dibagi rata sepanjang filter, angkanya jadi{" "}
              <strong className="tabular-nums">{rate.parcelsPerWindowDay}</strong> paket/hari —
              itu bukan laju toko, itu {kosong} hari kosong yang ikut membagi.
            </div>
          )}
        </div>

        {/* ---------------------------------------------- kelengkapan */}
        <div>
          <div className="text-[11px] text-ink-3">
            Kelengkapan data — seberapa banyak paket yang punya isian ini
          </div>
          <div className="mt-2 space-y-2">
            {baris.map((b) => (
              <div key={b.label}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="text-ink-2">{b.label}</span>
                  <span className="tabular-nums text-ink-3">
                    {b.n}/{coverage.scans} · {b.pct ?? 0}%
                  </span>
                </div>
                {/* Magnitude, so one hue rather than a status colour per row:
                    the design system's red and amber sit at ΔE 3,6 under
                    deuteranopia and cannot carry the difference by themselves.
                    The number beside each bar does that instead. */}
                <div className="mt-1 h-1.5 w-full rounded-full bg-line">
                  <div
                    className="h-1.5 rounded-full bg-brand"
                    style={{ width: `${Math.max(1, b.pct ?? 0)}%` }}
                  />
                </div>
                {b.catatan && (
                  <div className="mt-0.5 text-[10px] text-ink-3">{b.catatan}</div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 text-[11px] text-ink-3">Ketergantungan</div>
          <div className="mt-1 space-y-1 text-xs text-ink-2">
            {concentration.topProductName && (
              <div>
                Produk teratas <strong>{concentration.topProductName}</strong> menyumbang{" "}
                <strong className="tabular-nums">{concentration.topProductSharePct}%</strong> unit.
              </div>
            )}
            {concentration.effectiveProducts != null && (
              <div>
                {concentration.distinctProducts} produk terjual, tapi sebarannya setara{" "}
                <strong className="tabular-nums">{concentration.effectiveProducts}</strong> produk
                — itu jumlah yang benar-benar menopang omzet.
              </div>
            )}
            {concentration.effectiveShops != null && concentration.mappedShops > 0 && (
              <div>
                {concentration.mappedShops} toko terpetakan, setara{" "}
                <strong className="tabular-nums">{concentration.effectiveShops}</strong> toko.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* The part a dashboard normally leaves out. Saying which questions the
          data cannot answer yet is what stops the ones it can answer from
          being read too confidently. */}
      {belum.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <div className="text-[11px] font-medium text-ink-2">
            Belum bisa disimpulkan dari data ini
          </div>
          <ul className="mt-1 space-y-1">
            {belum.map((b) => (
              <li key={b} className="flex gap-2 text-xs text-ink-3">
                <span aria-hidden="true">·</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

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
  /** Days this shop itself shipped on — context for the rate, not its divisor. */
  activeDays: number;
  parcelsPerDay: number | null;
  unitsPerDay: number | null;
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
    vsPublish: {
      publishValue: number;
      units: number;
      unitsNoPrice: number;
      unitsNoRecipe: number;
      productsMissingCost: number;
      plannedRecipe: number;
      plannedPacking: number;
      plannedPct: number | null;
      plannedRecipePct: number | null;
      plannedPackingPct: number | null;
      actualPct: number | null;
      gapPct: number | null;
      perProduct: {
        id: string;
        name: string;
        units: number;
        publishPrice: number;
        materialPerPcs: number;
        packingMaterialPerPcs: number;
        pct: number;
      }[];
      needsReview: {
        id: string;
        name: string;
        units: number;
        publishPrice: number;
        pct: number;
      }[];
      needsReviewCount: number;
    };
  };
  /** Days the per-day columns divide by: the span with data, not the filter. */
  rateDays: number | null;
  statistics: {
    span: {
      firstDay: string | null;
      lastDay: string | null;
      spanDays: number;
      activeDays: number;
      windowDays: number;
      parcels: number;
      units: number;
    };
    coverage: {
      scans: number;
      withShop: number;
      withCourier: number;
      withMarketplace: number;
      withItems: number;
      shopPct: number | null;
      courierPct: number | null;
      marketplacePct: number | null;
      itemsPct: number | null;
    };
    rate: {
      parcelsPerDay: number | null;
      parcelsPerDayLow: number | null;
      parcelsPerDayHigh: number | null;
      unitsPerDay: number | null;
      parcelsPerWindowDay: number | null;
      dispersion: number | null;
      monthlyLow: number | null;
      monthlyMid: number | null;
      monthlyHigh: number | null;
    };
    concentration: {
      topProductName: string | null;
      topProductSharePct: number | null;
      effectiveProducts: number | null;
      distinctProducts: number;
      effectiveShops: number | null;
      mappedShops: number;
      topTwoDistinguishable: boolean | null;
    };
    daily: { date: string; parcels: number; units: number }[];
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
  /** Which shop's parcels are open. The name travels so the title is not blank while loading. */
  const [lihatToko, setLihatToko] = useState<{
    id: string;
    name: string;
    marketplace: string | null;
  } | null>(null);

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

          {/* Above the rankings, not below them. "Busiest shop" and "top
              product" are read differently once you know they rest on 43% of
              parcels and six days -- and nobody scrolls down to find that out. */}
          <BacaanStatistik s={d.statistics} />

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

            {/* The same spend on the axis a seller actually budgets against.
                Two percentages side by side and nothing else: what the recipes
                say a shipped unit should eat, and what was really paid. The
                gap between them is the whole point of showing it. */}
            <div className="mt-4 border-t border-line pt-4">
              <PersenHargaPublish v={d.restock.vsPublish} />
            </div>
          </Card>

          {lihatToko && (
            <ShopDetailModal
              shopId={lihatToko.id}
              shopName={lihatToko.name}
              shopMarketplace={lihatToko.marketplace}
              from={from}
              to={to}
              onClose={() => setLihatToko(null)}
            />
          )}

          <Card padded={false}>
            <CardHeader
              title={`Kesehatan Toko (${d.shops.length})`}
              subtitle="Klik toko untuk melihat paketnya satu per satu. Status dari kapan terakhir toko ini mengirim paket; tren dibandingkan periode sebelumnya."
            />
            {/* Said once, above the table, because every "per hari" in it
                depends on this number and a reader who assumes the filter
                length would read every row three times too low. */}
            {d.rateDays != null && (
              <div className="px-4 pb-2 text-[11px] text-ink-3">
                Kolom <strong>Per hari</strong> dibagi {d.rateDays} hari — rentang yang
                benar-benar ada datanya, bukan panjang filter periode
                {d.statistics.span.windowDays !== d.rateDays
                  ? ` (${d.statistics.span.windowDays} hari)`
                  : ""}
                . Membaginya dengan panjang filter akan membuat setiap baris terlihat
                jauh lebih sepi daripada kenyataannya.
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-ink-3">
                    <th className="px-4 py-2 font-medium">Toko</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 text-right font-medium">Pencairan</th>
                    <th className="px-4 py-2 text-right font-medium">Tren</th>
                    <th className="px-4 py-2 text-right font-medium">Paket</th>
                    <th className="px-4 py-2 text-right font-medium">Per hari</th>
                    <th className="px-4 py-2 text-right font-medium">Per paket</th>
                    <th className="px-4 py-2 font-medium">Produk unggulan</th>
                  </tr>
                </thead>
                <tbody>
                  {d.shops.map((s) => (
                    <tr
                      key={s.id}
                      className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-canvas"
                      onClick={() =>
                        setLihatToko({ id: s.id, name: s.name, marketplace: s.marketplace })
                      }
                    >
                      <td className="px-4 py-2">
                        {/* A button, not just a clickable row: the row keeps the
                            pointer affordance, but the name is what a keyboard
                            reaches and what a screen reader announces. */}
                        <button
                          type="button"
                          className="text-left font-medium text-ink hover:text-brand hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLihatToko({ id: s.id, name: s.name, marketplace: s.marketplace });
                          }}
                        >
                          {s.name}
                        </button>
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
                      {/* Divided by the days the business was running, not by
                          the length of the filter -- a 30-day filter over 10
                          days of data would report a third of the real rate.
                          The shop's own active days sit underneath, because
                          three parcels over three days and three in one burst
                          average the same and mean different things. */}
                      <td className="px-4 py-2 text-right tabular-nums text-ink-2">
                        {s.parcelsPerDay != null && s.parcels > 0 ? (
                          <>
                            {s.parcelsPerDay} resi
                            <div className="text-[11px] text-ink-3">
                              {s.unitsPerDay} pcs
                            </div>
                            <div className="text-[10px] text-ink-3">
                              kirim {s.activeDays} hari
                            </div>
                          </>
                        ) : (
                          "—"
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
