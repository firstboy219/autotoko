import { useState } from "react";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";

interface Plan {
  planType: string;
  setupFee: string;
  monthlyFee: string;
  perTransactionFee: string;
  maxShops: number | null;
  maxOrdersPerMonth: number | null;
}

const PLANS = ["freemium", "starter", "pro"] as const;

function PlanCard({ plan, current, onSaved }: { plan: string; current?: Plan; onSaved: () => void }) {
  const [setupFee, setSetup] = useState(current?.setupFee ?? "0");
  const [monthlyFee, setMonthly] = useState(current?.monthlyFee ?? "0");
  const [perTransactionFee, setPerTx] = useState(current?.perTransactionFee ?? "0");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);

  async function save() {
    setBusy(true); setOk(false);
    try {
      await api.put(`/admin/pricing/${plan}`, { setupFee, monthlyFee, perTransactionFee });
      setOk(true); onSaved();
    } finally { setBusy(false); }
  }

  const F = (label: string, v: string, set: (s: string) => void) => (
    <div className="mb-2">
      <label className="block text-[11px] text-slate-400 mb-1">{label}</label>
      <input className="w-full px-2 py-1.5 rounded-md bg-[#0f172a] border border-white/10 text-sm text-slate-100" value={v} onChange={(e) => set(e.target.value)} />
    </div>
  );

  return (
    <div className="bg-[#1e293b] rounded-xl border border-white/10 p-4 w-64">
      <div className="font-bold capitalize text-white mb-3">{plan}</div>
      {F("Setup fee (Rp)", setupFee, setSetup)}
      {F("Subscription / bulan (Rp)", monthlyFee, setMonthly)}
      {F("Fee per transaksi (Rp)", perTransactionFee, setPerTx)}
      <button onClick={save} disabled={busy} className="w-full mt-1 py-1.5 rounded-md bg-brand hover:bg-brand-dark text-white text-xs font-semibold disabled:opacity-50">
        {busy ? "…" : ok ? "✓ Tersimpan" : "Simpan"}
      </button>
    </div>
  );
}

export function Pricing() {
  const { data, reload } = useFetch<Plan[]>("/admin/pricing");
  const byPlan = new Map((data ?? []).map((p) => [p.planType, p]));

  return (
    <Layout title="Pricing">
      <p className="text-sm text-slate-400 mb-4">
        Fee per transaksi dipakai untuk auto-deduct wallet saat order masuk via webhook.
      </p>
      <div className="flex gap-3 flex-wrap">
        {PLANS.map((p) => (
          <PlanCard key={p} plan={p} current={byPlan.get(p)} onSaved={reload} />
        ))}
      </div>
    </Layout>
  );
}
