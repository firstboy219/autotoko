import { rupiah } from "../lib/fmt";
import { Badge, Card, CardHeader, InlineAlert } from "./ui";

/**
 * Products that are not paying their way, and on which axis.
 *
 * Reasons, not a score. Four different things get called "not worth it" and
 * they need different fixes: a thin margin is repriced, a product nobody buys
 * is dropped or promoted, stock locked to one product is a restocking problem.
 * Summing them into one number would rank products against each other and
 * explain none of it.
 */

export interface ProductHealth {
  days: number;
  medianSold: number;
  judged: number;
  unjudged: { id: string; name: string; soldQty: number; alasan: string }[];
  items: {
    id: string;
    name: string;
    sku: string | null;
    soldQty: number;
    publishPrice: number | null;
    hpp: number;
    netProfit: number | null;
    netMarginRate: number | null;
    exclusiveMaterials: number;
    lockedStockValue: number;
    flags: string[];
    reasons: string[];
  }[];
  totalFlagged: number;
  lockedTotal: number;
  lockedButSelling: {
    id: string;
    name: string;
    soldQty: number;
    exclusiveMaterials: number;
    lockedStockValue: number;
    names: string[];
  }[];
  byShop: { shopId: string; items: { id: string; name: string; units: number; flags: string[] }[] }[];
}

/** Short label per reason, so the badges read at a glance. */
export const FLAG_LABEL: Record<string, string> = {
  rugi: "rugi",
  marginTipis: "margin tipis",
  tidakLaku: "belum laku",
  jarangLaku: "jarang laku",
  bahanTerkunci: "bahan terkunci",
  hargaTinggi: "harga tinggi",
  hppRagu: "HPP belum pasti",
};

const TONE: Record<string, "danger" | "warning" | "info"> = {
  rugi: "danger",
  marginTipis: "warning",
  tidakLaku: "warning",
  jarangLaku: "info",
  bahanTerkunci: "info",
  hargaTinggi: "warning",
  hppRagu: "info",
};

export function ProdukLemah({
  h,
  spanDays,
}: {
  h: ProductHealth;
  /** Days that actually have data — what "belum laku" can really claim. */
  spanDays: number;
}) {
  const belumBisa = h.unjudged.length;

  return (
    <Card padded={false}>
      <CardHeader
        title="Produk yang kurang worth it"
        subtitle={`Dinilai dari empat sisi: margin, penjualan, bahan yang terkunci, dan harga. ${h.totalFlagged} dari ${h.judged} produk yang bisa dinilai.`}
      />

      <div className="space-y-3 px-4 pb-4">
        {/* The biggest finding on this data is not a weak product, it is how
            few products can be judged at all. Said first, because a list of
            three problems out of ten looks reassuring until you know that
            eighteen were never examined. */}
        {belumBisa > 0 && (
          <InlineAlert tone="warning">
            <strong>{belumBisa} produk belum bisa dinilai</strong> — {h.unjudged[0]?.alasan}
            {belumBisa > 1 ? " dan sejenisnya" : ""}. Selama harga publish kosong, margin
            dan kemahalan tidak bisa dihitung sama sekali, jadi produk-produk itu tidak
            masuk daftar di bawah — bukan berarti sehat.
            <div className="mt-1 text-[11px]">
              {h.unjudged.slice(0, 8).map((u) => u.name).join(", ")}
              {belumBisa > 8 ? `, dan ${belumBisa - 8} lainnya` : ""}.
            </div>
          </InlineAlert>
        )}

        {h.items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-ink-3">
            Tidak ada produk yang bermasalah di lebih dari satu sisi. Untuk data
            sependek ini, itu berarti belum ada yang menonjol — bukan bahwa semuanya
            sudah optimal.
          </div>
        ) : (
          h.items.map((p) => (
            <div key={p.id} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-ink">{p.name}</div>
                  <div className="mt-0.5 text-[11px] tabular-nums text-ink-3">
                    {p.publishPrice != null ? rupiah(p.publishPrice) : "—"} · HPP{" "}
                    {rupiah(p.hpp)} ·{" "}
                    {p.netMarginRate != null
                      ? `margin ${Math.round(p.netMarginRate * 1000) / 10}%`
                      : "margin —"}{" "}
                    · {p.soldQty} pcs terkirim
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {p.flags.map((f) => (
                    <Badge key={f} tone={TONE[f] ?? "info"}>
                      {FLAG_LABEL[f] ?? f}
                    </Badge>
                  ))}
                </div>
              </div>

              <ul className="mt-2 space-y-0.5">
                {p.reasons.map((r) => (
                  <li key={r} className="flex gap-2 text-xs text-ink-2">
                    <span aria-hidden="true">·</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}

        {/* Hedged on purpose: with a short span, "has not sold" is a fact about
            the calendar as much as about the product. */}
        <div className="text-[11px] text-ink-3">
          Penjualan dibandingkan dengan tengah katalog ({h.medianSold} pcs dalam{" "}
          {h.days} hari). Datanya baru {spanDays} hari, jadi “belum laku” berarti
          <strong> belum terjual</strong>, bukan terbukti tidak laku — margin dan bahan
          terkunci tidak tergantung lamanya data, dua itu bisa dipegang sekarang.
        </div>

        {h.lockedButSelling.length > 0 && (
          <div className="rounded-lg border border-line p-3">
            <div className="text-xs font-medium text-ink-2">
              Bahan terkunci pada produk yang laku
            </div>
            <div className="mt-0.5 text-[11px] text-ink-3">
              Bukan masalah — stoknya berputar. Tapi restock bahan ini tidak bisa
              dibagi ke produk lain, jadi tetap perlu diketahui.
            </div>
            <ul className="mt-2 space-y-1">
              {h.lockedButSelling.map((p) => (
                <li key={p.id} className="text-xs text-ink-2">
                  <span className="text-ink">{p.name}</span> ({p.soldQty} pcs) —{" "}
                  {p.exclusiveMaterials} bahan khusus
                  {p.lockedStockValue > 0 ? `, stok ${rupiah(p.lockedStockValue)}` : ""}:{" "}
                  <span className="text-ink-3">{p.names.join(", ")}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
