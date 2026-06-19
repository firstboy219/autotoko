import { useState } from "react";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";
import { rupiah } from "../lib/fmt";

interface Master {
  id: string;
  sku: string;
  name: string;
  basePrice: string | null;
  status: string;
  postingCount?: number;
  totalStock?: number;
  gmv7d?: string;
}

export function Produk() {
  const { data, loading, reload } = useFetch<Master[]>("/products");
  const [open, setOpen] = useState(false);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      await api.post("/products", {
        sku,
        name,
        basePrice: price || undefined,
        status: "active",
      });
      setOpen(false);
      setSku("");
      setName("");
      setPrice("");
      reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Layout title="Master Produk">
      <div className="flex justify-between items-center mb-4">
        <div className="text-sm text-slate-500">{data?.length ?? 0} master produk</div>
        <button
          onClick={() => setOpen(!open)}
          className="px-4 py-2 rounded-md bg-brand hover:bg-brand-dark text-white text-sm font-semibold"
        >
          + Produk Baru
        </button>
      </div>

      {open && (
        <form onSubmit={create} className="bg-white rounded-xl border border-slate-200 p-4 mb-4 grid grid-cols-3 gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">SKU</label>
            <input className="w-full px-3 py-2 rounded-md border border-slate-200 text-sm" value={sku} onChange={(e) => setSku(e.target.value)} required />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Nama</label>
            <input className="w-full px-3 py-2 rounded-md border border-slate-200 text-sm" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="flex gap-2">
            <input className="w-full px-3 py-2 rounded-md border border-slate-200 text-sm" placeholder="Harga" value={price} onChange={(e) => setPrice(e.target.value)} />
            <button disabled={saving} className="px-4 py-2 rounded-md bg-brand text-white text-sm font-semibold disabled:opacity-60">
              {saving ? "…" : "Simpan"}
            </button>
          </div>
          {err && <div className="col-span-3 text-red-500 text-xs">{err}</div>}
        </form>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-[10px] uppercase text-slate-500">
              <th className="text-left px-3 py-2">Produk / SKU</th>
              <th className="text-left px-3 py-2">Postingan</th>
              <th className="text-left px-3 py-2">Stok</th>
              <th className="text-left px-3 py-2">Harga</th>
              <th className="text-left px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">Memuat…</td></tr>
            ) : !data?.length ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">Belum ada produk.</td></tr>
            ) : (
              data.map((m) => (
                <tr key={m.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <div className="font-semibold">{m.name}</div>
                    <div className="text-[10px] font-mono text-slate-400">SKU: {m.sku}</div>
                  </td>
                  <td className="px-3 py-2">{m.postingCount ?? 0}</td>
                  <td className="px-3 py-2">{m.totalStock ?? 0}</td>
                  <td className="px-3 py-2">{rupiah(m.basePrice)}</td>
                  <td className="px-3 py-2">
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-600 capitalize">{m.status}</span>
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
