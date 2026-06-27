import { useCallback, useEffect, useState } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useAccount } from "../lib/account";
import { useBranding } from "../lib/branding";
import { useRealtime, useConnectionStatus } from "../lib/realtime";

const NAV = [
  { to: "/", label: "Dashboard", icon: "📊", end: true },
  { to: "/toko", label: "Toko Saya", icon: "🏪" },
  { to: "/produk", label: "Master Produk", icon: "📦" },
  { to: "/katalog", label: "Kesehatan Katalog", icon: "🩺" },
  { to: "/orders", label: "Orders", icon: "🛒" },
  { to: "/autopilot", label: "Autopilot", icon: "🤖" },
  { to: "/affiliate", label: "Affiliate", icon: "🤝" },
  { to: "/laporan", label: "Laporan", icon: "📈" },
  { to: "/bom", label: "BOM / Bahan", icon: "🧪" },
  { to: "/wallet", label: "Wallet", icon: "💳" },
  { to: "/notifikasi", label: "Notifikasi", icon: "🔔" },
];

export function Layout({ children, title }: { children: React.ReactNode; title: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useAuth((s) => s.logout);
  const { me, load } = useAccount();
  const brand = useBranding((s) => s.branding);
  const brandName = brand?.name ?? "AutoToko";
  const connected = useConnectionStatus();
  const [toast, setToast] = useState<string | null>(null);

  // Load profile once; route brand-new (un-onboarded) users to onboarding.
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (me && !me.onboarded && location.pathname !== "/onboarding") {
      navigate("/onboarding", { replace: true });
    }
  }, [me, location.pathname, navigate]);

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
          {brand?.logoUrl ? (
            <img src={brand.logoUrl} alt={brandName} className="w-8 h-8 rounded-lg object-contain" />
          ) : (
            <div className="w-8 h-8 rounded-lg bg-brand font-extrabold flex items-center justify-center">
              {brandName.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <div className="text-white font-extrabold leading-none">{brandName}</div>
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
        <NavLink
          to="/akun"
          className={({ isActive }) =>
            `flex items-center gap-2.5 mx-2 mb-1 px-3 py-2 rounded-md text-[12.5px] font-medium transition ${
              isActive ? "bg-brand text-white" : "text-white/50 hover:bg-white/5 hover:text-white/90"
            }`
          }
        >
          <span className="w-4 text-center">👤</span>
          <span className="truncate">{me?.fullName ?? "Akun Saya"}</span>
        </NavLink>
        <button
          onClick={() => {
            logout();
            navigate("/login");
          }}
          className="m-3 mt-0 px-3 py-2 rounded-md text-[12px] text-white/60 hover:bg-white/5 text-left"
        >
          ⎋ Keluar
        </button>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-12 bg-white border-b border-slate-200 flex items-center justify-between px-4">
          <div className="font-bold">{title}</div>
          <div
            title={connected ? "Terhubung realtime — notifikasi order baru muncul otomatis." : "Koneksi realtime terputus. Coba refresh halaman."}
            className={`flex items-center gap-1.5 text-[11px] font-semibold cursor-help ${connected ? "text-green-600" : "text-red-500"}`}
          >
            <span className={`inline-block w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-400"}`} />
            {connected ? "Live" : "Offline"}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 bg-[#F0F4F8]">{children}</main>
      </div>
    </div>
  );
}
