import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useAccount } from "../lib/account";
import { useBranding } from "../lib/branding";
import { useRealtime, useConnectionStatus } from "../lib/realtime";
import { api } from "../lib/api";
import { Icon, type IconName } from "./Icon";
import { ToastHost } from "./ui";
import { useMeAccess } from "../lib/me";
import { NavSettingsModal, type NavItem, type NavPrefs } from "./NavSettings";

export const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: "dashboard", end: true },
  { to: "/toko", label: "Toko Saya", icon: "store" },
  { to: "/produk", label: "Master Produk", icon: "package" },
  { to: "/katalog", label: "Kesehatan Katalog", icon: "activity" },
  { to: "/orders", label: "Orders", icon: "cart" },
  { to: "/produksi-packing", label: "Produksi & Packing", icon: "package" },
  { to: "/autopilot", label: "Autopilot", icon: "bot" },
  { to: "/affiliate", label: "Affiliate", icon: "users" },
  { to: "/laporan", label: "Laporan", icon: "trending" },
  { to: "/bom", label: "BOM / Bahan", icon: "beaker" },
  { to: "/pembelian", label: "Pembelian Stok", icon: "package" },
  { to: "/hpp", label: "HPP & Harga Jual", icon: "tag" },
  { to: "/wallet", label: "Wallet", icon: "wallet" },
  { to: "/pencairan", label: "Pencairan Dana", icon: "banknote" },
  { to: "/laporan-bagian", label: "Laporan Bagian", icon: "trending" },
  { to: "/notifikasi", label: "Notifikasi", icon: "bell" },
  { to: "/pending", label: "Data Belum Lengkap", icon: "warning" },
  { to: "/aplikasi", label: "Versi Aplikasi", icon: "download" },
  { to: "/rekonsiliasi", label: "Rekonsiliasi", icon: "activity" },
  { to: "/karyawan", label: "Akun Karyawan", icon: "users" },
];

/**
 * Izin yang dibutuhkan tiap menu.
 *
 * Yang tidak terdaftar selalu tampil. Ini SEMATA kerapian tampilan --
 * penjagaan sebenarnya ada di server, dan menyembunyikan menu bukan
 * pengganti izin. Gunanya: menu yang selalu menolak saat diketuk terbaca
 * sebagai aplikasi rusak, bukan sebagai akses yang memang tidak diberikan.
 */
const NAV_PERM: Record<string, string> = {
  "/": "dashboard",
  "/toko": "toko",
  "/produk": "produk",
  "/katalog": "produk",
  "/orders": "order",
  "/produksi-packing": "scan",
  "/autopilot": "produk",
  "/affiliate": "toko",
  "/laporan": "dashboard",
  "/bom": "bahan",
  "/pembelian": "bahan",
  "/hpp": "produk",
  "/wallet": "wallet",
  "/pencairan": "pencairan",
  "/laporan-bagian": "pencairan",
  "/rekonsiliasi": "pencairan",
  "/pending": "dashboard",
  "/aplikasi": "scan",
  "/karyawan": "__owner__",
};

const EMPTY_PREFS: NavPrefs = { groups: [], counts: {}, collapsed: [] };

/** Id of the automatic group. Reserved: a user group may not use it. */
export const FREQUENT_ID = "__sering__";

/**
 * Visits before a menu item is called frequently used.
 *
 * Not one. With a threshold of one the automatic group fills up with whatever
 * was opened while looking around on the first day and then sits there being
 * wrong, which is worse than not existing — a shortcut list nobody trusts is
 * just more to read.
 */
const FREQUENT_MIN = 3;
const FREQUENT_MAX = 5;

/** How long to wait after the last change before writing prefs back. */
const SAVE_DEBOUNCE_MS = 4000;

/** Gmail-style nav pill: full-round, tonal when active, no heavy weight. */
function navClass({ isActive }: { isActive: boolean }) {
  return `flex items-center gap-3 mx-2 my-0.5 pl-4 pr-3 py-2 rounded-full text-sm transition ${
    isActive
      ? "bg-brand/20 text-ink font-medium"
      : "text-ink-2 hover:bg-canvas hover:text-ink"
  }`;
}

