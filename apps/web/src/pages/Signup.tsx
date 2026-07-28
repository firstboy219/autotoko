import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useAccount } from "../lib/account";
import { useBranding } from "../lib/branding";
import { WaLogin, EmailLogin } from "../components/AuthForms";

type Tab = "email" | "wa";

const BENEFITS = [
  "Autopilot balas chat & upload produk",
  "Kelola pesanan multi-marketplace di satu dashboard",
  "Tanpa kartu kredit, tanpa password",
];

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
    <div className="min-h-screen flex items-center justify-center font-sans bg-gradient-to-br from-[#F0F4F8] via-[#EEF2FF] to-[#F0F4F8] p-4">
      <div className="w-full max-w-[400px]">
        <div className="bg-white rounded-2xl border border-slate-200/80 p-8 shadow-xl shadow-slate-200/50">
          <div className="flex items-center gap-2.5 mb-1">
            {brand?.logoUrl ? (
              <img src={brand.logoUrl} alt={brandName} className="w-10 h-10 rounded-xl object-contain shadow-sm" />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand to-brand-dark text-white font-extrabold flex items-center justify-center shadow-sm">
                {brandName.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <div className="font-extrabold text-lg leading-none text-slate-800">Daftar {brandName}</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400 mt-1">Gratis · tanpa password</div>
            </div>
          </div>
          <p className="text-[13px] text-slate-500 mb-3 mt-3 leading-relaxed">
            Buat akun pakai email atau WhatsApp. Verifikasi sekali, langsung lanjut isi profil toko.
          </p>

          <ul className="mb-5 space-y-1">
            {BENEFITS.map((b) => (
              <li key={b} className="flex items-start gap-1.5 text-[12px] text-slate-500">
                <span className="text-emerald-500 mt-0.5">✓</span> {b}
              </li>
            ))}
          </ul>

          <div className="relative flex mb-5 rounded-lg bg-slate-100 p-1 text-sm font-semibold">
            <div
              className="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white rounded-md shadow-sm transition-transform duration-200 ease-out"
              style={{ transform: tab === "email" ? "translateX(0)" : "translateX(calc(100% + 8px))" }}
            />
            <button
              onClick={() => setTab("email")}
              className={`relative z-10 flex-1 py-1.5 rounded-md transition-colors flex items-center justify-center gap-1.5 ${tab === "email" ? "text-brand" : "text-slate-500"}`}
            >
              <span>✉</span> Email
            </button>
            <button
              onClick={() => setTab("wa")}
              className={`relative z-10 flex-1 py-1.5 rounded-md transition-colors flex items-center justify-center gap-1.5 ${tab === "wa" ? "text-brand" : "text-slate-500"}`}
            >
              <span>💬</span> WhatsApp
            </button>
          </div>

          {tab === "email" ? (
            <EmailLogin verifyLabel="Daftar" onDone={(t) => done(t)} />
          ) : (
            <WaLogin ctaLabel="Daftar via WhatsApp" onDone={(t) => done(t)} />
          )}

          <p className="text-[12px] text-slate-500 text-center mt-5">
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
    </div>
  );
}
