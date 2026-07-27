import { useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";

interface SubSeller {
  id: string; name: string; contact: string | null; bankAccount: string | null;
  defaultRate: string; status: "active" | "inactive"; kuotaTokoMaksimal: number | null;
}
interface SubSubSeller extends SubSeller { subSellerId: string; }
interface ShopOpt {
  id: string; marketplace: string; shopName: string;
  subSellerId: string | null; subSubSellerId: string | null; scenario: "A" | "B" | "C";
}

const pct = (r: string) => `${(Number(r) * 100).toFixed(1)}%`;
const kuotaLabel = (k: number | null) => (k == null ? "Tanpa batas" : `${k} toko`);

export function PencairanSubSeller() {
  const subs = useFetch<SubSeller[]>("/payout/sub-sellers");
  const subsubs = useFetch<SubSubSeller[]>("/payout/sub-sub-sellers");
  const shops = useFetch<ShopOpt[]>("/payout/shops");

  return (
    <Layout title="Manajemen Sub-seller">
      <Link to="/pencairan" className="text-xs text-brand font-semibold hover:underline">← Kembali</Link>
      <div className="mt-3 space-y-4">
        <CreateSubSeller onDone={subs.reload} />
        <SubSellerTable subs={subs.data ?? []} subsubs={subsubs.data ?? []}
          onChange={() => { subs.reload(); subsubs.reload(); }} />
        <ShopAssignTable shops={shops.data ?? []} subs={subs.data ?? []} subsubs={subsubs.data ?? []}
          onChange={shops.reload} />
      </div>
    </Layout>
  );
}

function CreateSubSeller({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [bank, setBank] = useState("");
  const [rate, setRate] = useState("20");
  const [kuota, setKuota] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.post("/payout/sub-sellers", {
        name, contact: contact || undefined, bankAccount: bank || undefined,
        defaultRate: Number(rate) / 100,
        ...(kuota !== "" ? { kuotaTokoMaksimal: Number(kuota) } : {}),
      });
      setName(""); setContact(""); setBank(""); setRate("20"); setKuota(""); onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="font-bold text-sm mb-3">Tambah Sub-seller</div>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama" required
          className="px-2 py-2 rounded-md border border-slate-300 text-sm" />
        <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Kontak (HP/email)"
          className="px-2 py-2 rounded-md border border-slate-300 text-sm" />
        <input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Rekening tujuan"
          className="px-2 py-2 rounded-md border border-slate-300 text-sm" />
        <div className="flex items-center gap-1">
          <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))}
            className="px-2 py-2 rounded-md border border-slate-300 text-sm w-16" />
          <span className="text-sm text-slate-500">% rate</span>
        </div>
        <div className="flex items-center gap-1">
          <input inputMode="numeric" value={kuota} onChange={(e) => setKuota(e.target.value.replace(/\D/g, ""))}
            placeholder="∞" className="px-2 py-2 rounded-md border border-slate-300 text-sm w-16" />
          <span className="text-xs text-slate-500">kuota toko</span>
        </div>
      </div>
      {err && <div className="text-red-500 text-xs mt-2">{err}</div>}
      <button disabled={busy || !name} className="mt-3 px-4 py-2 rounded-md bg-brand hover:bg-brand-dark text-white text-sm font-semibold disabled:opacity-50">
        {busy ? "…" : "Tambah"}
      </button>
    </form>
  );
}

