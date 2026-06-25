import { useCallback } from "react";
import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { useRealtime } from "../lib/realtime";
import { rupiah, dateShort } from "../lib/fmt";

interface Order {
  id: string;
  marketplace: string;
  marketplaceOrderId: string;
  status: string | null;
  buyerName: string | null;
  totalAmount: string | null;
  createdAt: string;
}

function Stat({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
        <span className="text-lg leading-none">{icon}</span>
      </div>
      <div className="text-2xl font-extrabold mt-1">{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}

/** 7-day order-count bars computed client-side from the recent orders list. */
function TrendChart({ orders }: { orders: Order[] }) {
  const days: { label: string; count: number }[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const count = orders.filter((o) => o.createdAt?.slice(0, 10) === key).length;
    days.push({ label: d.toLocaleDateString("id-ID", { weekday: "short" }), count });
  }
  const max = Math.max(1, ...days.map((d) => d.count));
  return (
    <div className="flex items-end gap-2 h-28">
      {days.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1">
          <div className="text-[10px] text-slate-400">{d.count}</div>
          <div
            className="w-full rounded-t bg-brand/80"
            style={{ height: `${(d.count / max) * 80 + 4}px` }}
          />
          <div className="text-[10px] text-slate-400">{d.label}</div>
        </div>
      ))}
    </div>
  );
}

interface Summary {
  today_orders: number;
  today_revenue: string;
  active_shops: number;
  total_orders: number;
  total_revenue: string;
}

export function Dashboard() {
  const wallet = useFetch<{ balance: string }>("/wallet");
  const summary = useFetch<Summary>("/dashboard/summary");
  const products = useFetch<unknown[]>("/products");
  const orders = useFetch<Order[]>("/orders");

  useRealtime(
    useCallback(() => {
      summary.reload();
      orders.reload();
    }, [summary, orders]),
  );

  const recent = (orders.data ?? []).slice(0, 5);

  return (
    <Layout title="Dashboard">
      <div className="grid grid-cols-4 gap-3">
        <Stat icon="📦" label="Order Hari Ini" value={String(summary.data?.today_orders ?? 0)} sub={`total ${summary.data?.total_orders ?? 0} sepanjang waktu`} />
        <Stat icon="📈" label="Revenue Hari Ini" value={rupiah(summary.data?.today_revenue)} sub={`total ${rupiah(summary.data?.total_revenue)}`} />
        <Stat icon="🏪" label="Toko Aktif" value={String(summary.data?.active_shops ?? 0)} sub={`${products.data?.length ?? 0} master produk`} />
        <Stat icon="💰" label="Saldo Wallet" value={rupiah(wallet.data?.balance)} sub="AutoToko balance" />
      </div>

      <div className="grid grid-cols-3 gap-3 mt-4">
        <div className="col-span-2 bg-white rounded-xl border border-slate-200 p-5">
          <div className="font-bold mb-3 text-sm">Tren Order (7 hari)</div>
          <TrendChart orders={orders.data ?? []} />
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="font-bold mb-3 text-sm">Aksi Cepat</div>
          <div className="flex flex-col gap-2">
            <Link to="/toko" className="px-3 py-2 rounded-md bg-brand/10 text-brand text-sm font-semibold hover:bg-brand/20">+ Hubungkan Toko</Link>
            <Link to="/produk" className="px-3 py-2 rounded-md bg-brand/10 text-brand text-sm font-semibold hover:bg-brand/20">+ Master Produk</Link>
            <Link to="/wallet" className="px-3 py-2 rounded-md bg-brand/10 text-brand text-sm font-semibold hover:bg-brand/20">+ Top-up Saldo</Link>
          </div>
        </div>
      </div>

      <div className="mt-4 bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <div className="font-bold text-sm">Order Terbaru</div>
          <Link to="/orders" className="text-xs text-brand font-semibold">Lihat semua →</Link>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {orders.loading ? (
              <tr><td className="px-5 py-6 text-center text-slate-400">Memuat…</td></tr>
            ) : !recent.length ? (
              <tr><td className="px-5 py-6 text-center text-slate-400">Belum ada order (masuk via webhook marketplace).</td></tr>
            ) : (
              recent.map((o) => (
                <tr key={o.id} className="border-t border-slate-100">
                  <td className="px-5 py-2 font-mono text-[11px]">{o.marketplaceOrderId}</td>
                  <td className="px-3 py-2 capitalize text-slate-500">{o.marketplace}</td>
                  <td className="px-3 py-2">{o.buyerName ?? "-"}</td>
                  <td className="px-3 py-2 text-right font-semibold">{rupiah(o.totalAmount)}</td>
                  <td className="px-5 py-2 text-right text-slate-400 text-[11px]">{dateShort(o.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
