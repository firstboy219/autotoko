import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { api } from "../lib/api";
import { useAccount, type Me } from "../lib/account";
import { useAuth } from "../lib/auth";

const PLAN_LABEL: Record<string, string> = { freemium: "Freemium", starter: "Starter", pro: "Pro" };

export function Akun() {
  const navigate = useNavigate();
  const { me, load, setMe, reset } = useAccount();
  const logout = useAuth((s) => s.logout);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (me) setName(me.fullName ?? ""); }, [me]);

  async function save() {
    setBusy(true); setErr(null); setOk(false);
    try {
      const updated = await api.patch<Me>("/account/me", { fullName: name.trim() });
      setMe(updated); setOk(true);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  function doLogout() { reset(); logout(); navigate("/login"); }

  return (
    <Layout title="Akun Saya">
      {!me && <div className="text-slate-400 text-sm">Memuat…</div>}
      {me && (
        <div className="max-w-lg space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="text-sm font-semibold text-slate-700 mb-3">Profil</div>
            <label className="block text-xs text-slate-500 mb-1">Nama lengkap / toko</label>
            <div className="flex gap-2 mb-3">
              <input className="flex-1 px-3 py-2 rounded-md border border-slate-200 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
              <button onClick={save} disabled={busy || name.trim().length < 2} className="px-3 rounded-md bg-brand hover:bg-brand-dark text-white text-xs font-semibold disabled:opacity-40">{busy ? "…" : "Simpan"}</button>
            </div>
            {ok && <div className="text-green-600 text-xs">✓ Tersimpan</div>}
            {err && <div className="text-red-500 text-xs">{err}</div>}
            <div className="grid grid-cols-2 gap-3 mt-3 text-sm">
              <Info label="Email" value={me.email ?? "—"} />
              <Info label="WhatsApp" value={me.whatsapp ?? "—"} />
              <Info label="Member sejak" value={new Date(me.createdAt).toLocaleDateString("id-ID")} />
              <Info label="Saldo wallet" value={"Rp " + Number(me.walletBalance).toLocaleString("id-ID")} />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-500">Paket aktif</div>
              <div className="font-bold text-slate-800">{PLAN_LABEL[me.planType]}</div>
            </div>
            <button onClick={() => navigate("/paket")} className="px-3 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold">Ubah paket</button>
          </div>

          <button onClick={doLogout} className="text-sm text-red-500 hover:text-red-600 font-semibold">⎋ Keluar dari akun</button>
        </div>
      )}
    </Layout>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="text-slate-700">{value}</div>
    </div>
  );
}
