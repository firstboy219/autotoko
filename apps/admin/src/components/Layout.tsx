import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useBranding } from "../lib/branding";

const NAV = [
  { to: "/settings", label: "Kredensial & Config", icon: "🔑" },
  { to: "/pricing", label: "Pricing", icon: "💰" },
  { to: "/ai", label: "AI Autopilot", icon: "🤖" },
  { to: "/branding", label: "Branding", icon: "🎨" },
];

export function Layout({ children, title }: { children: React.ReactNode; title: string }) {
  const navigate = useNavigate();
  const logout = useAuth((s) => s.logout);
  const brand = useBranding((s) => s.branding);
  const brandName = brand?.name ?? "AutoToko";

  return (
    <div className="flex h-screen overflow-hidden font-sans text-slate-100">
      <aside className="w-60 bg-navy flex flex-col flex-shrink-0">
        <div className="flex items-center gap-2 px-4 py-3.5 border-b border-white/10">
          {brand?.logoUrl ? (
            <img src={brand.logoUrl} alt={brandName} className="w-8 h-8 rounded-lg object-contain" />
          ) : (
            <div className="w-8 h-8 rounded-lg bg-brand font-extrabold flex items-center justify-center">{brandName.charAt(0).toUpperCase()}</div>
          )}
          <div>
            <div className="text-white font-extrabold leading-none">{brandName}</div>
            <div className="text-[9px] uppercase tracking-wider text-brand">Admin CMS</div>
          </div>
        </div>
        <nav className="flex-1 py-2">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 mx-2 my-0.5 px-3 py-2 rounded-md text-[12.5px] font-medium transition ${
                  isActive ? "bg-brand text-white" : "text-white/50 hover:bg-white/5 hover:text-white/90"
                }`
              }
            >
              <span className="w-4 text-center">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={() => { logout(); navigate("/login"); }}
          className="m-3 px-3 py-2 rounded-md text-[12px] text-white/60 hover:bg-white/5 text-left"
        >
          ⎋ Keluar
        </button>
      </aside>
      <div className="flex-1 flex flex-col overflow-hidden bg-[#0f172a]">
        <header className="h-12 bg-[#1e293b] border-b border-white/10 flex items-center px-4">
          <div className="font-bold text-white">{title}</div>
        </header>
        <main className="flex-1 overflow-y-auto p-5">{children}</main>
      </div>
    </div>
  );
}
