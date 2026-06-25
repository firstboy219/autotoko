import { useCallback, useMemo, useState, type MouseEvent } from "react";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { useRealtime } from "../lib/realtime";
import { api } from "../lib/api";
import { rupiah, dateShort } from "../lib/fmt";

interface Order {
  id: string;
  marketplace: string;
  marketplaceOrderId: string;
  status: string | null;
  fulfillmentStatus: string;
  buyerName: string | null;
  totalAmount: string | null;
  platformFee: string | null;
  feeDeducted: boolean;
  createdAt: string;
}

const MP_COLORS: Record<string, string> = {
  tiktok: "bg-black text-white",
  shopee: "bg-orange-100 text-orange-700",
  tokopedia: "bg-green-100 text-green-700",
  lazada: "bg-blue-100 text-blue-700",
};

// Internal fulfillment workflow (ordered) + side states.
const FLOW = ["masuk", "approved", "produksi", "packing", "siap_kirim", "dikirim", "selesai"] as const;
const SIDE = ["retur", "dibatalkan"] as const;
const ALL_FS = [...FLOW, ...SIDE];
const FS_LABEL: Record<string, string> = {
  masuk: "Masuk", approved: "Disetujui", produksi: "Produksi", packing: "Packing",
  siap_kirim: "Siap Kirim", dikirim: "Dikirim", selesai: "Selesai",
  retur: "Retur", dibatalkan: "Dibatalkan",
};
const FS_COLOR: Record<string, string> = {
  masuk: "bg-slate-100 text-slate-700", approved: "bg-blue-100 text-blue-700",
  produksi: "bg-indigo-100 text-indigo-700", packing: "bg-violet-100 text-violet-700",
  siap_kirim: "bg-amber-100 text-amber-700", dikirim: "bg-cyan-100 text-cyan-700",
  selesai: "bg-green-100 text-green-700", retur: "bg-rose-100 text-rose-700",
  dibatalkan: "bg-red-100 text-red-700",
};

const PAGE_SIZE = 15;

type ViewMode = "tabel" | "kanban";

