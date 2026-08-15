import { rupiah } from "../lib/fmt";

/**
 * Where the publish price goes, as a donut.
 *
 * Part-to-whole at a glance, which is the one job a donut does well. Every
 * exact figure lives in the waterfall beside it, so nothing here is the only
 * way to read a number — a chart that gates its values behind a shape is worse
 * than a table.
 *
 * Six segments at most, because past that adjacent slices blur and the reader
 * stops being able to tell which is bigger. The publish price splits eight
 * ways, so the five largest keep their names and the rest fold into "Lainnya";
 * net profit always keeps its own segment however small, because it is the
 * thing being asked about.
 *
 * Colour follows the ENTITY, not the rank. Sorting by size changes which
 * segments appear and in what order, never what colour a component wears — a
 * reader who learned that orange is HPP would otherwise be misled the moment a
 * rate changed.
 */

/** Fixed slot per component, from a validated categorical palette. */
const HUE: Record<string, string> = {
  untung: "#2a78d6",
  hpp: "#eb6834",
  marketplace: "#1baf7a",
  reseller: "#eda100",
  sedekah: "#e87ba4",
  event: "#008300",
  affiliator: "#4a3aa7",
  iklan: "#e34948",
  lainnya: "#8b8a85",
};

interface Bagian {
  key: string;
  label: string;
  cents: number;
}

