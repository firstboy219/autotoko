import { useEffect, useState } from "react";
import type { ApiResponse } from "@autotoko/shared";

type Health = { status: string; uptime: number; ts: string };

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json() as Promise<ApiResponse<Health>>)
      .then((res) => {
        if (res.success && res.data) setHealth(res.data);
        else setError(res.error?.message ?? "Unknown error");
      })
      .catch((e: unknown) => setError(String(e)));
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center font-sans">
      <div className="bg-white rounded-xl border border-slate-200 p-8 w-[420px] shadow-sm">
        <div className="flex items-center gap-2 mb-4">
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
        <p className="text-sm text-slate-500 mb-4">
          Web dashboard (Vite + React SPA) — scaffold siap.
        </p>
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm">
          <div className="font-semibold mb-1">Backend health</div>
          {health ? (
            <span className="text-teal">● {health.status} (uptime {Math.round(health.uptime)}s)</span>
          ) : error ? (
            <span className="text-red-500">● {error}</span>
          ) : (
            <span className="text-slate-400">menghubungi /api/health…</span>
          )}
        </div>
      </div>
    </div>
  );
}
