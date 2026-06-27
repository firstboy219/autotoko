import { useCallback, useState } from "react";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { useRealtime } from "../lib/realtime";
import { api } from "../lib/api";

interface Bom {
  id: string;
  masterProductId: string;
  masterName: string | null;
  masterSku: string | null;
  materialName: string;
  quantity: string;
  unit: string | null;
  currentStock: string;
  minimumThreshold: string;
  lowStock: boolean;
}

interface Master {
  id: string;
  name: string;
  sku: string;
}

export function Bom() {
  const { data, loading, reload } = useFetch<Bom[]>("/bom");
  const masters = useFetch<Master[]>("/products");
  useRealtime(useCallback(() => reload(), [reload]));

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // create form
  const [masterProductId, setMaster] = useState("");
  const [materialName, setName] = useState("");
  const [quantity, setQty] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [currentStock, setStock] = useState("");
  const [minimumThreshold, setMin] = useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      await api.post("/bom", {
        masterProductId, materialName, quantity,
        unit: unit || undefined,
        currentStock: currentStock || undefined,
        minimumThreshold: minimumThreshold || undefined,
      });
      setOpen(false); setMaster(""); setName(""); setQty(""); setStock(""); setMin("");
      reload();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }

  async function restock(b: Bom) {
    const amount = prompt(`Tambah stok untuk "${b.materialName}" (${b.unit ?? ""}). Jumlah:`, "0");
    if (amount == null) return;
    try { await api.post(`/bom/${b.id}/restock`, { amount }); reload(); }
    catch (e) { alert((e as Error).message); }
  }

  async function editStock(b: Bom) {
    const v = prompt(`Set stok "${b.materialName}":`, b.currentStock);
    if (v == null) return;
    try { await api.patch(`/bom/${b.id}`, { currentStock: v }); reload(); }
    catch (e) { alert((e as Error).message); }
  }

  async function remove(b: Bom) {
    if (!confirm(`Hapus bahan "${b.materialName}"?`)) return;
    try { await api.del(`/bom/${b.id}`); reload(); }
    catch (e) { alert((e as Error).message); }
  }

  const lowCount = (data ?? []).filter((b) => b.lowStock).length;

  return (
    <Layout title="BOM / Bahan Baku">
      <div className="flex justify-between items-center mb-4">
        <div className="text-sm text-slate-500">
          {data?.length ?? 0} bahan
          {lowCount > 0 && <span className="ml-2 text-red-600 font-semibold">· {lowCount} stok menipis</span>}
        </div>
        <button onClick={() => setOpen(!open)} className="px-4 py-2 rounded-md bg-brand hover:bg-brand-dark text-white text-sm font-semibold">
          + Tambah Bahan
        </button>
      </div>

      {open && (
        <form onSubmit={create} className="bg-white rounded-xl border border-slate-200 p-4 mb-4 grid grid-cols-3 gap-3 items-end">
          <div className="col-span-3 md:col-span-1">
            <label className="block text-xs font-semibold text-slate-500 mb-1">Produk terkait</label>
            <select className="w-full px-3 py-2 rounded-md border border-slate-200 text-sm bg-white" value={masterProductId} onChange={(e) => setMaster(e.target.value)} required>
              <option value="">Pilih produk…</option>
              {(masters.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name} ({m.sku})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Nama bahan</label>
            <input className="w-full px-3 py-2 rounded-md border border-slate-200 text-sm" value={materialName} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Qty/produk</label>
              <input className="w-full px-3 py-2 rounded-md border border-slate-200 text-sm" value={quantity} onChange={(e) => setQty(e.target.value)} placeholder="mis. 2" required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Satuan</label>
              <input className="w-full px-3 py-2 rounded-md border border-slate-200 text-sm" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="pcs/gram/m" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Stok awal</label>
            <input className="w-full px-3 py-2 rounded-md border border-slate-200 text-sm" value={currentStock} onChange={(e) => setStock(e.target.value)} placeholder="0" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Minimum</label>
            <input className="w-full px-3 py-2 rounded-md border border-slate-200 text-sm" value={minimumThreshold} onChange={(e) => setMin(e.target.value)} placeholder="0" />
          </div>
          <button disabled={saving} className="px-4 py-2 rounded-md bg-brand text-white text-sm font-semibold disabled:opacity-60">{saving ? "…" : "Simpan"}</button>
          {err && <div className="col-span-3 text-red-500 text-xs">{err}</div>}
        </form>
      )}

      <input
        className="w-full max-w-xs mb-3 px-3 py-2 rounded-md border border-slate-200 text-sm"
        placeholder="Cari nama bahan / produk…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-[10px] uppercase text-slate-500">
              <th className="text-left px-3 py-2">Bahan</th>
              <th className="text-left px-3 py-2">Produk</th>
              <th className="text-right px-3 py-2">Qty/produk</th>
              <th className="text-right px-3 py-2">Stok</th>
              <th className="text-right px-3 py-2">Min</th>
              <th className="text-right px-3 py-2">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Memuat…</td></tr>
            ) : !data?.length ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Belum ada bahan baku. Tambahkan untuk auto-deduct saat order masuk.</td></tr>
            ) : (
              data
                .filter((b) => {
                  const q = query.trim().toLowerCase();
                  if (!q) return true;
                  return (
                    b.materialName.toLowerCase().includes(q) ||
                    (b.masterName ?? "").toLowerCase().includes(q)
                  );
                })
                .map((b) => (
                <tr key={b.id} className={`border-t border-slate-100 ${b.lowStock ? "bg-red-50" : ""}`}>
                  <td className="px-3 py-2 font-medium">{b.materialName} <span className="text-[10px] text-slate-400">{b.unit}</span></td>
                  <td className="px-3 py-2 text-slate-500">{b.masterName ?? "-"}</td>
                  <td className="px-3 py-2 text-right">{b.quantity}</td>
                  <td className="px-3 py-2 text-right font-semibold">
                    {b.currentStock}
                    {b.lowStock && <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">menipis</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-500">{b.minimumThreshold}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => restock(b)} className="text-brand text-xs font-semibold hover:underline">+ Restock</button>
                    <button onClick={() => editStock(b)} className="ml-3 text-slate-500 text-xs hover:underline">Set</button>
                    <button onClick={() => remove(b)} className="ml-3 text-red-500 text-xs hover:underline">Hapus</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
