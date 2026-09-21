import { NavLink } from "react-router-dom";

/**
 * Strip tab antar-halaman satu "seksi" (mis. Orders ⇄ Retur). Tiap tab adalah
 * route tersendiri (alur & data tak berubah) — hanya disatukan secara tampilan
 * sehingga sub-halaman keluar dari sidebar tapi tetap satu napas.
 */
export function SectionTabs({ tabs }: { tabs: { to: string; label: string; end?: boolean }[] }) {
  return (
    <div className="flex gap-1 mb-4 border-b border-line overflow-x-auto -mt-1">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            `px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition ${
              isActive ? "border-brand text-brand-ink" : "border-transparent text-ink-2 hover:text-ink"
            }`
          }
        >
          {t.label}
        </NavLink>
      ))}
    </div>
  );
}
