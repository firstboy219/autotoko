import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useBranding } from "../lib/branding";
import { WaLogin, EmailLogin } from "../components/AuthForms";

type Tab = "wa" | "email";

export function Login() {
  const navigate = useNavigate();
  const applyToken = useAuth((s) => s.applyToken);
  const demoLogin = useAuth((s) => s.demoLogin);
  const demoLoading = useAuth((s) => s.loading);
  const brand = useBranding((s) => s.branding);
  const brandName = brand?.name ?? "AutoToko";
  const [tab, setTab] = useState<Tab>("wa");

  async function reviewerDemo() {
    if (await demoLogin()) navigate("/");
  }

  return (
    <div className="min-h-screen flex items-center justify-center font-sans bg-gradient-to-br from-[#F0F4F8] via-[#EEF2FF] to-[#F0F4F8] p-4">
      <div className="w-full max-w-[400px]">
        <div className="bg-white rounded-2xl border border-slate-200/80 p-8 shadow-xl shadow-slate-200/50">
          <div className="flex items-center gap-2.5 mb-7">
            {brand?.logoUrl ? (
              <img src={brand.logoUrl} alt={brandName} className="w-10 h-10 rounded-xl object-contain shadow-sm" />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand to-brand-dark text-white font-extrabold flex items-center justify-center shadow-sm">
                {brandName.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <div className="font-extrabold text-lg leading-none text-slate-800">{brandName}</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400 mt-1">
                Autopilot Seller
              </div>
            </div>
          </div>

          <h1 className="text-xl font-bold text-slate-800 mb-1">Selamat datang kembali</h1>
          <p className="text-[13px] text-slate-500 mb-5">Masuk ke dashboard AutoToko kamu.</p>

          <div className="relative flex mb-5 rounded-lg bg-slate-100 p-1 text-sm font-semibold">
            <div
              className="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white rounded-md shadow-sm transition-transform duration-200 ease-out"
              style={{ transform: tab === "wa" ? "translateX(0)" : "translateX(calc(100% + 8px))" }}
            />
            <button
              onClick={() => setTab("wa")}
              className={`relative z-10 flex-1 py-1.5 rounded-md transition-colors flex items-center justify-center gap-1.5 ${tab === "wa" ? "text-brand" : "text-slate-500"}`}
            >
              <span>💬</span> WhatsApp
            </button>
            <button
              onClick={() => setTab("email")}
              className={`relative z-10 flex-1 py-1.5 rounded-md transition-colors flex items-center justify-center gap-1.5 ${tab === "email" ? "text-brand" : "text-slate-500"}`}
            >
              <span>✉</span> Email
            </button>
          </div>

          {tab === "wa" ? (
            <WaLogin onDone={(t) => { applyToken(t); navigate("/"); }} />
          ) : (
            <EmailLogin onDone={(t) => { applyToken(t); navigate("/"); }} />
          )}

          <p className="text-[12px] text-slate-500 text-center mt-5">
            Belum punya akun?{" "}
            <Link to="/signup" className="text-brand font-semibold hover:underline">Daftar di sini</Link>
          </p>

          <div className="mt-5 pt-4 border-t border-slate-100 text-center">
            <p className="text-[11px] text-slate-400 mb-2">Untuk TikTok App Reviewer:</p>
            <button
              onClick={reviewerDemo}
              disabled={demoLoading}
              className="w-full py-2 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold disabled:opacity-60 transition"
            >
              {demoLoading ? "Masuk…" : "🔍 Masuk sebagai Demo Reviewer"}
            </button>
          </div>

          <div className="text-center mt-4 text-[10px] text-slate-400">
            <Link to="/terms" className="hover:underline">Ketentuan</Link> ·{" "}
            <Link to="/privacy" className="hover:underline">Privasi</Link>
          </div>

          <DevLogin />
        </div>
      </div>
    </div>
  );
}

/** Username/password login — only works in non-production (backend rejects in prod). */
function DevLogin() {
  const { login, loading, error } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("user");
  const [password, setPassword] = useState("user");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (await login(username, password)) navigate("/");
  }

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-[11px] text-slate-400 hover:text-slate-600"
      >
        {open ? "▾" : "▸"} Login developer
      </button>
      {open && (
        <form onSubmit={submit} className="mt-2">
          <input
            className="w-full mb-2 px-3 py-1.5 rounded-md border border-slate-200 text-sm"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="username"
          />
          <input
            type="password"
            className="w-full mb-2 px-3 py-1.5 rounded-md border border-slate-200 text-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="password"
          />
          {error && <div className="text-red-500 text-xs mb-2">{error}</div>}
          <button
            disabled={loading}
            className="w-full py-1.5 rounded-md bg-slate-700 hover:bg-slate-800 text-white text-xs font-semibold disabled:opacity-60"
          >
            {loading ? "Masuk…" : "Masuk (dev)"}
          </button>
        </form>
      )}
    </div>
  );
}
