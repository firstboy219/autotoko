import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useBranding } from "../lib/branding";
import { WaLogin, EmailLogin } from "../components/AuthForms";

type Tab = "wa" | "email";

export function Login() {
  const navigate = useNavigate();
  const applyToken = useAuth((s) => s.applyToken);
  const brand = useBranding((s) => s.branding);
  const brandName = brand?.name ?? "AutoToko";
  const [tab, setTab] = useState<Tab>("wa");

  return (
    <div className="min-h-screen flex items-center justify-center font-sans bg-[#F0F4F8]">
      <div className="bg-white rounded-xl border border-slate-200 p-8 w-[380px] shadow-sm">
        <div className="flex items-center gap-2 mb-6">
          {brand?.logoUrl ? (
            <img src={brand.logoUrl} alt={brandName} className="w-9 h-9 rounded-lg object-contain" />
          ) : (
            <div className="w-9 h-9 rounded-lg bg-brand font-extrabold flex items-center justify-center">
              {brandName.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <div className="font-extrabold text-lg leading-none">{brandName}</div>
            <div className="text-[10px] uppercase tracking-wide text-slate-400">
              Autopilot Seller
            </div>
          </div>
        </div>

        <div className="flex mb-5 rounded-lg bg-slate-100 p-1 text-sm font-semibold">
          <button
            onClick={() => setTab("wa")}
            className={`flex-1 py-1.5 rounded-md ${tab === "wa" ? "bg-white shadow-sm text-brand" : "text-slate-500"}`}
          >
            WhatsApp
          </button>
          <button
            onClick={() => setTab("email")}
            className={`flex-1 py-1.5 rounded-md ${tab === "email" ? "bg-white shadow-sm text-brand" : "text-slate-500"}`}
          >
            Email
          </button>
        </div>

        {tab === "wa" ? (
          <WaLogin onDone={(t) => { applyToken(t); navigate("/"); }} />
        ) : (
          <EmailLogin onDone={(t) => { applyToken(t); navigate("/"); }} />
        )}

        <p className="text-[12px] text-slate-500 text-center mt-4">
          Belum punya akun?{" "}
          <Link to="/signup" className="text-brand font-semibold hover:underline">Daftar di sini</Link>
        </p>

        <DevLogin />
      </div>
    </div>
  );
}

/** Username/password login — only works in non-production (backend rejects in prod). */
function DevLogin() {
  const { login, demoLogin, loading, error } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("user");
  const [password, setPassword] = useState("user");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (await login(username, password)) navigate("/");
  }

  async function demo() {
    if (await demoLogin()) navigate("/");
  }

  return (
    <div className="mt-5 pt-4 border-t border-slate-100">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-[11px] text-slate-400 hover:text-slate-600"
      >
        {open ? "▾" : "▸"} Login developer
      </button>
      {open && (
        <div className="mt-2">
          <button
            onClick={demo}
            disabled={loading}
            className="w-full py-2 mb-3 rounded-md bg-brand hover:bg-brand-dark text-white text-sm font-semibold disabled:opacity-60"
          >
            {loading ? "Masuk…" : "Masuk sebagai Demo (reviewer)"}
          </button>
        </div>
      )}
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
