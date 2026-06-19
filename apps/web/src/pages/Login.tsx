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
    if (await login(username, password)) navigate("/");
  }

  return (
    <div className="min-h-screen flex items-center justify-center font-sans bg-[#F0F4F8]">
      <form
        onSubmit={submit}
        className="bg-white rounded-xl border border-slate-200 p-8 w-[360px] shadow-sm"
      >
        <div className="flex items-center gap-2 mb-6">
          <div className="w-9 h-9 rounded-lg bg-brand text-white font-extrabold flex items-center justify-center">
            A
          </div>
          <div>
            <div className="font-extrabold text-lg leading-none">AutoToko</div>
            <div className="text-[10px] uppercase tracking-wide text-slate-400">
              Autopilot Seller
            </div>
          </div>
        </div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">Username</label>
        <input
          className="w-full mb-3 px-3 py-2 rounded-md border border-slate-200 text-sm focus:outline-none focus:border-brand"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <label className="block text-xs font-semibold text-slate-500 mb-1">Password</label>
        <input
          type="password"
          className="w-full mb-4 px-3 py-2 rounded-md border border-slate-200 text-sm focus:outline-none focus:border-brand"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="text-red-500 text-xs mb-3">{error}</div>}
        <button
          disabled={loading}
          className="w-full py-2 rounded-md bg-brand hover:bg-brand-dark text-white text-sm font-semibold disabled:opacity-60"
        >
          {loading ? "Masuk…" : "Masuk"}
        </button>
        <p className="text-[11px] text-slate-400 mt-3 text-center">
          Dev login: <b>user / user</b>
        </p>
      </form>
    </div>
  );
}
