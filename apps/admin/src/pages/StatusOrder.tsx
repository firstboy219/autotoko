import { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { api } from "../lib/api";

interface Row { key: string; label: string; marketplace: string; kind: "flow" | "side"; }
interface Cfg {
  config: Row[];
  defaults: Row[];
  marketplaceOptions: string[];
  mpLabel: Record<string, string>;
  rules: string;
}

export function StatusOrder() {
  const [rows, setRows] = useState<Row[]>([]);
  const [opts, setOpts] = useState<string[]>([]);
  const [mpLabel, setMpLabel] = useState<Record<string, string>>({});
  const [rules, setRules] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  function load() {
    api.get<Cfg>("/admin/order-config").then((c) => {
      setRows(c.config); setOpts(c.marketplaceOptions); setMpLabel(c.mpLabel); setRules(c.rules); setLoaded(true);
    }).catch((e) => setMsg((e as Error).message));
  }
  useEffect(() => { load(); }, []);

  const upd = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: number) => setRows((rs) => {
    const j = i + d; if (j < 0 || j >= rs.length) return rs;
    const c = [...rs]; const a = c[i]!; c[i] = c[j]!; c[j] = a; return c;
  });
  const remove = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));
  const add = () => setRows((rs) => [...rs, { key: "", label: "", marketplace: "", kind: "flow" }]);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      await api.put("/admin/order-config", { config: rows, rules });
      setMsg("Tersimpan ✓ (berlaku utk sinkronisasi & tampilan berikutnya)");
      load();
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }

  if (!loaded) return <Layout title="Status Order & Aturan"><div className="text-slate-400 text-sm">{msg ?? "Memuat…"}</div></Layout>;

  const inp = "px-2 py-1.5 rounded-md bg-[#0f172a] border border-white/10 text-sm text-slate-100";
  return (
    <Layout title="Status Order & Aturan">
      <p className="text-sm text-slate-400 mb-4 max-w-3xl">
        Tahap status INTERNAL AutoToko (urut atas→bawah = alur). Ganti nama, atur padanan status
        TikTok, urutkan, tambah/hapus. Format <b className="text-slate-200">Internal → TikTok</b>.
        Beberapa tahap internal boleh menunjuk status TikTok yang sama (mis. semua tahap "Menunggu
        Dicetak/Dipacking/Dipickup" = AWAITING_COLLECTION); sinkronisasi memakai tahap flow PERTAMA
        untuk tiap status TikTok. <b className="text-slate-200">Doktrin:</b> bukti "dipacking" =
        scan packer, bukan status marketplace.
      </p>

      <div className="bg-[#1e293b] rounded-xl border border-white/10 p-4 mb-4">
        <div className="grid grid-cols-[24px_1fr_1fr_90px_92px] gap-2 items-center text-[11px] text-slate-400 mb-2 px-1">
          <span>#</span><span>Nama tahap (internal)</span><span>Padanan TikTok</span><span>Jenis</span><span>Aksi</span>
        </div>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[24px_1fr_1fr_90px_92px] gap-2 items-center">
              <span className="text-xs text-slate-500 tabular-nums">{i + 1}</span>
              <div className="flex flex-col gap-1">
                <input className={inp} value={r.label} placeholder="Nama tampilan" onChange={(e) => upd(i, { label: e.target.value })} />
                <input className={`${inp} !text-[11px] !py-1 font-mono text-slate-400`} value={r.key} placeholder="key (a-z_)" onChange={(e) => upd(i, { key: e.target.value.toLowerCase() })} />
              </div>
              <select className={inp} value={r.marketplace} onChange={(e) => upd(i, { marketplace: e.target.value })}>
                <option value="">— murni internal —</option>
                {opts.map((o) => <option key={o} value={o}>{o} · {mpLabel[o] ?? ""}</option>)}
              </select>
              <select className={inp} value={r.kind} onChange={(e) => upd(i, { kind: e.target.value as "flow" | "side" })}>
                <option value="flow">Alur</option>
                <option value="side">Samping</option>
              </select>
              <div className="flex items-center gap-1">
                <button onClick={() => move(i, -1)} className="px-1.5 py-1 rounded bg-white/5 hover:bg-white/10 text-slate-300" title="Naik">↑</button>
                <button onClick={() => move(i, 1)} className="px-1.5 py-1 rounded bg-white/5 hover:bg-white/10 text-slate-300" title="Turun">↓</button>
                <button onClick={() => remove(i)} className="px-1.5 py-1 rounded bg-red-500/15 hover:bg-red-500/25 text-red-400" title="Hapus">✕</button>
              </div>
            </div>
          ))}
        </div>
        <button onClick={add} className="mt-3 px-3 py-1.5 rounded-md border border-white/15 text-sm text-slate-200 hover:bg-white/5">+ Tambah status</button>
      </div>

      <div className="bg-[#1e293b] rounded-xl border border-white/10 p-4 mb-4">
        <div className="font-bold text-sm mb-2 text-white">Aturan Operasional & Knowledge</div>
        <textarea value={rules} onChange={(e) => setRules(e.target.value)} rows={12}
          className="w-full px-3 py-2 rounded-md bg-[#0f172a] border border-white/10 text-sm text-slate-100 font-mono leading-relaxed" />
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={busy} className="px-4 py-2 rounded-md bg-brand hover:bg-brand-dark text-white text-sm font-semibold disabled:opacity-40">
          {busy ? "Menyimpan…" : "Simpan"}
        </button>
        {msg && <span className="text-sm text-slate-300">{msg}</span>}
      </div>
    </Layout>
  );
}
