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

export function Orders() {
  const { data, loading } = useFetch<Order[]>("/orders");

  return (
    <Layout title="Orders">
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
            ) : !data?.length ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">Belum ada order (masuk via webhook marketplace).</td></tr>
            ) : (
              data.map((o) => (
                <tr key={o.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-[11px]">{o.marketplaceOrderId}</td>
                  <td className="px-3 py-2 capitalize">{o.marketplace}</td>
                  <td className="px-3 py-2">
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700">
                      {o.status ?? "-"}
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
    </Layout>
  );
}
