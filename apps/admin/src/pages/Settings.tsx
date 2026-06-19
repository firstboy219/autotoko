import { useState } from "react";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";

interface SettingMeta {
  key: string;
  description: string | null;
  hasValue: boolean;
  updatedAt: string;
}

const GROUPS: { title: string; keys: { key: string; label: string }[] }[] = [
  {
    title: "TikTok Shop",
    keys: [
      { key: "tiktok_app_key", label: "App Key (untuk token exchange)" },
      { key: "tiktok_app_secret", label: "App Secret" },
      { key: "tiktok_service_id", label: "Service ID / App ID (Partner Center → App Detail — WAJIB, BEDA dari App Key)" },
      { key: "tiktok_auth_url", label: "Authorize URL (opsional override)" },
    ],
  },
  {
    title: "Shopee",
    keys: [
      { key: "shopee_partner_id", label: "Partner ID" },
      { key: "shopee_partner_key", label: "Partner Key" },
      { key: "shopee_redirect_url", label: "Redirect URL" },
    ],
  },
  {
    title: "Payment (Midtrans)",
    keys: [
      { key: "midtrans_server_key", label: "Server Key" },
      { key: "midtrans_client_key", label: "Client Key" },
      { key: "midtrans_is_production", label: "Production? (true/false)" },
    ],
  },
  {
    title: "AI (Claude — configurable)",
    keys: [
      { key: "anthropic_api_key", label: "Anthropic API Key" },
      { key: "ai_provider", label: "Provider (default anthropic)" },
      { key: "ai_model", label: "Model (default claude-opus-4-8)" },
    ],
  },
  {
    title: "Email (SendGrid) & lainnya",
    keys: [
      { key: "sendgrid_api_key", label: "SendGrid API Key" },
      { key: "sendgrid_from_email", label: "From Email" },
      { key: "revo_print_api_key", label: "Revo Print API Key" },
      { key: "webhook_ingest_secret", label: "Webhook Ingest Secret" },
    ],
  },
];

function Field({ k, label, saved, onSaved }: { k: string; label: string; saved: boolean; onSaved: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true); setErr(null); setOk(false);
    try {
      await api.put(`/admin/settings/${k}`, { value });
      setOk(true); setValue(""); onSaved();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex items-center gap-2 py-1.5">
      <div className="w-56 text-sm text-slate-300">
        {label}
        <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${saved ? "bg-green-500/20 text-green-400" : "bg-slate-500/20 text-slate-400"}`}>
          {saved ? "tersimpan" : "kosong"}
        </span>
      </div>
      <input
        className="flex-1 px-3 py-1.5 rounded-md bg-[#0f172a] border border-white/10 text-sm text-slate-100"
        placeholder={saved ? "•••••• (isi untuk ganti)" : "masukkan nilai"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button onClick={save} disabled={busy || !value} className="px-3 py-1.5 rounded-md bg-brand hover:bg-brand-dark text-white text-xs font-semibold disabled:opacity-40">
        {busy ? "…" : "Simpan"}
      </button>
      {ok && <span className="text-green-400 text-xs">✓</span>}
      {err && <span className="text-red-400 text-xs">{err}</span>}
    </div>
  );
}

export function Settings() {
  const { data, reload } = useFetch<SettingMeta[]>("/admin/settings");
  const saved = new Set((data ?? []).filter((s) => s.hasValue).map((s) => s.key));

  return (
    <Layout title="Kredensial & Config">
      <p className="text-sm text-slate-400 mb-4">
        Semua nilai disimpan <b>terenkripsi (AES-256)</b>. Nilai tersimpan tidak ditampilkan; isi
        field untuk mengganti.
      </p>
      <div className="space-y-4">
        {GROUPS.map((g) => (
          <div key={g.title} className="bg-[#1e293b] rounded-xl border border-white/10 p-4">
            <div className="font-bold text-sm mb-2 text-white">{g.title}</div>
            {g.keys.map((k) => (
              <Field key={k.key} k={k.key} label={k.label} saved={saved.has(k.key)} onSaved={reload} />
            ))}
          </div>
        ))}
      </div>
    </Layout>
  );
}
