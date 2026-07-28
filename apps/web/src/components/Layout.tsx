import { useCallback, useEffect, useState } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useAccount } from "../lib/account";
import { useBranding } from "../lib/branding";
import { useRealtime, useConnectionStatus } from "../lib/realtime";
import { Icon, type IconName } from "./Icon";
import { ToastHost } from "./ui";

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: "/", label: "Dashboard", icon: "dashboard", end: true },
  { to: "/toko", label: "Toko Saya", icon: "store" },
  { to: "/produk", label: "Master Produk", icon: "package" },
  { to: "/katalog", label: "Kesehatan Katalog", icon: "activity" },
  { to: "/orders", label: "Orders", icon: "cart" },
  { to: "/autopilot", label: "Autopilot", icon: "bot" },
  { to: "/affiliate", label: "Affiliate", icon: "users" },
  { to: "/laporan", label: "Laporan", icon: "trending" },
  { to: "/bom", label: "BOM / Bahan", icon: "beaker" },
  { to: "/wallet", label: "Wallet", icon: "wallet" },
  { to: "/pencairan", label: "Pencairan Dana", icon: "banknote" },
  { to: "/notifikasi", label: "Notifikasi", icon: "bell" },
];

/** Gmail-style nav pill: full-round, tonal when active, no heavy weight. */
function navClass({ isActive }: { isActive: boolean }) {
  return `flex items-center gap-3 mx-2 my-0.5 pl-4 pr-3 py-2 rounded-full text-sm transition ${
    isActive
      ? "bg-brand/20 text-ink font-medium"
      : "text-ink-2 hover:bg-canvas hover:text-ink"
  }`;
}

export function Layout({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useAuth((s) => s.logout);
  const { me, load } = useAccount();
  const brand = useBranding((s) => s.branding);
  const brandName = brand?.name ?? "AutoToko";
  const connected = useConnectionStatus();
  const [toast, setToast] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  // Load profile once; route brand-new (un-onboarded) users to onboarding.
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (me && !me.onboarded && location.pathname !== "/onboarding") {
      navigate("/onboarding", { replace: true });
    }
  }, [me, location.pathname, navigate]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useRealtime(
    useCallback((type) => {
      if (type === "new_order") setToast("Pesanan baru masuk");
    }, []),
  );
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const sidebar = (
    <>
      <div className="flex items-center gap-2.5 px-4 h-16 shrink-0">
        {brand?.logoUrl ? (
          <img src={brand.logoUrl} alt={brandName} className="w-8 h-8 rounded-lg object-contain" />
        ) : (
          <div className="w-8 h-8 rounded-lg bg-brand text-onbrand font-medium flex items-center justify-center">
            {brandName.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="text-ink font-medium leading-tight truncate">{brandName}</div>
          <div className="text-xs text-ink-3 leading-tight">Autopilot Seller</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto pb-2">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={navClass}>
            <Icon name={n.icon} size={18} />
            <span className="truncate">{n.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="shrink-0 border-t border-line py-2">
        <NavLink to="/akun" className={navClass}>
          <Icon name="user" size={18} />
          <span className="truncate">{me?.fullName ?? "Akun Saya"}</span>
        </NavLink>
        <button
          onClick={() => {
            logout();
            navigate("/login");
          }}
          className="w-[calc(100%-1rem)] flex items-center gap-3 mx-2 pl-4 pr-3 py-2 rounded-full text-sm text-ink-2 hover:bg-canvas hover:text-ink transition"
        >
          <Icon name="logout" size={18} />
          Keluar
        </button>
      </div>
    </>
  );

  return (
    <ToastHost>
      <div className="flex h-screen overflow-hidden font-sans text-ink bg-canvas">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex w-64 bg-white border-r border-line flex-col shrink-0">
          {sidebar}
        </aside>

        {/* Mobile drawer */}
        {navOpen && (
          <div className="lg:hidden fixed inset-0 z-40 flex">
            <div className="absolute inset-0 bg-slate-900/30" onClick={() => setNavOpen(false)} />
            <aside className="relative w-64 bg-white border-r border-line flex flex-col shadow-e2">
              {sidebar}
            </aside>
          </div>
        )}

        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <header className="h-16 bg-white border-b border-line flex items-center gap-3 px-4 sm:px-6 shrink-0">
            <button
              onClick={() => setNavOpen(true)}
              aria-label="Buka menu"
              className="lg:hidden p-2 -ml-2 rounded-full text-ink-2 hover:bg-canvas"
            >
              <Icon name="menu" size={20} />
            </button>
            <div className="text-lg text-ink truncate">{title}</div>
            <div className="ml-auto flex items-center gap-3">
              <span
                title={
                  connected
                    ? "Terhubung realtime — notifikasi order baru muncul otomatis."
                    : "Koneksi realtime terputus. Coba refresh halaman."
                }
                className={`hidden sm:inline-flex items-center gap-1.5 text-xs font-medium ${
                  connected ? "text-emerald-600" : "text-ink-3"
                }`}
              >
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full ${
                    connected ? "bg-emerald-500" : "bg-slate-300"
                  }`}
                />
                {connected ? "Live" : "Offline"}
              </span>
            </div>
          </header>

          {toast && (
            <button
              onClick={() => navigate("/orders")}
              className="mx-4 sm:mx-6 mt-4 flex items-center gap-2 rounded-lg border border-brand/40 bg-brand/10 px-4 py-2.5 text-sm text-ink text-left hover:bg-brand/20 transition"
            >
              <Icon name="cart" size={16} />
              {toast}
              <span className="ml-auto text-brand-ink font-medium">Lihat</span>
            </button>
          )}

          <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">{children}</main>
        </div>
      </div>
    </ToastHost>
  );
}