export function Orders() {
  const { data, loading, reload } = useFetch<Order[]>("/orders");
  useRealtime(useCallback(() => reload(), [reload]));
  const [view, setView] = useState<ViewMode>("tabel");
  const [q, setQ] = useState("");
  const [mp, setMp] = useState("");
  const [fs, setFs] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Order | null>(null);

  const all = data ?? [];
  const marketplaces = useMemo(() => [...new Set(all.map((o) => o.marketplace))], [all]);

  // Shared search + marketplace filter for both views. The fulfillment-status
  // dropdown only applies to the table view (each Kanban column is a status).
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((o) => {
      if (mp && o.marketplace !== mp) return false;
      if (view === "tabel" && fs && o.fulfillmentStatus !== fs) return false;
      if (needle) {
        const hay = `${o.marketplaceOrderId} ${o.buyerName ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [all, q, mp, fs, view]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const rows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const selClass = "px-3 py-2 rounded-md border border-slate-200 text-sm bg-white";

  // Keep the live modal order in sync with reloaded data so the board reflects moves.
  const liveSelected = selected && (all.find((o) => o.id === selected.id) ?? selected);

  async function moveStatus(order: Order, status: string) {
    await api.patch<Order>(`/orders/${order.id}/status`, { status });
    reload();
  }

  const tabBtn = (mode: ViewMode, label: string) =>
    `px-3 py-2 rounded-md text-sm font-semibold border ${
      view === mode ? "bg-brand text-white border-brand" : "bg-white text-slate-600 border-slate-200"
    }`;

  return (
    <Layout title="Orders">
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="flex gap-1">
          <button className={tabBtn("tabel", "Tabel")} onClick={() => setView("tabel")}>Tabel</button>
          <button className={tabBtn("kanban", "Kanban")} onClick={() => setView("kanban")}>Kanban</button>
        </div>
        <input
          className="flex-1 min-w-[180px] px-3 py-2 rounded-md border border-slate-200 text-sm"
          placeholder="Cari order ID / pembeli…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(0); }}
        />
        <select className={selClass} value={mp} onChange={(e) => { setMp(e.target.value); setPage(0); }}>
          <option value="">Semua marketplace</option>
          {marketplaces.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        {view === "tabel" && (
          <select className={selClass} value={fs} onChange={(e) => { setFs(e.target.value); setPage(0); }}>
            <option value="">Semua status</option>
            {ALL_FS.map((s) => <option key={s} value={s}>{FS_LABEL[s]}</option>)}
          </select>
        )}
      </div>

      {view === "kanban" ? (
        <KanbanBoard
          orders={filtered}
          loading={loading}
          onSelect={setSelected}
          onMove={moveStatus}
        />
      ) : (
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-[10px] uppercase text-slate-500">
              <th className="text-left px-3 py-2">Order</th>
              <th className="text-left px-3 py-2">MP</th>
              <th className="text-left px-3 py-2">Status Proses</th>
              <th className="text-left px-3 py-2">Pembeli</th>
              <th className="text-right px-3 py-2">Total</th>
              <th className="text-right px-3 py-2">Fee</th>
              <th className="text-left px-3 py-2">Waktu</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">Memuat…</td></tr>
            ) : !rows.length ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">Tidak ada order yang cocok.</td></tr>
            ) : (
              rows.map((o) => (
                <tr key={o.id} className="border-t border-slate-100 cursor-pointer hover:bg-slate-50" onClick={() => setSelected(o)}>
                  <td className="px-3 py-2 font-mono text-[11px]">{o.marketplaceOrderId}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded capitalize ${MP_COLORS[o.marketplace] ?? "bg-slate-100 text-slate-600"}`}>{o.marketplace}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${FS_COLOR[o.fulfillmentStatus] ?? "bg-slate-100 text-slate-600"}`}>
                      {FS_LABEL[o.fulfillmentStatus] ?? o.fulfillmentStatus}
                    </span>
                  </td>
                  <td className="px-3 py-2">{o.buyerName ?? "-"}</td>
                  <td className="px-3 py-2 text-right">{rupiah(o.totalAmount)}</td>
                  <td className="px-3 py-2 text-right">
                    {o.feeDeducted ? rupiah(o.platformFee) : <span className="text-amber-600 text-[11px]">pending</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{dateShort(o.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      )}

      {view === "tabel" && filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-3 text-sm">
          <div className="text-slate-500">{filtered.length} order · hal {safePage + 1}/{pages}</div>
          <div className="flex gap-2">
            <button disabled={safePage === 0} onClick={() => setPage(safePage - 1)} className="px-3 py-1.5 rounded-md border border-slate-200 disabled:opacity-40">←</button>
            <button disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)} className="px-3 py-1.5 rounded-md border border-slate-200 disabled:opacity-40">→</button>
          </div>
        </div>
      )}

      {liveSelected && (
        <OrderDetail
          order={liveSelected}
          onClose={() => setSelected(null)}
          onChanged={(updated) => { setSelected(updated); reload(); }}
        />
      )}
    </Layout>
  );
}

// Kanban: one column per FLOW status, with the two SIDE states appended at the end.
const KANBAN_COLUMNS = [...FLOW, ...SIDE];

function KanbanBoard({
  orders,
  loading,
  onSelect,
  onMove,
}: {
  orders: Order[];
  loading: boolean;
  onSelect: (o: Order) => void;
  onMove: (o: Order, status: string) => void | Promise<void>;
}) {
  const byStatus = useMemo(() => {
    const map: Record<string, Order[]> = {};
    for (const s of KANBAN_COLUMNS) map[s] = [];
    for (const o of orders) (map[o.fulfillmentStatus] ??= []).push(o);
    return map;
  }, [orders]);

  if (loading) return <div className="py-6 text-center text-slate-400">Memuat…</div>;

  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {KANBAN_COLUMNS.map((s) => {
        const items = byStatus[s] ?? [];
        return (
          <div key={s} className="flex-shrink-0 w-64 bg-slate-50 rounded-xl border border-slate-200 flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200">
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${FS_COLOR[s] ?? "bg-slate-100 text-slate-600"}`}>
                {FS_LABEL[s] ?? s}
              </span>
              <span className="text-[11px] font-semibold text-slate-400">{items.length}</span>
            </div>
            <div className="p-2 flex flex-col gap-2 min-h-[60px]">
              {items.length === 0 ? (
                <div className="text-[11px] text-slate-300 text-center py-3">—</div>
              ) : (
                items.map((o) => <KanbanCard key={o.id} order={o} onSelect={onSelect} onMove={onMove} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard({
  order,
  onSelect,
  onMove,
}: {
  order: Order;
  onSelect: (o: Order) => void;
  onMove: (o: Order, status: string) => void | Promise<void>;
}) {
  const idx = FLOW.indexOf(order.fulfillmentStatus as (typeof FLOW)[number]);
  const prev = idx > 0 ? FLOW[idx - 1] : null;
  const next = idx >= 0 && idx < FLOW.length - 1 ? FLOW[idx + 1] : null;

  const move = (status: string) => async (e: MouseEvent) => {
    e.stopPropagation();
    await onMove(order, status);
  };

  return (
    <div
      className="bg-white rounded-lg border border-slate-200 p-2.5 cursor-pointer hover:border-brand hover:shadow-sm"
      onClick={() => onSelect(order)}
    >
      <div className="flex items-center justify-between mb-1">
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded capitalize ${MP_COLORS[order.marketplace] ?? "bg-slate-100 text-slate-600"}`}>
          {order.marketplace}
        </span>
        <span className="font-mono text-[10px] text-slate-400">{order.marketplaceOrderId}</span>
      </div>
      <div className="text-sm font-medium truncate">{order.buyerName ?? "-"}</div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-xs font-semibold">{rupiah(order.totalAmount)}</span>
        <span className="text-[10px] text-slate-400">{dateShort(order.createdAt)}</span>
      </div>
      {(prev || next) && (
        <div className="flex gap-1 mt-2">
          {prev ? (
            <button
              onClick={move(prev)}
              title={`Kembali ke ${FS_LABEL[prev]}`}
              className="flex-1 px-2 py-1 rounded border border-slate-200 text-[11px] text-slate-500 hover:bg-slate-50"
            >◀</button>
          ) : <span className="flex-1" />}
          {next ? (
            <button
              onClick={move(next)}
              title={`Lanjut ke ${FS_LABEL[next]}`}
              className="flex-1 px-2 py-1 rounded border border-slate-200 text-[11px] text-brand hover:bg-slate-50"
            >▶</button>
          ) : <span className="flex-1" />}
        </div>
      )}
    </div>
  );
}

function OrderDetail({ order, onClose, onChanged }: { order: Order; onClose: () => void; onChanged: (o: Order) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const idx = FLOW.indexOf(order.fulfillmentStatus as (typeof FLOW)[number]);
  const next = idx >= 0 && idx < FLOW.length - 1 ? FLOW[idx + 1] : null;

  async function setStatus(status: string) {
    if ((status === "dibatalkan" || status === "retur") && !confirm(`Ubah status ke "${FS_LABEL[status]}"?`)) return;
    setBusy(true); setErr(null);
    try {
      const updated = await api.patch<Order>(`/orders/${order.id}/status`, { status });
      onChanged(updated);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-[460px] max-w-full p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="font-bold">Detail Order</div>
            <div className="font-mono text-[11px] text-slate-400">{order.marketplaceOrderId}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button>
        </div>

        <dl className="text-sm divide-y divide-slate-100 mb-4">
          {[
            ["Marketplace", order.marketplace],
            ["Status marketplace", order.status ?? "-"],
            ["Pembeli", order.buyerName ?? "-"],
            ["Total", rupiah(order.totalAmount)],
            ["Fee platform", order.feeDeducted ? rupiah(order.platformFee) : "pending"],
            ["Waktu", dateShort(order.createdAt)],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between py-2">
              <dt className="text-slate-500">{k}</dt>
              <dd className="font-semibold capitalize">{v}</dd>
            </div>
          ))}
        </dl>

        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500">Status proses</span>
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${FS_COLOR[order.fulfillmentStatus]}`}>
              {FS_LABEL[order.fulfillmentStatus] ?? order.fulfillmentStatus}
            </span>
          </div>

          <div className="flex flex-wrap gap-2 mb-2">
            {order.fulfillmentStatus === "masuk" && (
              <>
                <button onClick={() => setStatus("approved")} disabled={busy} className="px-3 py-1.5 rounded-md bg-green-600 text-white text-xs font-semibold disabled:opacity-50">Setujui</button>
                <button onClick={() => setStatus("dibatalkan")} disabled={busy} className="px-3 py-1.5 rounded-md bg-red-600 text-white text-xs font-semibold disabled:opacity-50">Tolak</button>
              </>
            )}
            {next && order.fulfillmentStatus !== "masuk" && (
              <button onClick={() => setStatus(next)} disabled={busy} className="px-3 py-1.5 rounded-md bg-brand text-white text-xs font-semibold disabled:opacity-50">
                Lanjut → {FS_LABEL[next]}
              </button>
            )}
          </div>

          <label className="block text-[11px] text-slate-500 mb-1">Ubah manual ke status apa pun</label>
          <select
            className="w-full px-3 py-2 rounded-md border border-slate-200 text-sm bg-white disabled:opacity-50"
            value={order.fulfillmentStatus}
            disabled={busy}
            onChange={(e) => setStatus(e.target.value)}
          >
            {ALL_FS.map((s) => <option key={s} value={s}>{FS_LABEL[s]}</option>)}
          </select>
          {err && <div className="text-red-500 text-xs mt-2">{err}</div>}
        </div>
      </div>
    </div>
  );
}
