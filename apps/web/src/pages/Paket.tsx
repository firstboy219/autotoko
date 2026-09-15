import { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { api } from "../lib/api";
import { useAccount, type Me } from "../lib/account";

interface Plan {
  planType: "freemium" | "starter" | "pro";
  monthlyFee: string | null;
  setupFee: string | null;
  perTransactionFee: string | null;
  maxShops: number | null;
  maxOrdersPerMonth: number | null;
}

const LABEL: Record<string, string> = { freemium: "Freemium", starter: "Starter", pro: "Pro" };
const rp = (n: number) => "Rp " + n.toLocaleString("id-ID");

interface Usage {
  plan: string;
  monthlyFee: string; perTransactionFee: string;
  maxShops: number | null; maxOrdersPerMonth: number | null;
  shopsUsed: number; ordersThisMonth: number;
  walletBalance: string; feesThisMonth: string;
}

/** Kartu pemakaian vs batas paket (meter, read-only). Tidak memblokir apa pun. */
function UsageCard() {
  const [u, setU] = useState<Usage | null>(null);
  useEffect(() => { api.get<Usage>("/account/usage").then(setU).catch(() => {}); }, []);
  if (!u) return null;

  const meter = (label: string, used: number, max: number | null, unit: string) => {
    const unlimited = max == null;
    const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(max, 1)) * 100));
    const over = !unlimited && used > max;
    const near = !unlimited && pct >= 80 && !over;
    const color = over ? "#B3261E" : near ? "#B0740F" : "#0E6E55";
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="text-[12px] text-slate-500">{label}</div>
        <div className="text-lg font-bold text-slate-900 mt-0.5 tabular-nums">
          {used.toLocaleString("id-ID")}<span className="text-slate-400 text-sm font-normal"> / {unlimited ? "∞" : max!.toLocaleString("id-ID")} {unit}</span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-100 mt-2 overflow-hidden">
          <div style={{ width: unlimited ? "8%" : `${pct}%`, background: color }} className="h-full rounded-full" />
        </div>
        {over && <div className="text-[11px] text-red-600 mt-1">Melebihi batas paket</div>}
        {near && <div className="text-[11px] text-amber-700 mt-1">Mendekati batas</div>}
        {unlimited && <div className="text-[11px] text-slate-400 mt-1">Tak terbatas</div>}
      </div>
    );
  };

  return (
    <div className="mb-5">
      <div className="text-sm font-semibold text-slate-700 mb-2">Pemakaian bulan ini · paket {LABEL[u.plan] ?? u.plan}</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {meter("Toko tersambung", u.shopsUsed, u.maxShops, "toko")}
        {meter("Order bulan ini", u.ordersThisMonth, u.maxOrdersPerMonth, "order")}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-[12px] text-slate-500">Saldo Wallet</div>
          <div className="text-lg font-bold text-slate-900 mt-0.5 tabular-nums">{rp(Number(u.walletBalance))}</div>
          <div className="text-[11px] text-slate-400 mt-2">Fee/transaksi {rp(Number(u.perTransactionFee))}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-[12px] text-slate-500">Fee transaksi bulan ini</div>
          <div className="text-lg font-bold text-slate-900 mt-0.5 tabular-nums">{rp(Number(u.feesThisMonth))}</div>
          <div className="text-[11px] text-slate-400 mt-2">Langganan {rp(Number(u.monthlyFee))}/bln</div>
        </div>
      </div>
    </div>
  );
}

export function Paket() {
  const { me, load, setMe } = useAccount();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { load(); api.get<Plan[]>("/account/plans").then(setPlans).catch(() => {}); }, [load]);

  async function choose(planType: Plan["planType"]) {
    setBusy(planType); setErr(null);
    try {
      const updated = await api.post<Me>("/account/plan", { planType });
      setMe(updated);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  return (
    <Layout title="Paket Langganan">
      <UsageCard />
      <p className="text-sm text-slate-500 mb-4">Pilih paket yang sesuai. Paket aktif kamu sekarang: <b>{me ? LABEL[me.planType] : "…"}</b></p>
      {err && <div className="text-red-500 text-sm mb-3">{err}</div>}
      <div className="grid gap-3 md:grid-cols-3">
        {(plans.length ? plans : []).map((p) => {
          const current = me?.planType === p.planType;
          const fee = Number(p.monthlyFee ?? 0);
          return (
            <div key={p.planType} className={`bg-white rounded-xl border p-4 ${current ? "border-brand ring-1 ring-brand" : "border-slate-200"}`}>
              <div className="font-bold text-slate-800">{LABEL[p.planType]}</div>
              <div className="text-2xl font-extrabold text-slate-900 mt-1">{fee > 0 ? rp(fee) : "Gratis"}<span className="text-xs font-normal text-slate-400">{fee > 0 ? "/bln" : ""}</span></div>
              <ul className="text-[12px] text-slate-500 mt-3 space-y-1">
                <li>🏪 {p.maxShops ? `${p.maxShops} toko` : "Toko tak terbatas"}</li>
                <li>📦 {p.maxOrdersPerMonth ? `${p.maxOrdersPerMonth} order/bln` : "Order tak terbatas"}</li>
                <li>💸 Fee per-transaksi {p.perTransactionFee ? rp(Number(p.perTransactionFee)) : "Rp 0"}</li>
                {p.setupFee && Number(p.setupFee) > 0 && <li>⚙️ Setup {rp(Number(p.setupFee))}</li>}
              </ul>
              <button
                disabled={current || busy === p.planType}
                onClick={() => choose(p.planType)}
                className={`w-full mt-4 py-2 rounded-md text-sm font-semibold ${current ? "bg-slate-100 text-slate-400" : "bg-brand hover:bg-brand-dark text-white"} disabled:opacity-60`}
              >
                {current ? "Paket aktif" : busy === p.planType ? "Memproses…" : "Pilih paket"}
              </button>
            </div>
          );
        })}
      </div>
      {plans.length === 0 && <div className="text-slate-400 text-sm">Daftar paket belum dikonfigurasi admin.</div>}
    </Layout>
  );
}
