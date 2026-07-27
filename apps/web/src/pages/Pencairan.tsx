import { useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";
import { dateShort } from "../lib/fmt";

interface Batch {
  id: string;
  status: "berjalan" | "siap_distribusi" | "selesai";
  closedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}
interface Settings {
  sedekahRate: string;
  sedekahBasis: "total_credit" | "after_subseller_split";
  sedekahBankAccount: string | null;
}

const STATUS_LABEL: Record<Batch["status"], string> = {
  berjalan: "Berjalan",
  siap_distribusi: "Siap Distribusi",
  selesai: "Selesai",
};
const STATUS_BADGE: Record<Batch["status"], string> = {
  berjalan: "bg-blue-100 text-blue-700",
  siap_distribusi: "bg-amber-100 text-amber-700",
  selesai: "bg-green-100 text-green-700",
};
const BASIS_LABEL: Record<Settings["sedekahBasis"], string> = {
  total_credit: "Total Kredit Awal",
  after_subseller_split: "Sisa Setelah Split Sub-seller",
};

export function Pencairan() {
  const { data: batches, loading, reload } = useFetch<Batch[]>("/payout/batches");
  const { data: settings } = useFetch<Settings>("/payout/settings");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function startBatch() {
    setBusy(true);
    setErr(null);
    try {
      await api.post("/payout/batches");
      reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const hasOpen = batches?.some((b) => b.status === "berjalan");

  return (
    <Layout title="Pencairan Dana">
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="flex-1 min-w-[220px] bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Pengaturan Sedekah</div>
          <div className="text-lg font-extrabold mt-1">
            {settings ? `${(Number(settings.sedekahRate) * 100).toFixed(1)}%` : "…"}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            Basis: {settings ? BASIS_LABEL[settings.sedekahBasis] : "…"}
          </div>
          <Link to="/pencairan/pengaturan" className="text-xs text-brand font-semibold hover:underline mt-2 inline-block">
            Ubah pengaturan →
          </Link>
        </div>
        <div className="flex-1 min-w-[220px] bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Sub-seller</div>
          <div className="text-sm text-slate-600 mt-1">Kelola sub-seller, sub-sub-seller, dan penugasan toko.</div>
          <Link to="/pencairan/sub-seller" className="text-xs text-brand font-semibold hover:underline mt-2 inline-block">
            Buka manajemen →
          </Link>
        </div>
        <div className="flex-1 min-w-[220px] bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Mapping Toko</div>
          <div className="text-sm text-slate-600 mt-1">Lihat kepemilikan tiap toko dan rekening tujuannya.</div>
          <Link to="/pencairan/mapping" className="text-xs text-brand font-semibold hover:underline mt-2 inline-block">
            Buka mapping →
          </Link>
        </div>
        <div className="flex-1 min-w-[220px] bg-gradient-to-br from-navy to-[#252558] rounded-xl p-4 text-white flex flex-col justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-white/40">Batch Pencairan</div>
            <div className="text-sm text-white/70 mt-1">
              {hasOpen ? "Ada batch berjalan." : "Mulai batch baru untuk input pencairan."}
            </div>
          </div>
          <button
            onClick={startBatch}
            disabled={busy || hasOpen}
            title={hasOpen ? "Sudah ada batch berjalan — selesaikan dulu." : ""}
            className="mt-3 px-3 py-2 rounded-md bg-brand hover:bg-brand-dark text-white text-sm font-semibold disabled:opacity-50"
          >
            {busy ? "…" : "+ Mulai Batch Baru"}
          </button>
        </div>
      </div>
      {err && <div className="text-red-500 text-sm mb-3">{err}</div>}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 font-bold text-sm flex items-center justify-between">
          <span>Daftar Batch</span>
          <Link to="/pencairan/mutasi" className="text-xs text-brand font-semibold hover:underline">
            Lihat semua mutasi →
          </Link>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-[10px] uppercase text-slate-500">
              <th className="text-left px-3 py-2">Dibuat</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Input Ditutup</th>
              <th className="text-left px-3 py-2">Batch Selesai</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">Memuat…</td></tr>
            ) : !batches?.length ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">Belum ada batch. Mulai batch baru untuk mencatat pencairan.</td></tr>
            ) : (
              batches.map((b) => (
                <tr key={b.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-500">{dateShort(b.createdAt)}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${STATUS_BADGE[b.status]}`}>
                      {STATUS_LABEL[b.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-500">{b.closedAt ? dateShort(b.closedAt) : "-"}</td>
                  <td className="px-3 py-2 text-slate-500">{b.completedAt ? dateShort(b.completedAt) : "-"}</td>
                  <td className="px-3 py-2 text-right">
                    <Link to={`/pencairan/batch/${b.id}`} className="text-xs text-brand font-semibold hover:underline">
                      Detail →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
