import { useCallback, useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useRealtime } from "../lib/realtime";

const NAV = [
  { to: "/", label: "Dashboard", icon: "📊", end: true },
  { to: "/toko", label: "Toko Saya", icon: "🏪" },
  { to: "/produk", label: "Master Produk", icon: "📦" },
  { to: "/katalog", label: "Kesehatan Katalog", icon: "🩺" },
  { to: "/orders", label: "Orders", icon: "🛒" },
  { to: "/autopilot", label: "Autopilot", icon: "🤖" },
  { to: "/laporan", label: "Laporan", icon: "📈" },
  { to: "/bom", label: "BOM / Bahan", icon: "🧪" },
  { to: "/wallet", label: "Wallet", icon: "💳" },
];

export function Layout({ children, title }: { children: React.ReactNode; title: string }) {
  const navigate = useNavigate();
  const logout = useAuth((s) => s.logout);
  const [toast, setToast] = useState<string | null>(null);

  useRealtime(
    useCallback((type) => {
      if (type === "new_order") setToast("🛒 Pesanan baru masuk!");
    }, []),
  );
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className="flex h-screen overflow-hidden font-sans text-slate-800">
      {toast && (
        <div
          onClick={() => navigate("/orders")}
          className="fixed top-4 right-4 z-50 cursor-pointer rounded-lg bg-brand text-white text-sm font-semibold px-4 py-3 shadow-lg animate-pulse"
        >
          {toast} <span className="underline ml-1">Lihat →</span>
        </div>
      )}
      {/* Sidebar */}
      <aside className="w-56 bg-navy flex flex-col flex-shrink-0">
        <div className="flex items-center gap-2 px-4 py-3.5 border-b border-white/10">
          <div className="w-8 h-8 rounded-lg bg-brand text-white font-extrabold flex items-center justify-center">
            A
          </div>
          <div>
            <div className="text-white font-extrabold leading-none">AutoToko</div>
            <div className="text-[9px] uppercase tracking-wider text-white/30">
              Autopilot Seller
            </div>
          </div>
        </div>
        <nav className="flex-1 py-2">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 mx-2 my-0.5 px-3 py-2 rounded-md text-[12.5px] font-medium transition ${
                  isActive
                    ? "bg-brand text-white"
                    : "text-white/50 hover:bg-white/5 hover:text-white/90"
                }`
              }
            >
              <span className="w-4 text-center">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={() => {
            logout();
            navigate("/login");
          }}
          className="m-3 px-3 py-2 rounded-md text-[12px] text-white/60 hover:bg-white/5 text-left"
        >
          ⎋ Keluar
        </button>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-12 bg-white border-b border-slate-200 flex items-center px-4">
          <div className="font-bold">{title}</div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 bg-[#F0F4F8]">{children}</main>
      </div>
    </div>
  );
}
