import { useState } from "react";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";
import { rupiah, dateShort } from "../lib/fmt";

interface WalletData {
  balance: string;
  currency: string;
  transactions: {
    id: string;
    type: string;
    amount: string;
    balanceAfter: string;
    description: string | null;
    createdAt: string;
  }[];
}

const TIPE_LABEL: Record<string, string> = {
  topup: "Top-up Saldo",
  deduct_transaction: "Biaya Order",
  deduct_subscription: "Biaya Langganan",
  deduct_setup: "Biaya Setup",
  refund: "Refund",
};
const TIPE_BADGE: Record<string, string> = {
  topup: "bg-green-100 text-green-700",
  refund: "bg-green-100 text-green-700",
  deduct_transaction: "bg-orange-100 text-orange-700",
  deduct_subscription: "bg-orange-100 text-orange-700",
  deduct_setup: "bg-orange-100 text-orange-700",
};
const QUICK = [100000, 200000, 500000, 1000000];

export function Wallet() {
  const { data, loading } = useFetch<WalletData>("/wallet");
  const [amount, setAmount] = useState("100000");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function topup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const { redirectUrl } = await api.post<{ redirectUrl: string }>("/wallet/topup", {
        amount: Number(amount),
      });
      window.location.href = redirectUrl; // Midtrans Snap page
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  const balance = Number(data?.balance ?? 0);
  const PER_ORDER_FEE = 200; // matches pricing default
  const LOW = PER_ORDER_FEE * 100; // ~100 orders runway
  const ordersLeft = Math.floor(balance / PER_ORDER_FEE);

  return (
    <Layout title="Wallet">
      {!loading && balance < LOW && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-sm text-amber-800">
          ⚠️ Saldo hampir habis. Top-up sekarang agar pesanan terus diproses otomatis.
          {" "}Dengan saldo {rupiah(data?.balance)}, kamu bisa memproses ±{ordersLeft} pesanan lagi.
        </div>
      )}
      <div className="bg-gradient-to-br from-navy to-[#252558] rounded-xl p-6 text-white mb-4">
        <div className="text-[10px] uppercase tracking-wide text-white/40">Saldo Wallet</div>
        <div className="text-3xl font-extrabold mt-1">
          {loading ? "…" : rupiah(data?.balance)}
        </div>
        <div className="flex flex-wrap gap-1.5 mt-4">
          {QUICK.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setAmount(String(n))}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${Number(amount) === n ? "bg-brand border-brand" : "bg-white/10 border-white/20 text-white hover:bg-white/20"}`}
            >
              {rupiah(n)}
            </button>
          ))}
        </div>
        <form onSubmit={topup} className="flex gap-2 mt-2 items-center">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">Rp</span>
            <input
              inputMode="numeric"
              className="pl-8 pr-3 py-2 rounded-md text-slate-800 text-sm w-44"
              value={Number(amount) ? Number(amount).toLocaleString("id-ID") : ""}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
              placeholder="100.000"
            />
          </div>
          <button disabled={busy || Number(amount) < 50000} className="px-4 py-2 rounded-md bg-brand hover:bg-brand-dark text-white text-sm font-semibold disabled:opacity-60">
            {busy ? "…" : "Top Up Saldo"}
          </button>
        </form>
        <div className="text-[11px] text-white/50 mt-1">Minimum top-up Rp 50.000 · pembayaran aman via Midtrans</div>
        {err && <div className="text-red-300 text-xs mt-2">{err}</div>}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 font-bold text-sm">
          Riwayat Transaksi
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-[10px] uppercase text-slate-500">
              <th className="text-left px-3 py-2">Waktu</th>
              <th className="text-left px-3 py-2">Tipe</th>
              <th className="text-right px-3 py-2">Jumlah</th>
              <th className="text-right px-3 py-2">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {!data?.transactions?.length ? (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">Belum ada transaksi.</td></tr>
            ) : (
              data.transactions.map((t) => (
                <tr key={t.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-500">{dateShort(t.createdAt)}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${TIPE_BADGE[t.type] ?? "bg-slate-100 text-slate-600"}`}>
                      {TIPE_LABEL[t.type] ?? t.type}
                    </span>
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold ${t.type === "topup" || t.type === "refund" ? "text-green-600" : "text-red-500"}`}>
                    {t.type === "topup" || t.type === "refund" ? "+" : "-"}
                    {rupiah(t.amount)}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-500">{rupiah(t.balanceAfter)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
