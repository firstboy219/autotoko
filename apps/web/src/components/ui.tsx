/**
 * Shared UI primitives — the whole app is built from these so pages stay
 * visually consistent. See DESIGN_SYSTEM.md. Aesthetic target is Google
 * Workspace: hairline borders, generous padding, restrained colour, weight
 * capped at 600.
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Icon, type IconName } from "./Icon";

/* ---------------------------------------------------------------- layout */

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  back?: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      {back}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[22px] font-semibold leading-7 text-ink">{title}</h1>
          {subtitle && <p className="text-sm text-ink-2 mt-1">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`bg-white border border-line rounded-lg ${padded ? "p-5" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

/** Titled section header for a non-padded Card (sits above a table/list). */
export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 border-b border-line">
      <div>
        <div className="text-sm font-medium text-ink">{title}</div>
        {subtitle && <div className="text-xs text-ink-2 mt-0.5">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

/* --------------------------------------------------------------- buttons */

type ButtonVariant = "filled" | "tonal" | "outline" | "text" | "danger";

const BTN: Record<ButtonVariant, string> = {
  filled: "bg-brand text-onbrand hover:brightness-95 active:brightness-90 border border-transparent",
  tonal: "bg-brand/12 text-brand-ink hover:bg-brand/20 border border-transparent",
  outline: "bg-white text-ink border border-line hover:bg-canvas",
  text: "bg-transparent text-brand-ink hover:bg-brand/10 border border-transparent",
  danger: "bg-white text-red-600 border border-red-200 hover:bg-red-50",
};

export function Button({
  children,
  variant = "outline",
  size = "md",
  icon,
  iconRight,
  loading = false,
  disabled,
  className = "",
  ...rest
}: {
  children?: React.ReactNode;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const pad = size === "sm" ? "h-8 px-3 text-xs gap-1.5" : "h-9 px-4 text-sm gap-2";
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded-full font-medium transition
        disabled:opacity-50 disabled:pointer-events-none
        focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40
        ${pad} ${BTN[variant]} ${className}`}
    >
      {loading ? <Spinner size={size === "sm" ? 13 : 15} /> : icon && <Icon name={icon} size={size === "sm" ? 15 : 17} />}
      {children}
      {iconRight && !loading && <Icon name={iconRight} size={size === "sm" ? 15 : 17} />}
    </button>
  );
}

export function Spinner({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`animate-spin ${className}`}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" className="opacity-25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/* ---------------------------------------------------------------- badges */

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

// MeetNippon's tint palette: soft tinted background + darkened text. The solid
// status colours only reach ~3:1 on their own tint, too low for 12px text.
const TONE: Record<Tone, string> = {
  neutral: "bg-mn-stone text-ink-2",
  success: "bg-mn-green-tint text-mn-green-ink",
  warning: "bg-mn-amber-tint text-mn-amber-ink",
  danger: "bg-mn-red-tint text-mn-red-ink",
  info: "bg-mn-teal-tint text-mn-teal",
  brand: "bg-brand/20 text-brand-ink",
};

export function Badge({
  children,
  tone = "neutral",
  icon,
}: {
  children: React.ReactNode;
  tone?: Tone;
  icon?: IconName;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TONE[tone]}`}
    >
      {icon && <Icon name={icon} size={13} />}
      {children}
    </span>
  );
}

/* ----------------------------------------------------------------- forms */

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className = "",
}: {
  label?: string;
  hint?: React.ReactNode;
  error?: string | null;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      {label && (
        <span className="block text-xs font-medium text-ink-2 mb-1.5">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </span>
      )}
      {children}
      {error ? (
        <span className="flex items-center gap-1 text-xs text-red-600 mt-1">
          <Icon name="warning" size={13} /> {error}
        </span>
      ) : (
        hint && <span className="block text-xs text-ink-3 mt-1">{hint}</span>
      )}
    </label>
  );
}

const CONTROL =
  "w-full h-9 px-3 rounded-lg border border-line bg-white text-sm text-ink placeholder:text-ink-3 " +
  "transition focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 " +
  "disabled:bg-canvas disabled:text-ink-3";

export function Input({
  invalid,
  className = "",
  ...rest
}: { invalid?: boolean } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={`${CONTROL} ${invalid ? "border-red-400 focus:border-red-400 focus:ring-red-100" : ""} ${className}`}
    />
  );
}

export function Select({
  className = "",
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={`${CONTROL} pr-8 ${className}`}>
      {children}
    </select>
  );
}

export function Textarea({
  className = "",
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={`${CONTROL} h-auto py-2 ${className}`} />;
}

/* ---------------------------------------------------------------- tables */

export function TableWrap({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

export function Table({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <table className={`w-full text-sm min-w-[640px] ${className}`}>{children}</table>;
}

export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="bg-canvas">{children}</thead>;
}

export function TH({
  children,
  align = "left",
  className = "",
}: {
  children?: React.ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  return (
    <th
      className={`px-4 py-2.5 text-xs font-medium text-ink-2 text-${align} whitespace-nowrap ${className}`}
    >
      {children}
    </th>
  );
}

export function TR({
  children,
  className = "",
  ...rest
}: { children: React.ReactNode } & React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr {...rest} className={`border-t border-line ${className}`}>
      {children}
    </tr>
  );
}

export function TD({
  children,
  align = "left",
  className = "",
  ...rest
}: {
  children?: React.ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
} & React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td {...rest} className={`px-4 py-3 text-${align} ${className}`}>
      {children}
    </td>
  );
}

/* ------------------------------------------------- loading / empty state */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-200/70 ${className}`} />;
}

