import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";

/** Dropdown "Lainnya" untuk merapikan tombol aksi yang jarang dipakai. */
export function MoreMenu({
  items,
  label = "Lainnya",
}: {
  items: { label: string; icon?: IconName; onClick: () => void }[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const f = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", f);
    return () => document.removeEventListener("mousedown", f);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border border-line bg-white text-sm font-medium text-ink hover:bg-canvas transition"
      >
        {label}
        <Icon name="chevronDown" size={15} className={open ? "rotate-180" : ""} />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 bg-white border border-line rounded-xl shadow-e2 z-40 overflow-hidden">
          {items.map((it, i) => (
            <button
              key={i}
              onClick={() => { setOpen(false); it.onClick(); }}
              className="w-full text-left flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink hover:bg-canvas border-b border-line last:border-0"
            >
              {it.icon && <Icon name={it.icon} size={16} className="text-ink-3" />}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
