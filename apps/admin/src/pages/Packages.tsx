import { useState } from "react";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";

interface Pkg {
  code: string;
  name: string;
  setupFee: string;
  monthlyFee: string;
  perTransactionFee: string;
  maxShops: number | null;
  maxOrdersPerMonth: number | null;
  activityFees?: Record<string, number>;
  isActive: boolean;
  sortOrder: number;
}

const numStr = (v: string | number | null | undefined) => (v == null ? "" : String(v));

function Field({ label, value, set, ph }: { label: string; value: string; set: (s: string) => void; ph?: string }) {
  return (
    <div className="mb-2">
      <label className="block text-[11px] text-slate-400 mb-1">{label}</label>
      <input
        value={value}
        placeholder={ph}
        onChange={(e) => set(e.target.value)}
        className="w-full px-2 py-1.5 rounded-md bg-[#0f172a] border border-white/10 text-sm text-slate-100"
      />
    </div>
  );
}

function PkgCard({ pkg, onChanged }: { pkg: Pkg; onChanged: () => void }) {
  const af = pkg.activityFees ?? {};
  const [name, setName] = useState(pkg.name);
  const [setupFee, setSetup] = useState(pkg.setupFee);
  const [monthlyFee, setMonthly] = useState(pkg.monthlyFee);
  const [maxShops, setMaxShops] = useState(numStr(pkg.maxShops));
  const [maxOrders, setMaxOrders] = useState(numStr(pkg.maxOrdersPerMonth));
  const [feeOrder, setFeeOrder] = useState(String(af.order ?? "0"));
  const [feeShop, setFeeShop] = useState(String(af.shop_connect ?? "0"));
  const [feeProduct, setFeeProduct] = useState(String(af.product_create ?? "0"));
  const [feeAudit, setFeeAudit] = useState(String(af.audit_run ?? "0"));
  const [isActive, setActive] = useState(pkg.isActive);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  async function save() {
    setBusy(true); setOk(false); setErr(null);
    try {
      await api.put(`/admin/packages/${pkg.code}`, {
        name,
        setupFee,
        monthlyFee,
        maxShops: maxShops === "" ? undefined : Number(maxShops),
        maxOrdersPerMonth: maxOrders === "" ? undefined : Number(maxOrders),
        isActive,
        activityFees: {
          order: Number(feeOrder) || 0,
          shop_connect: Number(feeShop) || 0,
          product_create: Number(feeProduct) || 0,
          audit_run: Number(feeAudit) || 0,
        },
      });
      setOk(true); onChanged();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function del() {
    setBusy(true); setErr(null);
    try {
      await api.del(`/admin/packages/${pkg.code}`);
      onChanged();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  return (
    <div className="bg-[#1e293b] rounded-xl border border-white/10 p-4 w-72">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="font-bold text-white">{pkg.name}</div>
          <div className="text-[10px] font-mono text-slate-500">{pkg.code}</div>
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <input type="checkbox" checked={isActive} onChange={(e) => setActive(e.target.checked)} />
          Aktif
        </label>
      </div>
      <Field label="Nama paket" value={name} set={setName} />
      <Field label="Setup fee (Rp)" value={setupFee} set={setSetup} />
      <Field label="Subscription / bulan (Rp)" value={monthlyFee} set={setMonthly} />
      <div className="flex gap-2">
        <div className="flex-1"><Field label="Maks toko" value={maxShops} set={setMaxShops} ph="kosong = ∞" /></div>
        <div className="flex-1"><Field label="Maks order/bln" value={maxOrders} set={setMaxOrders} ph="kosong = ∞" /></div>
      </div>
      <div className="mt-2 mb-1 text-[11px] font-semibold text-slate-300">Fee per aktivitas (Rp) — 0 = gratis</div>
      <Field label="Order masuk / order" value={feeOrder} set={setFeeOrder} />
      <Field label="Connect toko baru / toko" value={feeShop} set={setFeeShop} />
      <Field label="Produk baru / produk" value={feeProduct} set={setFeeProduct} />
      <Field label="Run Audit Pesanan / hit" value={feeAudit} set={setFeeAudit} />
      {err && <div className="text-red-400 text-[11px] my-1">{err}</div>}
      <div className="flex gap-2 mt-2">
        <button onClick={save} disabled={busy}
          className="flex-1 py-1.5 rounded-md bg-brand hover:bg-brand-dark text-white text-xs font-semibold disabled:opacity-50">
          {busy ? "…" : ok ? "✓ Tersimpan" : "Simpan"}
        </button>
        {!confirmDel ? (
          <button onClick={() => setConfirmDel(true)}
            className="px-3 py-1.5 rounded-md bg-red-600/20 text-red-400 hover:bg-red-600/30 text-xs font-semibold">
            Hapus
          </button>
        ) : (
          <button onClick={del} disabled={busy}
            className="px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-semibold disabled:opacity-50">
            Yakin?
          </button>
        )}
      </div>
    </div>
  );
}

function CreatePkg({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    setBusy(true); setErr(null);
    try {
      await api.post(`/admin/packages`, { code, name: name || code });
      setCode(""); setName(""); setOpen(false); onCreated();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="w-72 h-full min-h-[120px] rounded-xl border border-dashed border-white/20 text-slate-400 hover:border-brand hover:text-brand text-sm font-semibold">
        + Buat paket baru
      </button>
    );
  }
  return (
    <div className="bg-[#1e293b] rounded-xl border border-brand/40 p-4 w-72">
      <div className="font-bold text-white mb-3">Paket baru</div>
      <Field label="Kode (a-z, 0-9, _)" value={code} set={setCode} ph="mis. enterprise" />
      <Field label="Nama tampilan" value={name} set={setName} ph="mis. Enterprise" />
      {err && <div className="text-red-400 text-[11px] my-1">{err}</div>}
      <div className="flex gap-2 mt-2">
        <button onClick={create} disabled={busy || !code.trim()}
          className="flex-1 py-1.5 rounded-md bg-brand hover:bg-brand-dark text-white text-xs font-semibold disabled:opacity-50">
          {busy ? "…" : "Buat"}
        </button>
        <button onClick={() => { setOpen(false); setErr(null); }}
          className="px-3 py-1.5 rounded-md border border-white/10 text-slate-300 text-xs">
          Batal
        </button>
      </div>
    </div>
  );
}

export function Packages() {
  const { data, loading, error, reload } = useFetch<Pkg[]>("/admin/packages");

  return (
    <Layout title="Paket Langganan">
      <p className="text-sm text-slate-400 mb-4">
        Paket <b>dinamis</b> tambahan di luar 3 tier bawaan (freemium / starter / pro yang diatur di halaman
        Pricing). Fee per aktivitas & limit di sini berlaku untuk seller yang di-assign paket ini di Manajemen User.
      </p>
      {error && <div className="text-red-400 text-sm mb-3">{error}</div>}
      <div className="flex gap-3 flex-wrap items-stretch">
        {loading ? (
          <div className="text-slate-500 text-sm">Memuat…</div>
        ) : (
          <>
            {(data ?? []).map((p) => (
              <PkgCard key={p.code} pkg={p} onChanged={reload} />
            ))}
            <CreatePkg onCreated={reload} />
          </>
        )}
      </div>
    </Layout>
  );
}
