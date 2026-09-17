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
  activityFees?: Record<string, number>;
}

const PLANS = ["freemium", "starter", "pro"] as const;

function PlanCard({ plan, current, onSaved }: { plan: string; current?: Plan; onSaved: () => void }) {
  const af = current?.activityFees ?? {};
  const [setupFee, setSetup] = useState(current?.setupFee ?? "0");
  const [monthlyFee, setMonthly] = useState(current?.monthlyFee ?? "0");
  const [feeOrder, setFeeOrder] = useState(String(af.order ?? "0"));
  const [feeShop, setFeeShop] = useState(String(af.shop_connect ?? "0"));
  const [feeProduct, setFeeProduct] = useState(String(af.product_create ?? "0"));
  const [feeAudit, setFeeAudit] = useState(String(af.audit_run ?? "0"));
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);

  async function save() {
    setBusy(true); setOk(false);
    try {
      await api.put(`/admin/pricing/${plan}`, {
        setupFee, monthlyFee,
        activityFees: {
          order: Number(feeOrder) || 0,
          shop_connect: Number(feeShop) || 0,
          product_create: Number(feeProduct) || 0,
          audit_run: Number(feeAudit) || 0,
        },
      });
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
      <div className="mt-2 mb-1 text-[11px] font-semibold text-slate-300">Fee per aktivitas (Rp) — 0 = gratis</div>
      {F("Order masuk / order", feeOrder, setFeeOrder)}
      {F("Connect toko baru / toko", feeShop, setFeeShop)}
      {F("Produk baru / produk", feeProduct, setFeeProduct)}
      {F("Run Audit Pesanan / hit", feeAudit, setFeeAudit)}
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
        Fee per aktivitas memotong wallet seller sesuai paketnya: order masuk (sync+webhook), connect toko baru, produk baru, dan run Audit Pesanan. 0 = gratis untuk paket itu.
      </p>
      <div className="flex gap-3 flex-wrap">
        {PLANS.map((p) => (
          <PlanCard key={p} plan={p} current={byPlan.get(p)} onSaved={reload} />
        ))}
      </div>
    </Layout>
  );
}
