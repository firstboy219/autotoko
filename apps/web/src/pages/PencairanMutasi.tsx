import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { rupiah, dateShort } from "../lib/fmt";

interface Mutation {
  id: string; batchId: string; shopId: string; payoutDate: string;
  creditAmount: string; sedekahAmount: string; sellerAmount: string;
  subSellerAmount: string | null; subSubSellerAmount: string | null;
  status: "draft" | "completed";
}
interface ShopOpt { id: string; shopName: string; marketplace: string; }

export function PencairanMutasi() {
  const [status, setStatus] = useState("");
  const path = useMemo(() => `/payout/mutations${status ? `?status=${status}` : ""}`, [status]);
  const { data, loading } = useFetch<Mutation[]>(path);
  const { data: shops } = useFetch<ShopOpt[]>("/payout/shops");
  const shopName = (id: string) => shops?.find((s) => s.id === id)?.shopName ?? id.slice(0, 8);

  return (
    <Layout title="Semua Mutasi Pencairan">
      <div className="flex items-center justify-between mb-3">
        <Link to="/pencairan" className="text-xs text-brand font-semibold hover:underline">← Kembali</Link>
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="px-2 py-1.5 rounded-md border border-slate-300 text-sm">
          <option value="">Semua status</option>
          <option value="draft">Draft</option>
          <option value="completed">Selesai</option>
        </select>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="bg-slate-50 text-[10px] uppercase text-slate-500">
              <th className="text-left px-3 py-2">Tanggal</th>
              <th className="text-left px-3 py-2">Toko</th>
              <th className="text-right px-3 py-2">Kredit</th>
              <th className="text-right px-3 py-2">Sedekah</th>
              <th className="text-right px-3 py-2">Seller</th>
              <th className="text-right px-3 py-2">Sub-seller</th>
              <th className="text-right px-3 py-2">Sub-sub</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">Memuat…</td></tr>
            ) : !data?.length ? (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">Tidak ada mutasi.</td></tr>
            ) : data.map((m) => (
              <tr key={m.id} className="border-t border-slate-100">
                <td className="px-3 py-2 text-slate-500">{dateShort(m.payoutDate)}</td>
                <td className="px-3 py-2">{shopName(m.shopId)}</td>
                <td className="px-3 py-2 text-right font-semibold">{rupiah(m.creditAmount)}</td>
                <td className="px-3 py-2 text-right text-slate-500">{rupiah(m.sedekahAmount)}</td>
                <td className="px-3 py-2 text-right text-slate-500">{rupiah(m.sellerAmount)}</td>
                <td className="px-3 py-2 text-right text-slate-500">{m.subSellerAmount ? rupiah(m.subSellerAmount) : "-"}</td>
                <td className="px-3 py-2 text-right text-slate-500">{m.subSubSellerAmount ? rupiah(m.subSubSellerAmount) : "-"}</td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${m.status === "completed" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>
                    {m.status === "completed" ? "Selesai" : "Draft"}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <Link to={`/pencairan/batch/${m.batchId}`} className="text-xs text-brand font-semibold hover:underline">Batch →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
