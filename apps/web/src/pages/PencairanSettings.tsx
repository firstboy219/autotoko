import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";

interface Settings {
  sedekahRate: string;
  sedekahBasis: "total_credit" | "after_subseller_split";
  sedekahBankAccount: string | null;
}

export function PencairanSettings() {
  const { data, reload } = useFetch<Settings>("/payout/settings");
  const [rate, setRate] = useState("5");
  const [basis, setBasis] = useState<Settings["sedekahBasis"]>("total_credit");
  const [bank, setBank] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) {
      setRate((Number(data.sedekahRate) * 100).toString());
      setBasis(data.sedekahBasis);
      setBank(data.sedekahBankAccount ?? "");
    }
  }, [data]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setSaved(false);
    try {
      await api.patch("/payout/settings", {
        sedekahRate: Number(rate) / 100,
        sedekahBasis: basis,
        sedekahBankAccount: bank || undefined,
      });
      setSaved(true); reload();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Layout title="Pengaturan Payout">
      <Link to="/pencairan" className="text-xs text-brand font-semibold hover:underline">← Kembali</Link>
      <form onSubmit={save} className="mt-3 bg-white rounded-xl border border-slate-200 p-4 max-w-lg space-y-4">
        <div>
          <label className="text-xs font-semibold text-slate-600">Rate Sedekah (%)</label>
          <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))}
            className="mt-1 w-full px-3 py-2 rounded-md border border-slate-300 text-sm" />
          <div className="text-[11px] text-slate-400 mt-1">Default 5%. Berlaku untuk transaksi baru; data historis memakai snapshot rate lama.</div>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600">Basis Perhitungan Sedekah</label>
          <div className="mt-1 space-y-2">
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" checked={basis === "total_credit"} onChange={() => setBasis("total_credit")} className="mt-1" />
              <span><b>Total Kredit Awal</b> — sedekah dihitung dari nominal kredit penuh, lalu sisanya displit ke sub-seller.</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" checked={basis === "after_subseller_split"} onChange={() => setBasis("after_subseller_split")} className="mt-1" />
              <span><b>Sisa Setelah Split Sub-seller</b> — sub-seller dibayar dulu (tanpa potong sedekah), sedekah diambil dari porsi seller saja.</span>
            </label>
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600">Rekening Tujuan Sedekah</label>
          <input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Nomor rekening + bank"
            className="mt-1 w-full px-3 py-2 rounded-md border border-slate-300 text-sm" />
        </div>
        {err && <div className="text-red-500 text-xs">{err}</div>}
        {saved && <div className="text-green-600 text-xs">✓ Tersimpan</div>}
        <button disabled={busy} className="px-4 py-2 rounded-md bg-brand hover:bg-brand-dark text-white text-sm font-semibold disabled:opacity-50">
          {busy ? "…" : "Simpan Pengaturan"}
        </button>
      </form>
    </Layout>
  );
}
