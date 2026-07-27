import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";

interface MappingRow {
  id: string;
  shopName: string;
  marketplace: string;
  scenario: "A" | "B" | "C";
  subSellerId: string | null;
  subSellerName: string | null;
  subSubSellerName: string | null;
  activeAccount: string | null;
  effectiveSubSellerRate: number | null;
  effectiveSubSubSellerRate: number | null;
  addedByType: "seller" | "sub_seller" | "sub_sub_seller";
  addedByName: string;
}

const SCENARIO_LABEL: Record<MappingRow["scenario"], string> = {
  A: "A — Milik Seller",
  B: "B — Milik Sub-seller",
  C: "C — Milik Sub-sub-seller",
};
const SCENARIO_BADGE: Record<MappingRow["scenario"], string> = {
  A: "bg-slate-100 text-slate-600",
  B: "bg-blue-100 text-blue-700",
  C: "bg-violet-100 text-violet-700",
};
const pct = (r: number | null) => (r == null ? "-" : `${(r * 100).toFixed(1)}%`);

export function PencairanMapping() {
  const { data, loading } = useFetch<MappingRow[]>("/payout/mapping");
  const [filterSub, setFilterSub] = useState("");

  const subOptions = useMemo(() => {
    const map = new Map<string, string>();
    (data ?? []).forEach((r) => { if (r.subSellerId && r.subSellerName) map.set(r.subSellerId, r.subSellerName); });
    return [...map.entries()];
  }, [data]);

  const rows = useMemo(() => {
    if (!filterSub) return data ?? [];
    return (data ?? []).filter((r) => r.subSellerId === filterSub);
  }, [data, filterSub]);

  return (
    <Layout title="Mapping Toko ↔ Owner">
      <div className="flex items-center justify-between mb-3">
        <Link to="/pencairan" className="text-xs text-brand font-semibold hover:underline">← Kembali</Link>
        <select value={filterSub} onChange={(e) => setFilterSub(e.target.value)}
          className="px-2 py-1.5 rounded-md border border-slate-300 text-sm">
          <option value="">Semua Sub-seller</option>
          {subOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[880px]">
          <thead>
            <tr className="bg-slate-50 text-[10px] uppercase text-slate-500">
              <th className="text-left px-3 py-2">Nama Toko</th>
              <th className="text-left px-3 py-2">Marketplace</th>
              <th className="text-left px-3 py-2">Skenario</th>
              <th className="text-left px-3 py-2">Rantai Kepemilikan</th>
              <th className="text-left px-3 py-2">Rekening Tujuan Aktif</th>
              <th className="text-left px-3 py-2">Rate Berlaku</th>
              <th className="text-left px-3 py-2">Ditambahkan Oleh</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">Memuat…</td></tr>
            ) : !rows.length ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">Belum ada toko.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium">{r.shopName}</td>
                <td className="px-3 py-2 text-slate-500">{r.marketplace}</td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${SCENARIO_BADGE[r.scenario]}`}>
                    {SCENARIO_LABEL[r.scenario]}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-600">
                  {r.scenario === "A" && "—"}
                  {r.scenario === "B" && r.subSellerName}
                  {r.scenario === "C" && `${r.subSubSellerName} › ${r.subSellerName}`}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{r.activeAccount ?? "-"}</td>
                <td className="px-3 py-2 text-slate-500 text-xs">
                  {r.scenario !== "A" && <div>Sub-seller: {pct(r.effectiveSubSellerRate)}</div>}
                  {r.scenario === "C" && <div>Sub-sub-seller: {pct(r.effectiveSubSubSellerRate)}</div>}
                  {r.scenario === "A" && "-"}
                </td>
                <td className="px-3 py-2 text-slate-600">{r.addedByName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
