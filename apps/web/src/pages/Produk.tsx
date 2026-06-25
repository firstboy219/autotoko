import { useMemo, useState } from "react";
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

interface Posting {
  id: string;
  title: string | null;
  marketplaceSku: string | null;
  price: string | null;
  stock: number | null;
  status: string;
}
interface ShopGroup { shopId: string; shopName: string | null; marketplace: string; postings: Posting[]; }
interface MasterDetail extends Master { shops: ShopGroup[]; }
interface Shop { id: string; shopName: string | null; marketplace: string; }

export function Produk() {
  const { data, loading, reload } = useFetch<Master[]>("/products");
  const [open, setOpen] = useState(false);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter((m) =>
      !needle || `${m.name} ${m.sku}`.toLowerCase().includes(needle),
    );
  }, [data, q]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      await api.post("/products", { sku, name, basePrice: price || undefined, status: "active" });
      setOpen(false); setSku(""); setName(""); setPrice(""); reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Layout title="Master Produk">
      <div className="flex justify-between items-center mb-4 gap-3">
        <input
          className="flex-1 max-w-xs px-3 py-2 rounded-md border border-slate-200 text-sm"
          placeholder="Cari nama / SKU…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button onClick={() => setOpen(!open)} className="px-4 py-2 rounded-md bg-brand hover:bg-brand-dark text-white text-sm font-semibold">
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
            <button disabled={saving} className="px-4 py-2 rounded-md bg-brand text-white text-sm font-semibold disabled:opacity-60">{saving ? "…" : "Simpan"}</button>
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
              <th className="text-right px-3 py-2">GMV 7h</th>
              <th className="text-left px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Memuat…</td></tr>
            ) : !filtered.length ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Belum ada produk.</td></tr>
            ) : (
              filtered.map((m) => (
                <tr key={m.id} className="border-t border-slate-100 cursor-pointer hover:bg-slate-50" onClick={() => setDetailId(m.id)}>
                  <td className="px-3 py-2">
                    <div className="font-semibold">{m.name}</div>
                    <div className="text-[10px] font-mono text-slate-400">SKU: {m.sku}</div>
                  </td>
                  <td className="px-3 py-2">{m.postingCount ?? 0}</td>
                  <td className="px-3 py-2">{m.totalStock ?? 0}</td>
                  <td className="px-3 py-2">{rupiah(m.basePrice)}</td>
                  <td className="px-3 py-2 text-right">{rupiah(m.gmv7d)}</td>
                  <td className="px-3 py-2">
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-600 capitalize">{m.status}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {detailId && (
        <ProductDetail
          id={detailId}
          onClose={() => setDetailId(null)}
          onChanged={reload}
        />
      )}
    </Layout>
  );
}

function ProductDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data, loading, reload } = useFetch<MasterDetail>(`/products/${id}`);
  const shops = useFetch<Shop[]>("/shops");
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // edit form state
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [status, setStatus] = useState("active");

  // add-posting form state
  const [showAdd, setShowAdd] = useState(false);
  const [pShop, setPShop] = useState("");
  const [pTitle, setPTitle] = useState("");
  const [pItemId, setPItemId] = useState("");
  const [pPrice, setPPrice] = useState("");
  const [pStock, setPStock] = useState("");

  function startEdit() {
    if (!data) return;
    setName(data.name); setPrice(data.basePrice ?? ""); setStatus(data.status); setEditing(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await api.patch(`/products/${id}`, { name, basePrice: price || undefined, status });
      setEditing(false); reload(); onChanged();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function removeMaster() {
    if (!confirm("Hapus master produk ini beserta semua postingannya?")) return;
    setBusy(true); setErr(null);
    try { await api.del(`/products/${id}`); onChanged(); onClose(); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  async function addPosting(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await api.post(`/products/${id}/postings`, {
        shopId: pShop,
        marketplaceItemId: pItemId,
        marketplaceSku: data?.sku,
        title: pTitle || undefined,
        price: pPrice || undefined,
        stock: pStock ? Number(pStock) : undefined,
        status: "active",
      });
      setShowAdd(false); setPShop(""); setPTitle(""); setPItemId(""); setPPrice(""); setPStock("");
      reload(); onChanged();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function removePosting(postingId: string) {
    if (!confirm("Hapus postingan ini?")) return;
    setBusy(true); setErr(null);
    try { await api.del(`/products/postings/${postingId}`); reload(); onChanged(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-[560px] max-w-full max-h-[88vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4">
          <div className="font-bold">Detail Produk</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button>
        </div>

        {err && <div className="text-red-500 text-xs mb-3">{err}</div>}

        {loading || !data ? (
          <div className="text-slate-400 text-sm py-6 text-center">Memuat…</div>
        ) : (
          <>
            {!editing ? (
              <div className="mb-4">
                <div className="text-lg font-extrabold">{data.name}</div>
                <div className="text-[11px] font-mono text-slate-400 mb-2">SKU: {data.sku}</div>
                <div className="flex gap-4 text-sm">
                  <span>Harga: <b>{rupiah(data.basePrice)}</b></span>
                  <span className="capitalize">Status: <b>{data.status}</b></span>
                </div>
                <div className="flex gap-2 mt-3">
                  <button onClick={startEdit} className="px-3 py-1.5 rounded-md border border-slate-200 text-sm font-semibold hover:bg-slate-50">Edit</button>
                  <button onClick={removeMaster} disabled={busy} className="px-3 py-1.5 rounded-md border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50">Hapus</button>
                </div>
              </div>
            ) : (
              <form onSubmit={saveEdit} className="mb-4 grid grid-cols-2 gap-3 items-end bg-slate-50 rounded-lg p-3">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Nama</label>
                  <input className="w-full px-3 py-2 rounded-md border border-slate-200 text-sm" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Harga</label>
                  <input className="w-full px-3 py-2 rounded-md border border-slate-200 text-sm" value={price} onChange={(e) => setPrice(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Status</label>
                  <select className="w-full px-3 py-2 rounded-md border border-slate-200 text-sm bg-white" value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                    <option value="draft">draft</option>
                  </select>
                </div>
                <div className="col-span-2 flex gap-2">
                  <button disabled={busy} className="px-4 py-2 rounded-md bg-brand text-white text-sm font-semibold disabled:opacity-60">Simpan</button>
                  <button type="button" onClick={() => setEditing(false)} className="px-4 py-2 rounded-md border border-slate-200 text-sm font-semibold">Batal</button>
                </div>
              </form>
            )}

            <div className="flex items-center justify-between mb-2">
              <div className="font-bold text-sm">Postingan per Toko</div>
              <button onClick={() => setShowAdd(!showAdd)} className="text-xs text-brand font-semibold">+ Tambah postingan</button>
            </div>

            {showAdd && (
              <form onSubmit={addPosting} className="mb-3 grid grid-cols-2 gap-2 bg-slate-50 rounded-lg p-3">
                <select className="px-3 py-2 rounded-md border border-slate-200 text-sm bg-white col-span-2" value={pShop} onChange={(e) => setPShop(e.target.value)} required>
                  <option value="">Pilih toko…</option>
                  {(shops.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.shopName ?? s.id} ({s.marketplace})</option>)}
                </select>
                <input className="px-3 py-2 rounded-md border border-slate-200 text-sm" placeholder="Marketplace item ID" value={pItemId} onChange={(e) => setPItemId(e.target.value)} required />
                <input className="px-3 py-2 rounded-md border border-slate-200 text-sm" placeholder="Judul postingan" value={pTitle} onChange={(e) => setPTitle(e.target.value)} />
                <input className="px-3 py-2 rounded-md border border-slate-200 text-sm" placeholder="Harga" value={pPrice} onChange={(e) => setPPrice(e.target.value)} />
                <input className="px-3 py-2 rounded-md border border-slate-200 text-sm" placeholder="Stok" value={pStock} onChange={(e) => setPStock(e.target.value.replace(/\D/g, ""))} />
                <div className="col-span-2 text-[11px] text-slate-400">SKU postingan otomatis = <b>{data.sku}</b> (untuk linking).</div>
                <button disabled={busy} className="col-span-2 px-4 py-2 rounded-md bg-brand text-white text-sm font-semibold disabled:opacity-60">Tambah</button>
              </form>
            )}

            {!data.shops.length ? (
              <div className="text-slate-400 text-sm py-3 text-center">Belum ada postingan terhubung.</div>
            ) : (
              data.shops.map((sg) => (
                <div key={sg.shopId} className="mb-3">
                  <div className="text-xs font-semibold text-slate-500 mb-1 capitalize">{sg.shopName ?? sg.shopId} · {sg.marketplace}</div>
                  <div className="border border-slate-100 rounded-lg divide-y divide-slate-100">
                    {sg.postings.map((p) => (
                      <div key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
                        <div>
                          <div className="font-medium">{p.title ?? p.marketplaceSku ?? p.id}</div>
                          <div className="text-[11px] text-slate-400">{rupiah(p.price)} · stok {p.stock ?? 0} · {p.status}</div>
                        </div>
                        <button onClick={() => removePosting(p.id)} className="text-red-500 text-xs hover:underline">Hapus</button>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}

            <MasterBom masterId={id} masterName={data.name} />
          </>
        )}
      </div>
    </div>
  );
}

interface BomLite {
  id: string;
  masterProductId: string;
  materialName: string;
  quantity: string;
  unit: string | null;
  currentStock: string;
  minimumThreshold: string;
  lowStock: boolean;
}

/** BOM materials linked to this master product (read + quick add). */
function MasterBom({ masterId, masterName }: { masterId: string; masterName: string }) {
  const { data, reload } = useFetch<BomLite[]>("/bom");
  const linked = (data ?? []).filter((b) => b.masterProductId === masterId);
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await api.post("/bom", { masterProductId: masterId, materialName: name, quantity: qty, unit: unit || undefined });
      setShow(false); setName(""); setQty(""); reload();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="mt-4 pt-3 border-t border-slate-100">
      <div className="flex items-center justify-between mb-2">
        <div className="font-bold text-sm">Bahan Baku (BOM)</div>
        <button onClick={() => setShow(!show)} className="text-xs text-brand font-semibold">+ Tambah bahan</button>
      </div>
      {show && (
        <form onSubmit={add} className="mb-2 grid grid-cols-4 gap-2 bg-slate-50 rounded-lg p-2">
          <input className="col-span-2 px-2 py-1.5 rounded-md border border-slate-200 text-sm" placeholder="Nama bahan" value={name} onChange={(e) => setName(e.target.value)} required />
          <input className="px-2 py-1.5 rounded-md border border-slate-200 text-sm" placeholder="Qty/produk" value={qty} onChange={(e) => setQty(e.target.value)} required />
          <input className="px-2 py-1.5 rounded-md border border-slate-200 text-sm" placeholder="Satuan" value={unit} onChange={(e) => setUnit(e.target.value)} />
          <button disabled={busy} className="col-span-4 px-3 py-1.5 rounded-md bg-brand text-white text-xs font-semibold disabled:opacity-60">Tambah ke {masterName}</button>
          {err && <div className="col-span-4 text-red-500 text-xs">{err}</div>}
        </form>
      )}
      {!linked.length ? (
        <div className="text-slate-400 text-xs py-2">Belum ada bahan baku. Tambahkan agar stok auto-deduct saat order masuk.</div>
      ) : (
        <div className="border border-slate-100 rounded-lg divide-y divide-slate-100">
          {linked.map((b) => (
            <div key={b.id} className={`flex items-center justify-between px-3 py-2 text-sm ${b.lowStock ? "bg-red-50" : ""}`}>
              <div>{b.materialName} <span className="text-[10px] text-slate-400">{b.quantity}{b.unit}/produk</span></div>
              <div className="text-[11px]">stok <b className={b.lowStock ? "text-red-600" : ""}>{b.currentStock}</b> / min {b.minimumThreshold}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