export function KomposisiHarga({
  live,
  rates,
}: {
  live: {
    publishPriceCents: number;
    marketplaceFeeCents: number;
    eventCents: number;
    affiliatorCents: number;
    sedekahCents: number;
    resellerCents: number;
    hppCents: number;
    adsCents: number;
    netProfitCents: number;
    netMarginRate: number;
  };
  /** The raw rate inputs, which the page keeps as strings while being typed. */
  rates: Record<string, string | number>;
}) {
  const rugi = live.netProfitCents < 0;

  const semua: Bagian[] = [
    { key: "hpp", label: "Harga Pokok Produksi", cents: live.hppCents },
    {
      key: "marketplace",
      label: `Biaya Marketplace ${rates.marketplaceFeeRate || 0}%`,
      cents: live.marketplaceFeeCents,
    },
    {
      key: "reseller",
      label: `Reseller / Sub-seller ${rates.resellerRate || 0}%`,
      cents: live.resellerCents,
    },
    { key: "sedekah", label: `Sedekah ${rates.sedekahRate || 0}%`, cents: live.sedekahCents },
    { key: "event", label: `Biaya Event ${rates.eventRate || 0}%`, cents: live.eventCents },
    {
      key: "affiliator",
      label: `Biaya Affiliator ${rates.affiliatorRate || 0}%`,
      cents: live.affiliatorCents,
    },
    { key: "iklan", label: "Biaya Iklan", cents: live.adsCents },
  ].filter((b) => b.cents > 0);

  // A negative profit cannot be a slice of anything, so it leaves the ring and
  // is stated in words instead: the costs simply outrun the price.
  const untung: Bagian | null = rugi
    ? null
    : { key: "untung", label: "Untung bersih", cents: live.netProfitCents };

  const biayaUrut = [...semua].sort((a, b) => b.cents - a.cents);
  const sisaSlot = untung ? 4 : 5;
  const utama = biayaUrut.slice(0, sisaSlot);
  const ekor = biayaUrut.slice(sisaSlot);
  const lainnya = ekor.reduce((n, b) => n + b.cents, 0);

  const irisan: Bagian[] = [
    ...(untung ? [untung] : []),
    ...utama,
    ...(lainnya > 0 ? [{ key: "lainnya", label: `Lainnya (${ekor.length} pos)`, cents: lainnya }] : []),
  ];
  const total = irisan.reduce((n, b) => n + b.cents, 0);
  if (total <= 0) return null;

  const R = 58;
  const C = 2 * Math.PI * R;
  let jalan = 0;
  const arcs = irisan.map((b) => {
    const share = b.cents / total;
    const panjang = share * C;
    const arc = {
      ...b,
      share,
      // A 2px surface gap between fills, per the mark spec — never a border.
      dash: Math.max(0.5, panjang - 2),
      sisa: C - Math.max(0.5, panjang - 2),
      offset: -jalan,
    };
    jalan += panjang;
    return arc;
  });

  const terbesarBiaya = biayaUrut[0];
  const persen = (c: number) => Math.round((c / total) * 1000) / 10;

  return (
    <div className="rounded-lg border border-line p-4">
      <div className="text-sm font-medium text-ink">Komposisi harga publish</div>
      <div className="mt-0.5 text-xs text-ink-3">
        Ke mana perginya setiap rupiah dari {rupiah(Math.round(live.publishPriceCents / 100))}.
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-5">
        <div className="relative shrink-0">
          <svg width="150" height="150" viewBox="0 0 150 150" role="img"
               aria-label={`Komposisi harga publish: ${irisan
                 .map((b) => `${b.label} ${persen(b.cents)}%`)
                 .join(", ")}`}>
            <g transform="rotate(-90 75 75)">
              {arcs.map((a) => (
                <circle
                  key={a.key}
                  cx="75"
                  cy="75"
                  r={R}
                  fill="none"
                  stroke={HUE[a.key] ?? HUE.lainnya}
                  strokeWidth="20"
                  strokeDasharray={`${a.dash} ${a.sisa}`}
                  strokeDashoffset={a.offset}
                >
                  <title>{`${a.label}: ${rupiah(Math.round(a.cents / 100))} (${persen(a.cents)}%)`}</title>
                </circle>
              ))}
            </g>
          </svg>

          {/* The bottom line sits in the hole, which is the whole reason a
              donut is used here rather than a pie. */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-[10px] text-ink-3">Untung bersih</div>
            <div
              className={`text-base font-semibold ${rugi ? "text-red-600" : "text-ink"}`}
            >
              {rupiah(Math.round(live.netProfitCents / 100))}
            </div>
            <div className="text-[10px] text-ink-3">
              {(live.netMarginRate * 100).toFixed(1)}%
            </div>
          </div>
        </div>

        {/* The legend carries every value, so the ring never gates a number. */}
        <ul className="min-w-[190px] flex-1 space-y-1">
          {irisan.map((b) => (
            <li key={b.key} className="flex items-center gap-2 text-xs">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: HUE[b.key] ?? HUE.lainnya }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-ink-2">{b.label}</span>
              <span className="shrink-0 tabular-nums text-ink-3">{persen(b.cents)}%</span>
              <span className="shrink-0 tabular-nums text-ink">
                {rupiah(Math.round(b.cents / 100))}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* The question the chart exists to answer, answered in words as well —
          a shape should not be the only way to get it. */}
      {terbesarBiaya && (
        <div className="mt-3 text-xs text-ink-2">
          Potongan terbesar: <strong>{terbesarBiaya.label}</strong> —{" "}
          {rupiah(Math.round(terbesarBiaya.cents / 100))} ({persen(terbesarBiaya.cents)}% dari
          harga publish).
        </div>
      )}

      {rugi && (
        <div className="mt-2 text-xs text-red-600">
          Untungnya minus, jadi tidak bisa jadi irisan — lingkaran di atas cuma
          menggambarkan biayanya, dan biaya itu melebihi harga publishnya.
        </div>
      )}

      {ekor.length > 0 && (
        <div className="mt-2 text-[11px] text-ink-3">
          “Lainnya” menggabungkan {ekor.map((b) => b.label).join(", ")} — dipisah supaya
          irisannya tidak lebih dari enam, karena lewat itu potongan yang bersebelahan
          jadi sulit dibedakan. Angka persisnya ada di rincian di bawah.
        </div>
      )}
    </div>
  );
}
