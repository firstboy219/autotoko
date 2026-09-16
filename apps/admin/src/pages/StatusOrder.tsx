import { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { api } from "../lib/api";

interface Cfg {
  defaults: Record<string, string>;
  override: Record<string, string>;
  effective: Record<string, string>;
  rules: string;
  internalStatuses: string[];
}

const LABELS: Record<string, string> = {
  masuk: "Menunggu Disetujui",
  approved: "Menunggu Dicetak",
  produksi: "Produksi",
  packing: "Menunggu Dipacking",
  siap_kirim: "Menunggu Dipickup",
  dikirim: "Dalam Pengiriman",
  selesai: "Selesai",
  retur: "Retur",
  dibatalkan: "Dibatalkan",
};

export function StatusOrder() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});
  const [rules, setRules] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function load() {
    api.get<Cfg>("/admin/order-config").then((c) => {
      setCfg(c);
      setMap(c.effective);
      setRules(c.rules);
    }).catch((e) => setMsg((e as Error).message));
  }
  useEffect(() => { load(); }, []);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      await api.put("/admin/order-config", { mapping: map, rules });
      setMsg("Tersimpan ✓ (berlaku untuk sinkronisasi berikutnya)");
      load();
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }

  if (!cfg) {
    return <Layout title="Status Order & Aturan"><div className="text-slate-400 text-sm">{msg ?? "Memuat…"}</div></Layout>;
  }
  const keys = Object.keys(cfg.effective);

  return (
    <Layout title="Status Order & Aturan">
      <p className="text-sm text-slate-400 mb-4 max-w-2xl">
        Pemetaan status marketplace → tahap internal AutoToko, dipakai saat sinkronisasi pesanan.
        <b className="text-slate-300"> Doktrin:</b> "sudah dipacking" dibuktikan oleh <b>SCAN packer</b>,
        bukan status marketplace — karena itu <span className="font-mono">AWAITING_COLLECTION</span> default =
        Menunggu Dipacking (scan yang memajukan ke Menunggu Dipickup). Perubahan berlaku forward-only
        (status yang sudah lebih maju tak ditarik mundur).
      </p>

      <div className="bg-[#1e293b] rounded-xl border border-white/10 p-4 mb-4">
        <div className="font-bold text-sm mb-3 text-white">Pemetaan Status (TikTok → Internal)</div>
        <div className="space-y-2">
          {keys.map((k) => (
            <div key={k} className="flex items-center gap-3">
              <span className="w-56 text-sm text-slate-300 font-mono truncate">{k}</span>
              <span className="text-slate-500">→</span>
              <select
                value={map[k] ?? cfg.defaults[k] ?? "masuk"}
                onChange={(e) => setMap({ ...map, [k]: e.target.value })}
                className="flex-1 px-3 py-1.5 rounded-md bg-[#0f172a] border border-white/10 text-sm text-slate-100"
              >
                {cfg.internalStatuses.map((s) => (
                  <option key={s} value={s}>{(LABELS[s] ?? s)} ({s})</option>
                ))}
              </select>
              {map[k] !== (cfg.defaults[k] ?? "") && (
                <span className="text-[10px] text-amber-400 whitespace-nowrap">≠ default ({cfg.defaults[k] ?? "—"})</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-[#1e293b] rounded-xl border border-white/10 p-4 mb-4">
        <div className="font-bold text-sm mb-2 text-white">Aturan Operasional & Knowledge</div>
        <p className="text-xs text-slate-400 mb-2">Catatan aturan/kesepakatan penting (mis. bukti packing = scan, auto-proses, dsb). Tersimpan di platform.</p>
        <textarea
          value={rules}
          onChange={(e) => setRules(e.target.value)}
          rows={14}
          className="w-full px-3 py-2 rounded-md bg-[#0f172a] border border-white/10 text-sm text-slate-100 font-mono leading-relaxed"
          placeholder="Tulis aturan operasional di sini…"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy}
          className="px-4 py-2 rounded-md bg-brand hover:bg-brand-dark text-white text-sm font-semibold disabled:opacity-40"
        >
          {busy ? "Menyimpan…" : "Simpan"}
        </button>
        {msg && <span className="text-sm text-slate-300">{msg}</span>}
      </div>
    </Layout>
  );
}
