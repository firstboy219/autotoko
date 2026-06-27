import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAccount, type Me } from "../lib/account";

interface Plan {
  planType: "freemium" | "starter" | "pro";
  monthlyFee: string | null;
  setupFee: string | null;
  maxShops: number | null;
  maxOrdersPerMonth: number | null;
}

const PLAN_LABEL: Record<string, string> = { freemium: "Freemium", starter: "Starter", pro: "Pro" };
const rp = (n: number) => "Rp " + n.toLocaleString("id-ID");

export function Onboarding() {
  const navigate = useNavigate();
  const setMe = useAccount((s) => s.setMe);
  const me = useAccount((s) => s.me);
  const loadMe = useAccount((s) => s.load);
  const [step, setStep] = useState(1);
  const [fullName, setFullName] = useState("");
  const [plan, setPlan] = useState<"freemium" | "starter" | "pro">("freemium");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Ensure we know who is signing up (email/WhatsApp from OTP).
  useEffect(() => { loadMe(); }, [loadMe]);
  // Pre-fill name if it somehow already exists.
  useEffect(() => { if (me?.fullName) setFullName(me.fullName); }, [me?.fullName]);

  // Already onboarded? skip.
  useEffect(() => {
    if (me?.onboarded) navigate("/", { replace: true });
  }, [me, navigate]);

  const identity = me?.email ?? me?.whatsapp ?? null;

  useEffect(() => {
    api.get<Plan[]>("/account/plans").then(setPlans).catch(() => {});
  }, []);

  async function finish(connectAfter: boolean) {
    setBusy(true);
    setErr(null);
    try {
      await api.patch("/account/me", { fullName: fullName.trim() });
      const updated = await api.post<Me>("/account/plan", { planType: plan });
      setMe(updated);
      navigate(connectAfter ? "/toko" : "/", { replace: true });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F0F4F8] font-sans p-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-8 w-[440px] shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-9 h-9 rounded-lg bg-brand text-white font-extrabold flex items-center justify-center">A</div>
          <div className="font-extrabold text-lg">Selamat datang di AutoToko</div>
        </div>
        <div className="text-xs text-slate-400 mb-3">Langkah {step} dari 3 — yuk siapkan akunmu.</div>
        {identity && (
          <div className="mb-4 text-[12px] bg-brand-light text-slate-600 rounded-md px-3 py-2">
            Mendaftar sebagai <b className="text-slate-800">{identity}</b>
          </div>
        )}

        {step === 1 && (
          <div>
            <label className="block text-sm font-semibold text-slate-600 mb-1">Nama lengkap / nama toko</label>
            <input
              autoFocus
              className="w-full mb-4 px-3 py-2 rounded-md border border-slate-200 text-sm focus:outline-none focus:border-brand"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="cth. Kopi Nusantara"
            />
            <button
              disabled={fullName.trim().length < 2}
              onClick={() => setStep(2)}
              className="w-full py-2 rounded-md bg-brand hover:bg-brand-dark text-white text-sm font-semibold disabled:opacity-40"
            >
              Lanjut
            </button>
          </div>
        )}

        {step === 2 && (
          <div>
            <div className="text-sm font-semibold text-slate-600 mb-2">Pilih paket</div>
            <div className="space-y-2 mb-4">
              {(plans.length ? plans : [{ planType: "freemium" } as Plan]).map((p) => (
                <button
                  key={p.planType}
                  onClick={() => setPlan(p.planType)}
                  className={`w-full text-left p-3 rounded-lg border ${plan === p.planType ? "border-brand bg-brand/5" : "border-slate-200"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">{PLAN_LABEL[p.planType]}</span>
                    <span className="text-sm text-slate-600">
                      {p.monthlyFee && Number(p.monthlyFee) > 0 ? rp(Number(p.monthlyFee)) + "/bln" : "Gratis"}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {p.maxShops ? `${p.maxShops} toko · ` : ""}
                    {p.maxOrdersPerMonth ? `${p.maxOrdersPerMonth} order/bln` : "Order tak terbatas"}
                  </div>
                </button>
              ))}
            </div>
            {err && <div className="text-red-500 text-xs mb-2">{err}</div>}
            <div className="flex gap-2">
              <button onClick={() => setStep(1)} className="flex-1 py-2 rounded-md border border-slate-200 text-slate-600 text-sm font-semibold">Kembali</button>
              <button disabled={busy} onClick={() => setStep(3)} className="flex-1 py-2 rounded-md bg-brand hover:bg-brand-dark text-white text-sm font-semibold disabled:opacity-40">Lanjut</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <div className="text-sm font-semibold text-slate-600 mb-1">Hubungkan toko pertamamu</div>
            <p className="text-xs text-slate-400 mb-4">Sambungkan TikTok Shop / Shopee agar order & produk tersinkron otomatis. Bisa juga nanti.</p>
            {err && <div className="text-red-500 text-xs mb-2">{err}</div>}
            <button disabled={busy} onClick={() => finish(true)} className="w-full py-2 mb-2 rounded-md bg-brand hover:bg-brand-dark text-white text-sm font-semibold disabled:opacity-40">
              {busy ? "Menyimpan…" : "Hubungkan Toko Sekarang"}
            </button>
            <button disabled={busy} onClick={() => finish(false)} className="w-full py-2 rounded-md border border-slate-200 text-slate-600 text-sm font-semibold disabled:opacity-40">
              Nanti saja, ke Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
