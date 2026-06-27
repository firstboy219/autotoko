import { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { api } from "../lib/api";
import { useBranding, applyBranding, type Branding as B } from "../lib/branding";

const FIELDS: { key: string; label: string; type: "text" | "color"; hint?: string }[] = [
  { key: "brand_name", label: "Nama Brand", type: "text", hint: "cth. AutoToko" },
  { key: "brand_logo_url", label: "URL Logo", type: "text", hint: "URL gambar (https://…). Kosongkan untuk pakai inisial." },
  { key: "brand_primary", label: "Warna Highlight", type: "color", hint: "Warna utama / tombol (cth. hijau)" },
  { key: "brand_primary_dark", label: "Warna Highlight (gelap)", type: "color", hint: "Untuk hover" },
  { key: "brand_navy", label: "Warna Navy / Sidebar", type: "color", hint: "Warna gelap sidebar" },
];

const SETTING_TO_BRANDING: Record<string, keyof B> = {
  brand_name: "name",
  brand_logo_url: "logoUrl",
  brand_primary: "primary",
  brand_primary_dark: "primaryDark",
  brand_navy: "navy",
};

export function Branding() {
  const { branding, load } = useBranding();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!branding) return;
    setValues({
      brand_name: branding.name,
      brand_logo_url: branding.logoUrl ?? "",
      brand_primary: branding.primary,
      brand_primary_dark: branding.primaryDark,
      brand_navy: branding.navy,
    });
  }, [branding]);

  // Live preview as the admin tweaks colors.
  function preview(next: Record<string, string>) {
    applyBranding({
      name: next.brand_name || "AutoToko",
      logoUrl: next.brand_logo_url || null,
      primary: next.brand_primary || "#A3E00B",
      primaryDark: next.brand_primary_dark || "#84B800",
      navy: next.brand_navy || "#0B1B2E",
    });
  }

  function setVal(key: string, v: string) {
    const next = { ...values, [key]: v };
    setValues(next);
    if (SETTING_TO_BRANDING[key]) preview(next);
  }

  async function saveAll() {
    setBusy(true); setErr(null); setOk(false);
    try {
      for (const f of FIELDS) {
        await api.put(`/admin/settings/${f.key}`, { value: values[f.key] ?? "" });
      }
      await load();
      setOk(true);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Layout title="Branding">
      <p className="text-sm text-slate-400 mb-4">
        Atur nama, logo, dan warna aplikasi (web + admin). Perubahan warna tampil langsung sebagai
        pratinjau; klik Simpan untuk menerapkan ke semua pengguna.
      </p>

      <div className="bg-[#1e293b] rounded-xl border border-white/10 p-4 max-w-xl space-y-3">
        {FIELDS.map((f) => (
          <div key={f.key} className="flex items-center gap-3">
            <div className="w-44 text-sm text-slate-300">
              {f.label}
              {f.hint && <div className="text-[10px] text-slate-500">{f.hint}</div>}
            </div>
            {f.type === "color" ? (
              <div className="flex items-center gap-2 flex-1">
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(values[f.key] ?? "") ? values[f.key]! : "#000000"}
                  onChange={(e) => setVal(f.key, e.target.value)}
                  className="w-10 h-9 rounded border border-white/10 bg-transparent"
                />
                <input
                  className="flex-1 px-3 py-1.5 rounded-md bg-[#0f172a] border border-white/10 text-sm text-slate-100 font-mono"
                  value={values[f.key] ?? ""}
                  onChange={(e) => setVal(f.key, e.target.value)}
                  placeholder="#A3E00B"
                />
              </div>
            ) : (
              <input
                className="flex-1 px-3 py-1.5 rounded-md bg-[#0f172a] border border-white/10 text-sm text-slate-100"
                value={values[f.key] ?? ""}
                onChange={(e) => setVal(f.key, e.target.value)}
                placeholder={f.hint}
              />
            )}
          </div>
        ))}

        <div className="flex items-center gap-3 pt-2">
          <button onClick={saveAll} disabled={busy} className="px-4 py-2 rounded-md bg-brand hover:bg-brand-dark text-sm font-semibold disabled:opacity-40">
            {busy ? "Menyimpan…" : "Simpan"}
          </button>
          {ok && <span className="text-green-400 text-xs">✓ Tersimpan & diterapkan</span>}
          {err && <span className="text-red-400 text-xs">{err}</span>}
        </div>
      </div>

      <div className="mt-4 max-w-xl bg-[#1e293b] rounded-xl border border-white/10 p-4">
        <div className="text-xs text-slate-400 mb-2">Pratinjau tombol</div>
        <div className="flex gap-2">
          <button className="px-4 py-2 rounded-md bg-brand text-sm font-semibold">Tombol Utama</button>
          <span className="px-3 py-2 rounded-md bg-navy text-white text-sm">Sidebar</span>
        </div>
      </div>
    </Layout>
  );
}
