import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { portalApi, setPortalToken } from "../lib/portalApi";

export function PortalLogin() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await portalApi.post("/payout/portal/auth/start", { email });
      setStep("code");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const { accessToken } = await portalApi.post<{ accessToken: string }>(
        "/payout/portal/auth/verify",
        { email, code },
      );
      setPortalToken(accessToken);
      navigate("/portal");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F0F4F8] px-4">
      <div className="w-full max-w-sm bg-white rounded-xl border border-slate-200 p-6">
        <div className="text-center mb-4">
          <div className="font-extrabold text-lg">Portal Sub-seller</div>
          <div className="text-xs text-slate-500 mt-1">Masuk dengan email yang terdaftar</div>
        </div>

        {step === "email" ? (
          <form onSubmit={sendCode} className="space-y-3">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="Email Anda" className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm" />
            {err && <div className="text-red-500 text-xs">{err}</div>}
            <button disabled={busy} className="w-full px-4 py-2 rounded-md bg-brand hover:bg-brand-dark text-white text-sm font-semibold disabled:opacity-50">
              {busy ? "…" : "Kirim Kode"}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-3">
            <div className="text-xs text-slate-500">Kode terkirim ke {email}</div>
            <input required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="Kode 6 digit" maxLength={6}
              className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm tracking-widest text-center" />
            {err && <div className="text-red-500 text-xs">{err}</div>}
            <button disabled={busy} className="w-full px-4 py-2 rounded-md bg-brand hover:bg-brand-dark text-white text-sm font-semibold disabled:opacity-50">
              {busy ? "…" : "Masuk"}
            </button>
            <button type="button" onClick={() => setStep("email")} className="w-full text-xs text-slate-400 hover:underline">
              Ganti email
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