/** Which nav entry a URL belongs to, so a sub-page still counts as a visit. */
function matchNav(pathname: string): string | null {
  let best: string | null = null;
  for (const n of NAV) {
    if (n.end ? pathname === n.to : pathname === n.to || pathname.startsWith(n.to + "/")) {
      if (!best || n.to.length > best.length) best = n.to;
    }
  }
  return best;
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
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [prefs, setPrefs] = useState<NavPrefs>(EMPTY_PREFS);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  // Load profile once; route brand-new (un-onboarded) users to onboarding.
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (me && !me.onboarded && location.pathname !== "/onboarding") {
      navigate("/onboarding", { replace: true });
    }
  }, [me, location.pathname, navigate]);

  // A sidebar that cannot be personalised is still a working sidebar, so a
  // failure here is swallowed rather than shown: the menu falls back to one
  // flat list and nothing else on the page is affected.
  useEffect(() => {
    let alive = true;
    api
      .get<NavPrefs>("/account/nav")
      .then((p) => alive && setPrefs({ ...EMPTY_PREFS, ...p }))
      .catch(() => {})
      .finally(() => alive && setPrefsLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  // Count the visit, which is the whole input to the automatic group.
  useEffect(() => {
    if (!prefsLoaded) return;
    const path = matchNav(location.pathname);
    if (!path) return;
    setPrefs((p) => ({ ...p, counts: { ...p.counts, [path]: (p.counts[path] ?? 0) + 1 } }));
  }, [location.pathname, prefsLoaded]);

  // Written back debounced: a click on every menu item would otherwise be a
  // request on every menu item, and nothing here needs to be durable that fast.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!prefsLoaded) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api.put("/account/nav", prefs).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [prefs, prefsLoaded]);

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

  // Menu yang boleh dilihat akun ini. Selagi /me belum termuat, can()
  // menjawab true, jadi menunya tampil utuh dulu lalu menyusut -- lebih baik
  // daripada menu yang berkedip kosong pada tiap muat halaman.
  const { access, load: muatAkses, can } = useMeAccess();
  useEffect(() => {
    muatAkses();
  }, [muatAkses]);

  const NAV_TAMPIL = useMemo(() => {
    return NAV.filter((n) => {
      const perlu = NAV_PERM[n.to];
      if (perlu === undefined) return true;
      if (perlu === "__owner__") return access ? access.isOwner : true;
      return can(perlu);
    });
  }, [access, can]);

  const byPath = useMemo(() => new Map(NAV_TAMPIL.map((n) => [n.to, n])), [NAV_TAMPIL]);

  /**
   * The rendered sections: the automatic group, then the seller's own, then
   * everything they have not filed anywhere.
   *
   * Frequently-used entries stay in their group as well as appearing at the
   * top. Moving them would rearrange the menu as it is used, and a menu whose
   * items change place is harder to use than one with a short duplicate list.
   */
  const sections = useMemo(() => {
    const frequent = NAV_TAMPIL.filter((n) => (prefs.counts[n.to] ?? 0) >= FREQUENT_MIN)
      .sort((a, b) => (prefs.counts[b.to] ?? 0) - (prefs.counts[a.to] ?? 0))
      .slice(0, FREQUENT_MAX);

    const grouped = prefs.groups
      .filter((g) => g.id !== FREQUENT_ID)
      .map((g) => ({
        id: g.id,
        label: g.label,
        items: g.items.map((p) => byPath.get(p)).filter((n): n is NavItem => Boolean(n)),
      }))
      .filter((g) => g.items.length > 0);

    const filed = new Set(grouped.flatMap((g) => g.items.map((i) => i.to)));
    const rest = NAV_TAMPIL.filter((n) => !filed.has(n.to));

    const out: { id: string; label: string | null; items: NavItem[]; auto?: boolean }[] = [];
    if (frequent.length >= 2) {
      out.push({ id: FREQUENT_ID, label: "Sering Digunakan", items: frequent, auto: true });
    }
    out.push(...grouped);
    if (rest.length) {
      // Unlabelled when nothing has been grouped yet, so a seller who never
      // touches this feature sees exactly the flat menu they had before.
      out.push({ id: "__lainnya__", label: grouped.length ? "Lainnya" : null, items: rest });
    }
    return out;
  }, [prefs.groups, prefs.counts, byPath]);

  function toggleCollapsed(id: string) {
    setPrefs((p) => ({
      ...p,
      collapsed: p.collapsed.includes(id)
        ? p.collapsed.filter((c) => c !== id)
        : [...p.collapsed, id],
    }));
  }

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
        {sections.map((s) => {
          const collapsed = prefs.collapsed.includes(s.id);
          return (
            <div key={s.id} className="mb-1">
              {s.label && (
                <button
                  onClick={() => toggleCollapsed(s.id)}
                  className="w-full flex items-center gap-1.5 px-5 pt-3 pb-1 text-[11px] uppercase tracking-wide text-ink-3 hover:text-ink-2 transition"
                >
                  <Icon
                    name="chevronDown"
                    size={12}
                    className={`transition-transform ${collapsed ? "-rotate-90" : ""}`}
                  />
                  <span className="truncate">{s.label}</span>
                  {s.auto && <span className="ml-auto normal-case text-[10px]">otomatis</span>}
                </button>
              )}
              {!collapsed &&
                s.items.map((n) => (
                  <NavLink
                    key={`${s.id}:${n.to}`}
                    to={n.to}
                    end={n.end}
                    className={navClass}
                  >
                    <Icon name={n.icon} size={18} />
                    <span className="truncate">{n.label}</span>
                  </NavLink>
                ))}
            </div>
          );
        })}

        <button
          onClick={() => setSettingsOpen(true)}
          className="w-[calc(100%-1rem)] flex items-center gap-3 mx-2 mt-2 pl-4 pr-3 py-2 rounded-full text-sm text-ink-3 hover:bg-canvas hover:text-ink transition"
        >
          <Icon name="settings" size={18} />
          Atur Menu
        </button>
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

      {settingsOpen && (
        <NavSettingsModal
          nav={NAV_TAMPIL}
          prefs={prefs}
          onClose={() => setSettingsOpen(false)}
          onChange={(next) => setPrefs(next)}
        />
      )}
    </ToastHost>
  );
}
