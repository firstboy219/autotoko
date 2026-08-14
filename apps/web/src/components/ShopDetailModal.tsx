import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { rupiah } from "../lib/fmt";
import { Badge, InlineAlert, Modal } from "./ui";

/**
 * One shop, parcel by parcel.
 *
 * The health table answers "which shops are moving". This answers "moving
 * what, and when" — and that one cannot be summarised, because the reason to
 * open it is to check individual parcels against the marketplace's own order
 * list. So the parcels are listed rather than counted, newest first, with the
 * time on each.
 */

interface Item {
  name: string;
  qty: number;
  /** True when nothing was mapped and this is the raw OCR text. */
  guessed: boolean;
}

interface Scan {
  id: string;
  resi: string;
  scannedAt: string;
  courier: string | null;
  courierConfirmed: boolean;
  marketplace: string | null;
  photoUrl: string | null;
  mappingConfirmed: boolean;
  itemsConfirmed: boolean;
  recipient: string | null;
  recipientArea: string | null;
  service: string | null;
  weightKg: number | null;
  cod: boolean | null;
  items: Item[];
  units: number;
}

interface Detail {
  shop: {
    id: string;
    name: string;
    marketplace: string | null;
    categoryName: string | null;
  };
  range: { from: string; to: string };
  totals: {
    parcels: number;
    units: number;
    credit: number;
    seller: number;
    subSeller: number;
    unconfirmedItems: number;
  };
  scans: Scan[];
  payouts: {
    payoutDate: string;
    credit: number;
    seller: number;
    subSeller: number;
    rows: number;
  }[];
  unmappedInWindow: number;
}

function jam(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}

function tanggal(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function ShopDetailModal({
  shopId,
  shopName,
  from,
  to,
  onClose,
}: {
  shopId: string;
  shopName: string;
  from?: string;
  to?: string;
  onClose: () => void;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"paket" | "pencairan">("paket");

  useEffect(() => {
    let alive = true;
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    api
      .get<Detail>(`/dashboard/shop-insights/${shopId}?${qs.toString()}`)
      .then((r) => alive && setD(r))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [shopId, from, to]);

  return (
    <Modal open onClose={onClose} title={shopName} width="max-w-4xl">
      {!d ? (
        <div className="py-8 text-center text-sm text-ink-3">{err ?? "Memuat…"}</div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
            {d.shop.marketplace && <Badge tone="info">{d.shop.marketplace}</Badge>}
            {d.shop.categoryName && <Badge>{d.shop.categoryName}</Badge>}
            <span>
              {tanggal(d.range.from)} – {tanggal(d.range.to)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { l: "Paket", v: String(d.totals.parcels) },
              { l: "Unit", v: String(d.totals.units) },
              { l: "Pencairan", v: rupiah(d.totals.credit) },
              { l: "Bagian seller", v: rupiah(d.totals.seller) },
            ].map((x) => (
              <div key={x.l} className="rounded-lg border border-line p-2">
                <div className="text-[11px] text-ink-3">{x.l}</div>
                <div className="mt-0.5 font-semibold tabular-nums text-ink">{x.v}</div>
              </div>
            ))}
          </div>

          {/* Said before the list is compared against anything. A parcel with
              no shop mapped cannot appear here, so a list that looks short may
              be a mapping gap rather than a quiet week. */}
          {d.unmappedInWindow > 0 && (
            <InlineAlert tone="warning">
              Ada {d.unmappedInWindow} paket di periode ini yang belum dipetakan ke toko
              manapun. Sebagiannya mungkin milik toko ini, jadi daftar di bawah belum
              tentu lengkap. Lengkapi lewat menu Data Belum Lengkap.
            </InlineAlert>
          )}

          <div className="flex gap-1 border-b border-line">
            {(["paket", "pencairan"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-medium ${
                  tab === t
                    ? "border-brand text-ink"
                    : "border-transparent text-ink-3 hover:text-ink-2"
                }`}
              >
                {t === "paket" ? `Paket (${d.scans.length})` : `Pencairan (${d.payouts.length})`}
              </button>
            ))}
          </div>

          {tab === "paket" ? (
            d.scans.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-ink-3">
                Belum ada paket terscan untuk toko ini di periode yang dipilih.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-ink-3">
                      <th className="py-2 pr-3 font-medium">Waktu scan</th>
                      <th className="py-2 pr-3 font-medium">Resi</th>
                      <th className="py-2 pr-3 font-medium">Kurir</th>
                      <th className="py-2 pr-3 font-medium">Isi paket</th>
                      <th className="py-2 pr-3 text-right font-medium">Unit</th>
                      <th className="py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.scans.map((s) => (
                      <tr key={s.id} className="border-b border-line/60 align-top last:border-0">
                        <td className="py-2 pr-3 whitespace-nowrap text-ink-2">
                          {jam(s.scannedAt)}
                        </td>
                        <td className="py-2 pr-3">
                          <span className="font-mono text-[11px] text-ink">{s.resi}</span>
                          {s.recipient && (
                            <div className="text-[11px] text-ink-3">
                              {s.recipient}
                              {s.recipientArea ? ` · ${s.recipientArea}` : ""}
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap text-ink-2">
                          {s.courier ?? "—"}
                          {/* A guess and a confirmation are different claims. */}
                          {s.courier && !s.courierConfirmed && (
                            <div className="text-[10px] text-ink-3">tebakan OCR</div>
                          )}
                          {s.service && <div className="text-[10px] text-ink-3">{s.service}</div>}
                        </td>
                        <td className="py-2 pr-3">
                          {s.items.length === 0 ? (
                            <span className="text-ink-3">—</span>
                          ) : (
                            <ul className="space-y-0.5">
                              {s.items.map((i, n) => (
                                <li key={n} className="text-ink">
                                  {i.name}
                                  <span className="text-ink-3"> ×{i.qty}</span>
                                  {i.guessed && (
                                    <span className="ml-1 text-[10px] text-ink-3">
                                      (belum dipetakan)
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-ink-2">
                          {s.units}
                        </td>
                        <td className="py-2">
                          <div className="flex flex-wrap gap-1">
                            {s.itemsConfirmed ? (
                              <Badge tone="success">isi ok</Badge>
                            ) : (
                              <Badge tone="warning">isi belum</Badge>
                            )}
                            {s.cod && <Badge tone="warning">COD</Badge>}
                            {s.photoUrl && (
                              <a
                                href={s.photoUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] text-brand hover:underline"
                              >
                                foto
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : d.payouts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-ink-3">
              Belum ada pencairan tercatat untuk toko ini di periode yang dipilih.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-ink-3">
                    <th className="py-2 pr-3 font-medium">Tanggal</th>
                    <th className="py-2 pr-3 text-right font-medium">Pencairan</th>
                    <th className="py-2 pr-3 text-right font-medium">Seller</th>
                    <th className="py-2 pr-3 text-right font-medium">Sub-seller</th>
                    <th className="py-2 text-right font-medium">Baris</th>
                  </tr>
                </thead>
                <tbody>
                  {d.payouts.map((p) => (
                    <tr key={p.payoutDate} className="border-b border-line/60 last:border-0">
                      <td className="py-2 pr-3 whitespace-nowrap text-ink-2">
                        {tanggal(p.payoutDate)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink">
                        {rupiah(p.credit)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink-2">
                        {rupiah(p.seller)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink-2">
                        {rupiah(p.subSeller)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-ink-3">{p.rows}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2 text-[11px] text-ink-3">
                Pencairan dicatat per tanggal cair, bukan per tanggal kirim — jadi
                tanggalnya tidak sejajar dengan waktu scan di tab sebelah.
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
