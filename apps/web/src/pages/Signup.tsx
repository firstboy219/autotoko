import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useAccount } from "../lib/account";
import { useBranding } from "../lib/branding";
import { WaLogin, EmailLogin } from "../components/AuthForms";

type Tab = "email" | "wa";

export function Signup() {
  const navigate = useNavigate();
  const applyToken = useAuth((s) => s.applyToken);
  const loadMe = useAccount((s) => s.load);
  const brand = useBranding((s) => s.branding);
  const brandName = brand?.name ?? "AutoToko";
  const [tab, setTab] = useState<Tab>("email");

  // After verify → load profile, then go to onboarding (identity pre-filled there).
  async function done(token: string) {
    applyToken(token);
    await loadMe(true);
    navigate("/onboarding");
  }

  return (
    <div className="min-h-screen flex items-center justify-center font-sans bg-[#F0F4F8] p-4">
      <div className="bg-white rounded-xl border border-slate-200 p-8 w-[380px] shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          {brand?.logoUrl ? (
            <img src={brand.logoUrl} alt={brandName} className="w-9 h-9 rounded-lg object-contain" />
          ) : (
            <div className="w-9 h-9 rounded-lg bg-brand font-extrabold flex items-center justify-center">{brandName.charAt(0).toUpperCase()}</div>
          )}
          <div>
            <div className="font-extrabold text-lg leading-none">Daftar {brandName}</div>
            <div className="text-[10px] uppercase tracking-wide text-slate-400">Gratis · tanpa password</div>
          </div>
        </div>
        <p className="text-xs text-slate-500 mb-5 mt-2">Buat akun pakai email atau WhatsApp. Verifikasi sekali, langsung lanjut isi profil toko.</p>

        <div className="flex mb-5 rounded-lg bg-slate-100 p-1 text-sm font-semibold">
          <button onClick={() => setTab("email")} className={`flex-1 py-1.5 rounded-md ${tab === "email" ? "bg-white shadow-sm text-brand" : "text-slate-500"}`}>Email</button>
          <button onClick={() => setTab("wa")} className={`flex-1 py-1.5 rounded-md ${tab === "wa" ? "bg-white shadow-sm text-brand" : "text-slate-500"}`}>WhatsApp</button>
        </div>

        {tab === "email" ? (
          <EmailLogin verifyLabel="Daftar" onDone={(t) => done(t)} />
        ) : (
          <WaLogin ctaLabel="Daftar via WhatsApp" onDone={(t) => done(t)} />
        )}

        <p className="text-[12px] text-slate-500 text-center mt-4">
          Sudah punya akun?{" "}
          <Link to="/login" className="text-brand font-semibold hover:underline">Masuk</Link>
        </p>
        <p className="text-[10px] text-slate-400 text-center mt-3">
          Dengan mendaftar kamu setuju pada{" "}
          <Link to="/terms" className="hover:underline">Ketentuan</Link> &{" "}
          <Link to="/privacy" className="hover:underline">Privasi</Link>.
        </p>
      </div>
    </div>
  );
}
