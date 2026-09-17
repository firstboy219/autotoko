import { useState } from "react";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";

interface InvoiceRow {
  id: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  type: "setup_fee" | "subscription" | "topup";
  amount: string;
  status: "pending" | "paid" | "failed" | "cancelled";
  paidAt: string | null;
  createdAt: string;
}

const rupiah = (v: string | number) => `Rp ${Math.round(Number(v)).toLocaleString("id-ID")}`;
const dateTime = (v: string | null) =>
  v
    ? new Date(v).toLocaleString("id-ID", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : "-";

const TYPE_LABEL: Record<string, string> = { setup_fee: "Setup Fee", subscription: "Langganan", topup: "Top-up" };
const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: "Menunggu", cls: "bg-amber-500/15 text-amber-400" },
  paid: { label: "Lunas", cls: "bg-emerald-500/15 text-emerald-400" },
  failed: { label: "Gagal", cls: "bg-red-500/15 text-red-400" },
  cancelled: { label: "Batal", cls: "bg-white/10 text-white/50" },
};

export function Invoices() {
  const [status, setStatus] = useState("");
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  qs.set("limit", "200");
  const { data, loading, error, reload } = useFetch<InvoiceRow[]>(`/admin/billing/invoices?${qs.toString()}`);

  const paidTotal = (data ?? [])
    .filter((i) => i.status === "paid")
    .reduce((sum, i) => sum + Number(i.amount), 0);

  return (
    <Layout title="Invoice & Top-up">
      <div className="bg-[#1e293b] rounded-xl border border-white/10 p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-[11px] font-semibold text-slate-400 mb-1">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-2 rounded-md bg-[#0f172a] border border-white/10 text-sm text-slate-100"
          >
            <option value="">Semua</option>
            <option value="pending">Menunggu</option>
            <option value="paid">Lunas</option>
            <option value="failed">Gagal</option>
            <option value="cancelled">Batal</option>
          </select>
        </div>
        <button
          onClick={() => reload()}
          className="px-4 py-2 rounded-md border border-white/10 text-slate-300 hover:bg-white/5 text-sm"
        >
          ↻ Muat ulang
        </button>
        <div className="ml-auto text-right">
          <div className="text-[10px] uppercase text-slate-500">Total Lunas (tampil)</div>
          <div className="text-lg font-bold text-emerald-400">{rupiah(paidTotal)}</div>
        </div>
      </div>

      {error && <div className="text-red-400 text-sm mb-3">{error}</div>}

      <div className="bg-[#1e293b] rounded-xl border border-white/10 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 font-bold text-sm text-white">
          {loading ? "Memuat…" : `${data?.length ?? 0} invoice`}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-black/20 text-[10px] uppercase text-slate-400">
                <th className="text-left px-4 py-2">Tanggal</th>
                <th className="text-left px-4 py-2">Seller</th>
                <th className="text-left px-4 py-2">Jenis</th>
                <th className="text-right px-4 py-2">Nominal</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-left px-4 py-2">Dibayar</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Memuat…</td></tr>
              ) : !data?.length ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Belum ada invoice.</td></tr>
              ) : (
                data.map((inv) => {
                  const st = STATUS_META[inv.status] ?? { label: inv.status, cls: "bg-white/10 text-white/50" };
                  return (
                    <tr key={inv.id} className="border-t border-white/5 text-slate-200">
                      <td className="px-4 py-2.5 text-xs text-slate-400 whitespace-nowrap">{dateTime(inv.createdAt)}</td>
                      <td className="px-4 py-2.5">
                        <div className="text-xs">{inv.userName || "(tanpa nama)"}</div>
                        <div className="text-[11px] text-slate-500">{inv.userEmail ?? inv.userId.slice(0, 8)}</div>
                      </td>
                      <td className="px-4 py-2.5 text-xs">{TYPE_LABEL[inv.type] ?? inv.type}</td>
                      <td className="px-4 py-2.5 text-right font-semibold">{rupiah(inv.amount)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${st.cls}`}>{st.label}</span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-400 whitespace-nowrap">{dateTime(inv.paidAt)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