function SubSellerTable({
  subs, subsubs, onChange,
}: { subs: SubSeller[]; subsubs: SubSubSeller[]; onChange: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 font-bold text-sm">Sub-seller ({subs.length})</div>
      {!subs.length ? (
        <div className="px-4 py-6 text-center text-slate-400 text-sm">Belum ada sub-seller.</div>
      ) : subs.map((s) => {
        const children = subsubs.filter((ss) => ss.subSellerId === s.id);
        return (
          <div key={s.id} className="border-t border-slate-100">
            <div className="px-4 py-2 flex items-center justify-between flex-wrap gap-2">
              <div>
                <span className="font-semibold text-sm">{s.name}</span>
                <span className="text-xs text-slate-400 ml-2">{pct(s.defaultRate)}</span>
                {s.contact && <span className="text-xs text-slate-400 ml-2">· {s.contact}</span>}
                <span className={`ml-2 text-[10px] font-semibold px-2 py-0.5 rounded ${s.status === "active" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                  {s.status === "active" ? "Aktif" : "Nonaktif"}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <KuotaEditor endpoint={`/payout/sub-sellers/${s.id}`} current={s.kuotaTokoMaksimal} onDone={onChange} />
                <button onClick={() => setOpenId(openId === s.id ? null : s.id)} className="text-xs text-brand font-semibold hover:underline">
                  {children.length} sub-sub · {openId === s.id ? "tutup" : "kelola"}
                </button>
              </div>
            </div>
            {openId === s.id && (
              <div className="px-4 pb-3 bg-slate-50">
                <CreateSubSubSeller subSellerId={s.id} onDone={onChange} />
                {children.map((c) => (
                  <div key={c.id} className="text-xs py-1 flex justify-between items-center border-t border-slate-100">
                    <span>↳ {c.name} · {pct(c.defaultRate)}{c.contact ? ` · ${c.contact}` : ""}</span>
                    <div className="flex items-center gap-2">
                      <span className={c.status === "active" ? "text-green-600" : "text-slate-400"}>{c.status === "active" ? "aktif" : "nonaktif"}</span>
                      <KuotaEditor endpoint={`/payout/sub-sub-sellers/${c.id}`} current={c.kuotaTokoMaksimal} onDone={onChange} small />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function KuotaEditor({
  endpoint, current, onDone, small,
}: { endpoint: string; current: number | null; onDone: () => void; small?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(current == null ? "" : String(current));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.patch(endpoint, { kuotaTokoMaksimal: val === "" ? null : Number(val) });
      setEditing(false); onDone();
    } finally { setBusy(false); }
  }

  if (!editing) {
    return (
      <button onClick={() => setEditing(true)}
        className={`${small ? "text-[10px]" : "text-xs"} text-slate-400 hover:text-brand hover:underline`}>
        Kuota toko: {kuotaLabel(current)}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <input inputMode="numeric" value={val} onChange={(e) => setVal(e.target.value.replace(/\D/g, ""))}
        placeholder="∞" className="w-14 px-1.5 py-1 rounded border border-slate-300 text-xs" autoFocus />
      <button onClick={save} disabled={busy} className="text-[10px] px-2 py-1 rounded bg-brand text-white font-semibold disabled:opacity-50">✓</button>
      <button onClick={() => setEditing(false)} className="text-[10px] text-slate-400">✕</button>
    </div>
  );
}

function CreateSubSubSeller({ subSellerId, onDone }: { subSellerId: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const [rate, setRate] = useState("50");
  const [kuota, setKuota] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.post("/payout/sub-sub-sellers", {
        subSellerId, name, defaultRate: Number(rate) / 100,
        ...(kuota !== "" ? { kuotaTokoMaksimal: Number(kuota) } : {}),
      });
      setName(""); setRate("50"); setKuota(""); onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap gap-2 items-center py-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama sub-sub-seller" required
        className="px-2 py-1.5 rounded-md border border-slate-300 text-sm" />
      <div className="flex items-center gap-1">
        <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))}
          className="px-2 py-1.5 rounded-md border border-slate-300 text-sm w-16" />
        <span className="text-xs text-slate-500">% dari jatah sub-seller</span>
      </div>
      <div className="flex items-center gap-1">
        <input inputMode="numeric" value={kuota} onChange={(e) => setKuota(e.target.value.replace(/\D/g, ""))}
          placeholder="∞" className="px-2 py-1.5 rounded-md border border-slate-300 text-sm w-14" />
        <span className="text-xs text-slate-500">kuota toko</span>
      </div>
      <button disabled={busy || !name} className="text-xs px-3 py-1.5 rounded bg-brand hover:bg-brand-dark text-white font-semibold disabled:opacity-50">
        + Tambah
      </button>
      {err && <span className="text-red-500 text-xs">{err}</span>}
    </form>
  );
}

function ShopAssignTable({
  shops, subs, subsubs, onChange,
}: { shops: ShopOpt[]; subs: SubSeller[]; subsubs: SubSubSeller[]; onChange: () => void }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 font-bold text-sm">Penugasan Toko</div>
      {!shops.length ? (
        <div className="px-4 py-6 text-center text-slate-400 text-sm">Belum ada toko terhubung.</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {shops.map((sh) => (
            <ShopAssignRow key={sh.id} shop={sh} subs={subs} subsubs={subsubs} onChange={onChange} />
          ))}
        </div>
      )}
    </div>
  );
}

function ShopAssignRow({
  shop, subs, subsubs, onChange,
}: { shop: ShopOpt; subs: SubSeller[]; subsubs: SubSubSeller[]; onChange: () => void }) {
  const [subSellerId, setSubSellerId] = useState(shop.subSellerId ?? "");
  const [subSubSellerId, setSubSubSellerId] = useState(shop.subSubSellerId ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const children = subsubs.filter((ss) => ss.subSellerId === subSellerId);

  async function save() {
    setBusy(true); setErr(null);
    try {
      await api.post(`/payout/shops/${shop.id}/assign`, {
        subSellerId: subSellerId || null,
        subSubSellerId: subSellerId ? (subSubSellerId || null) : null,
      });
      onChange();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="px-4 py-2 flex flex-wrap items-center gap-2">
      <div className="min-w-[160px]">
        <span className="font-semibold text-sm">{shop.shopName}</span>
        <span className="text-xs text-slate-400 ml-1">({shop.marketplace})</span>
      </div>
      <select value={subSellerId} onChange={(e) => { setSubSellerId(e.target.value); setSubSubSellerId(""); }}
        className="px-2 py-1.5 rounded-md border border-slate-300 text-sm">
        <option value="">— milik Seller —</option>
        {subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <select value={subSubSellerId} onChange={(e) => setSubSubSellerId(e.target.value)} disabled={!subSellerId}
        className="px-2 py-1.5 rounded-md border border-slate-300 text-sm disabled:bg-slate-100">
        <option value="">— tanpa sub-sub —</option>
        {children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <button onClick={save} disabled={busy} className="text-xs px-3 py-1.5 rounded bg-brand hover:bg-brand-dark text-white font-semibold disabled:opacity-50">
        Simpan
      </button>
      {err && <span className="text-red-500 text-xs">{err}</span>}
    </div>
  );
}
