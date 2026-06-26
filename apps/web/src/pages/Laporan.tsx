import { useState } from "react";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";

type ReportType = "daily" | "weekly" | "monthly";

interface Report {
  type: ReportType;
  range: { label: string };
  totals: { orders: number; revenue: number; platform_fee: number };
  by_shop: { shop: string; orders: number; revenue: number }[];
  by_status: { status: string; orders: number }[];
  top_products: { name: string; qty: number }[];
}

const TABS: { type: ReportType; label: string }[] = [
  { type: "daily", label: "Harian" },
  { type: "weekly", label: "Mingguan" },
  { type: "monthly", label: "Bulanan" },
];

const rp = (n: number) => "Rp " + n.toLocaleString("id-ID");

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex-1">
      <div className="text-[11px] text-slate-500">{title}</div>
      <div className="text-xl font-bold text-slate-800 mt-0.5">{value}</div>
    </div>
  );
}

export function Laporan() {
  const [type, setType] = useState<ReportType>("daily");
  const { data, loading } = useFetch<Report>(`/reports/preview/${type}`);

  return (
    <Layout title="Laporan">
      <p className="text-sm text-slate-500 mb-3">
        Rekap otomatis. Versi lengkap juga dikirim ke email-mu (harian 23:55, mingguan Senin pagi,
        bulanan tanggal 1).
      </p>

      <div className="flex gap-1 mb-4">
        {TABS.map((t) => (
          <button
            key={t.type}
            onClick={() => setType(t.type)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium ${
              type === t.type ? "bg-brand text-white" : "bg-white text-slate-600 border border-slate-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && <div className="text-slate-400 text-sm">Memuat…</div>}

      {data && (
        <div className="space-y-4">
          <div className="text-sm font-semibold text-slate-700">{data.range.label}</div>
          <div className="flex gap-3">
            <Card title="Total Order" value={String(data.totals.orders)} />
            <Card title="Revenue" value={rp(data.totals.revenue)} />
            <Card title="Fee Platform" value={rp(data.totals.platform_fee)} />
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="font-semibold text-sm text-slate-700 mb-2">Performa per Toko</div>
            {data.by_shop.length === 0 ? (
              <div className="text-slate-400 text-sm">Belum ada penjualan.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-400 text-xs">
                    <th className="py-1">Toko</th>
                    <th className="py-1 text-right">Order</th>
                    <th className="py-1 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_shop.map((s) => (
                    <tr key={s.shop} className="border-t border-slate-100">
                      <td className="py-1.5">{s.shop}</td>
                      <td className="py-1.5 text-right">{s.orders}</td>
                      <td className="py-1.5 text-right">{rp(s.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="font-semibold text-sm text-slate-700 mb-2">Produk Terlaris</div>
            {data.top_products.length === 0 ? (
              <div className="text-slate-400 text-sm">—</div>
            ) : (
              <ul className="text-sm space-y-1">
                {data.top_products.map((p) => (
                  <li key={p.name} className="flex justify-between">
                    <span>{p.name}</span>
                    <span className="text-slate-500">{p.qty} pcs</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}