export function SkeletonRows({ n = 4, cols = 4 }: { n?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: n }).map((_, r) => (
        <tr key={r} className="border-t border-line">
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-4 py-3.5">
              <Skeleton className={`h-3.5 ${c === 0 ? "w-32" : "w-20"}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function EmptyState({
  icon = "inbox",
  title,
  description,
  action,
  className = "",
}: {
  icon?: IconName;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center text-center px-6 py-12 ${className}`}>
      <div className="w-11 h-11 rounded-full bg-canvas border border-line flex items-center justify-center text-ink-3 mb-3">
        <Icon name={icon} size={20} />
      </div>
      <div className="text-sm font-medium text-ink">{title}</div>
      {description && <div className="text-sm text-ink-2 mt-1 max-w-sm">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------- stat tile */

export function StatTile({
  label,
  value,
  sub,
  icon,
  loading = false,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: IconName;
  loading?: boolean;
}) {
  return (
    <Card className="min-w-0">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium text-ink-2">{label}</div>
        {icon && <Icon name={icon} size={18} className="text-ink-3" />}
      </div>
      {loading ? (
        <Skeleton className="h-7 w-24 mt-2" />
      ) : (
        <div className="font-display text-2xl font-semibold text-ink mt-1.5 tabular-nums truncate">
          {value}
        </div>
      )}
      {sub && <div className="text-xs text-ink-3 mt-1 truncate">{sub}</div>}
    </Card>
  );
}

/* ----------------------------------------------------------------- modal */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = "max-w-md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={`relative w-full ${width} bg-white rounded-xl shadow-e2 border border-line`}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <div className="text-base font-medium text-ink">{title}</div>
          <button
            onClick={onClose}
            aria-label="Tutup"
            className="p-1 rounded-full text-ink-3 hover:bg-canvas hover:text-ink"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="px-5 py-4 text-sm text-ink">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-line">{footer}</div>
        )}
      </div>
    </div>
  );
}

/** Confirm dialog — replaces window.confirm() for destructive actions. */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Hapus",
  loading = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={loading}>
            Batal
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-ink-2">{description}</div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- toasts */

type ToastItem = { id: number; msg: string; tone: Tone };
const ToastCtx = createContext<(msg: string, tone?: Tone) => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((msg: string, tone: Tone = "neutral") => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, msg, tone }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 4000);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 pointer-events-none">
        {items.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-center gap-2 rounded-lg bg-slate-900 text-white text-sm px-4 py-2.5 shadow-e2"
          >
            {t.tone === "success" && <Icon name="checkCircle" size={16} className="text-emerald-400" />}
            {t.tone === "danger" && <Icon name="xCircle" size={16} className="text-red-400" />}
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* -------------------------------------------------------------- messages */

export function InlineAlert({
  tone = "danger",
  children,
}: {
  tone?: "danger" | "warning" | "info" | "success";
  children: React.ReactNode;
}) {
  const map = {
    danger: "bg-red-50 text-red-700 border-red-100",
    warning: "bg-amber-50 text-amber-800 border-amber-100",
    info: "bg-blue-50 text-blue-700 border-blue-100",
    success: "bg-emerald-50 text-emerald-700 border-emerald-100",
  } as const;
  const icon: Record<"danger" | "warning" | "info" | "success", IconName> = {
    danger: "xCircle",
    warning: "warning",
    info: "info",
    success: "checkCircle",
  };
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-sm ${map[tone]}`}>
      <Icon name={icon[tone]} size={16} className="mt-0.5" />
      <div>{children}</div>
    </div>
  );
}
