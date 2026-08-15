import { rupiah } from "../lib/fmt";
import { Badge, Card, CardHeader, InlineAlert } from "./ui";

/**
 * Which shops earn their keep.
 *
 * The reasoning behind the shape, because it is not obvious and it decided
 * everything: payouts carry a shop on every row, scans carry one on about half.
 * So money can be ranked on and parcels cannot — "rupiah per parcel" divides a
 * complete numerator by a denominator missing 43% of its rows. There is
 * therefore no composite score: the rank is the money, and every other measure
 * is a qualifier that changes how the rank reads without quietly moving it.
 *
 * A shop has no HPP, so "worth it" cannot mean margin. What a shop costs is
 * attention, and that cost is roughly fixed per shop rather than per parcel —
 * which is why the rank is a level (what did this put in my pocket) and not a
 * rate.
 */

export interface ShopValue {
  spanDays: number;
  medianSeller: number;
  unmappedScans: number;
  totalScans: number;
  items: {
    shopId: string;
    name: string;
    marketplace: string | null;
    tier: "andalan" | "sehat" | "tipis" | "belumMenghasilkan" | "takTerlihat" | "vakum";
    sellerTake: number;
    credit: number;
    sellerPerDay: number;
    estimatedProfit: number;
    parcels: number;
    units: number;
    variety: number;
    activeDays: number;
    idleDays: number | null;
    sellerPerParcel: number | null;
    weakUnits: number;
    unpricedUnits: number;
    notes: string[];
  }[];
}

const TIER: Record<
  string,
  { label: string; tone: "success" | "info" | "warning" | "danger" | undefined }
> = {
  andalan: { label: "andalan", tone: "success" },
  sehat: { label: "sehat", tone: "info" },
  tipis: { label: "tipis", tone: "warning" },
  belumMenghasilkan: { label: "belum menghasilkan", tone: "danger" },
  takTerlihat: { label: "tidak terlihat", tone: "warning" },
  vakum: { label: "vakum", tone: undefined },
};

export function TokoWorth({ v }: { v: ShopValue }) {
  if (v.items.length === 0) {
    return (
      <Card padded={false}>
        <CardHeader title="Toko: mana yang worth it" subtitle="Belum ada toko terdaftar." />
      </Card>
    );
  }

  const perluDilihat = v.items.filter(
    (s) => s.tier === "belumMenghasilkan" || s.tier === "takTerlihat",
  );

  return (
    <Card padded={false}>
      <CardHeader
        title="Toko: mana yang worth it"
        subtitle={`Diurutkan dari uang yang benar-benar masuk ke seller selama ${v.spanDays} hari. Tengah katalog toko: ${rupiah(v.medianSeller)}.`}
      />

      <div className="space-y-3 px-4 pb-4">
        {/* The states that need doing something, lifted out of the ranking —
            they sit at the bottom by money and would be scrolled past. */}
        {perluDilihat.length > 0 && (
          <InlineAlert tone="warning">
            <strong>{perluDilihat.length} toko perlu diperiksa</strong> — bukan karena
            hasilnya kecil, tapi karena angkanya tidak masuk akal:{" "}
            {perluDilihat.map((s) => `${s.name} (${s.marketplace ?? "-"})`).join(", ")}.
          </InlineAlert>
        )}

        {v.items.map((s) => {
          const t = TIER[s.tier]!;
          return (
            <div key={s.shopId} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-ink">{s.name}</span>
                    <span className="text-[11px] text-ink-3">{s.marketplace ?? "—"}</span>
                    <Badge tone={t.tone}>{t.label}</Badge>
                  </div>
                  <div className="mt-0.5 text-[11px] tabular-nums text-ink-3">
                    {s.parcels} paket · {s.units} pcs · {s.variety} jenis · kirim{" "}
                    {s.activeDays} hari
                    {s.idleDays != null ? ` · terakhir ${s.idleDays} hari lalu` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold tabular-nums text-ink">
                    {rupiah(Math.round(s.sellerTake))}
                  </div>
                  <div className="text-[11px] tabular-nums text-ink-3">
                    {rupiah(s.sellerPerDay)}/hari
                    {s.sellerPerParcel != null && s.sellerTake > 0
                      ? ` · ${rupiah(s.sellerPerParcel)}/paket`
                      : ""}
                  </div>
                </div>
              </div>

              {/* The second money view, on the parcels' own calendar. Where the
                  two disagree, the disagreement is the finding. */}
              {s.parcels > 0 && (
                <div className="mt-1.5 text-[11px] text-ink-3">
                  Untung dari yang dikirim ≈{" "}
                  <strong className="text-ink-2">{rupiah(s.estimatedProfit)}</strong>{" "}
                  (dari resep &amp; harga publish, periode paket — beda kalender dengan
                  pencairan di atas)
                </div>
              )}

              {s.notes.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {s.notes.map((n) => (
                    <li key={n} className="flex gap-2 text-xs text-ink-2">
                      <span aria-hidden="true">·</span>
                      <span>{n}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        {/* Written out rather than assumed: the reader is entitled to know why
            the ranking is money alone, and what it is therefore blind to. */}
        <div className="rounded-lg border border-line p-3 text-[11px] text-ink-3">
          <div className="font-medium text-ink-2">Cara hitungnya</div>
          <p className="mt-1">
            Peringkatnya <strong>uang yang masuk ke seller</strong>, bukan skor gabungan.
            Alasannya ada di datanya: setiap baris pencairan punya toko, sedangkan cuma{" "}
            {v.totalScans - v.unmappedScans} dari {v.totalScans} paket yang punya toko.
            Menggabungkan keduanya jadi satu skor akan mencampur angka yang lengkap
            dengan angka yang bolong {Math.round((v.unmappedScans / Math.max(1, v.totalScans)) * 100)}%,
            dengan bobot yang harus saya karang sendiri.
          </p>
          <p className="mt-1">
            Toko tidak punya HPP, jadi “worth it” di sini bukan soal margin. Biaya sebuah
            toko adalah <strong>perhatian</strong> — listing, pesanan, akun yang harus
            dijaga — dan biaya itu hampir tetap per toko, bukan per paket. Karena itu
            yang diperingkat adalah jumlah, bukan laju: pertanyaannya “cukupkah hasilnya
            untuk membenarkan toko ini ada”.
          </p>
          <p className="mt-1">
            Sisanya keterangan yang bisa mengubah bacaan tanpa menggeser peringkat:
            hasil per paket, sebaran jenis produk, kemandekan, mutu produk yang dijual,
            dan untung yang tersirat dari barang yang benar-benar dikirim.
          </p>
        </div>
      </div>
    </Card>
  );
}
