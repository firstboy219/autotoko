import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export function Login() {
  const navigate = useNavigate();
  const { login, loading, error } = useAuth();
  const [username, setUsername] = useState("user");
  const [password, setPassword] = useState("user");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (await login(username, password)) navigate("/settings");
  }

  return (
    <div className="min-h-screen flex items-center justify-center font-sans bg-[#0f172a]">
      <form onSubmit={submit} className="bg-[#1e293b] rounded-xl border border-white/10 p-8 w-[360px]">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-9 h-9 rounded-lg bg-brand text-white font-extrabold flex items-center justify-center">A</div>
          <div>
            <div className="font-extrabold text-lg text-white leading-none">AutoToko</div>
            <div className="text-[10px] uppercase tracking-wide text-brand">Admin CMS</div>
          </div>
        </div>
        <label className="block text-xs font-semibold text-slate-400 mb-1">Username</label>
        <input className="w-full mb-3 px-3 py-2 rounded-md bg-[#0f172a] border border-white/10 text-sm text-slate-100" value={username} onChange={(e) => setUsername(e.target.value)} />
        <label className="block text-xs font-semibold text-slate-400 mb-1">Password</label>
        <input type="password" className="w-full mb-4 px-3 py-2 rounded-md bg-[#0f172a] border border-white/10 text-sm text-slate-100" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="text-red-400 text-xs mb-3">{error}</div>}
        <button disabled={loading} className="w-full py-2 rounded-md bg-brand hover:bg-brand-dark text-white text-sm font-semibold disabled:opacity-60">
          {loading ? "Masuk…" : "Masuk sebagai Admin"}
        </button>
      </form>
    </div>
  );
}
