import { useMemo, useState } from "react";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { rupiah, dateShort } from "../lib/fmt";

interface Order {
  id: string;
  marketplace: string;
  marketplaceOrderId: string;
  status: string | null;
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

const PAGE_SIZE = 15;

export function Orders() {
  const { data, loading } = useFetch<Order[]>("/orders");
  const [q, setQ] = useState("");
  const [mp, setMp] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Order | null>(null);

  const all = data ?? [];
  const statuses = useMemo(() => [...new Set(all.map((o) => o.status).filter(Boolean))] as string[], [all]);
  const marketplaces = useMemo(() => [...new Set(all.map((o) => o.marketplace))], [all]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((o) => {
      if (mp && o.marketplace !== mp) return false;
      if (status && o.status !== status) return false;
      if (needle) {
        const hay = `${o.marketplaceOrderId} ${o.buyerName ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [all, q, mp, status]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const rows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const selClass = "px-3 py-2 rounded-md border border-slate-200 text-sm bg-white";

  return (
    <Layout title="Orders">
      <div className="flex flex-wrap gap-2 mb-3">
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
        <select className={selClass} value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
          <option value="">Semua status</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-[10px] uppercase text-slate-500">
              <th className="text-left px-3 py-2">Order</th>
              <th className="text-left px-3 py-2">MP</th>
              <th className="text-left px-3 py-2">Status</th>
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
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700">{o.status ?? "-"}</span>
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

      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-3 text-sm">
          <div className="text-slate-500">{filtered.length} order · hal {safePage + 1}/{pages}</div>
          <div className="flex gap-2">
            <button disabled={safePage === 0} onClick={() => setPage(safePage - 1)} className="px-3 py-1.5 rounded-md border border-slate-200 disabled:opacity-40">←</button>
            <button disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)} className="px-3 py-1.5 rounded-md border border-slate-200 disabled:opacity-40">→</button>
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-xl w-[440px] max-w-full p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <div className="font-bold">Detail Order</div>
                <div className="font-mono text-[11px] text-slate-400">{selected.marketplaceOrderId}</div>
              </div>
              <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>
            <dl className="text-sm divide-y divide-slate-100">
              {[
                ["Marketplace", selected.marketplace],
                ["Status", selected.status ?? "-"],
                ["Pembeli", selected.buyerName ?? "-"],
                ["Total", rupiah(selected.totalAmount)],
                ["Fee platform", selected.feeDeducted ? rupiah(selected.platformFee) : "pending"],
                ["Waktu", dateShort(selected.createdAt)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between py-2">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="font-semibold capitalize">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </Layout>
  );
}
