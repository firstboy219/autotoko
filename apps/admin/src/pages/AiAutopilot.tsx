import { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";

type Provider = "anthropic" | "openai" | "gemini";

interface FeatureRow {
  key: string;
  label: string;
  description: string;
  provider: Provider;
  model: string;
  keyConfigured: boolean;
  enabled: boolean;
}

// Features that currently run fully automatically when enabled. Others store the
// toggle but their auto-trigger path (chat/review ingestion) is not wired yet.
const AUTO_WIRED = new Set(["auto_approve"]);

interface FeatureStatus {
  providers: Provider[];
  providerKeyStatus: Record<Provider, boolean>;
  providerKeySetting: Record<Provider, string>;
  defaultModels: Record<Provider, string>;
  features: FeatureRow[];
}

const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: "Claude (Anthropic)",
  openai: "OpenAI (GPT)",
  gemini: "Gemini (Google)",
};

function FeatureCard({
  f,
  defaults,
  keyStatus,
  providers,
  onSaved,
}: {
  f: FeatureRow;
  defaults: Record<Provider, string>;
  keyStatus: Record<Provider, boolean>;
  providers: Provider[];
  onSaved: () => void;
}) {
  const [provider, setProvider] = useState<Provider>(f.provider);
  const [model, setModel] = useState(f.model);
  const [enabled, setEnabled] = useState(f.enabled);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset local state if the upstream config changes (after reload).
  useEffect(() => {
    setProvider(f.provider);
    setModel(f.model);
    setEnabled(f.enabled);
  }, [f.provider, f.model, f.enabled]);

  async function save() {
    setBusy(true); setErr(null); setOk(false);
    try {
      await api.put(`/ai/features/${f.key}`, { provider, model: model.trim(), enabled });
      setOk(true); onSaved();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  const keyMissing = !keyStatus[provider];

  return (
    <div className="bg-[#1e293b] rounded-xl border border-white/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-bold text-sm text-white">{f.label}</div>
          <div className="text-[12px] text-slate-400 mt-0.5">{f.description}</div>
        </div>
        {ok && <span className="text-green-400 text-xs whitespace-nowrap">✓ tersimpan</span>}
      </div>

      <label className="flex items-center gap-2 mt-2.5 cursor-pointer select-none">
        <input
          type="checkbox"
          className="accent-brand w-4 h-4"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span className="text-[12px] text-slate-200">
          Jalankan otomatis (full-auto)
          {!AUTO_WIRED.has(f.key) && (
            <span className="ml-1 text-[10px] text-slate-500">
              — tersimpan; trigger otomatis menyusul (butuh ingest chat/review)
            </span>
          )}
        </span>
      </label>

      <div className="flex flex-wrap items-end gap-2 mt-3">
        <label className="text-[11px] text-slate-400">
          Provider
          <select
            className="block mt-1 px-2.5 py-1.5 rounded-md bg-[#0f172a] border border-white/10 text-sm text-slate-100 min-w-[160px]"
            value={provider}
            onChange={(e) => {
              const p = e.target.value as Provider;
              setProvider(p);
              // Suggest the provider's default model when switching.
              setModel(defaults[p]);
            }}
          >
            {providers.map((p) => (
              <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>
            ))}
          </select>
        </label>

        <label className="text-[11px] text-slate-400 flex-1 min-w-[200px]">
          Model
          <input
            className="block mt-1 w-full px-2.5 py-1.5 rounded-md bg-[#0f172a] border border-white/10 text-sm text-slate-100"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={defaults[provider]}
          />
        </label>

        <button
          onClick={save}
          disabled={busy || !model.trim()}
          className="px-3 py-1.5 rounded-md bg-brand hover:bg-brand-dark text-white text-xs font-semibold disabled:opacity-40"
        >
          {busy ? "…" : "Simpan"}
        </button>
      </div>

      {keyMissing && (
        <div className="text-[11px] text-amber-400 mt-2">
          ⚠️ API key untuk {PROVIDER_LABEL[provider]} belum diisi — isi di bagian "API Key Provider" di bawah.
        </div>
      )}
      {err && <div className="text-[11px] text-red-400 mt-2">{err}</div>}
    </div>
  );
}

function ProviderKeyField({
  provider,
  settingKey,
  saved,
  onSaved,
}: {
  provider: Provider;
  settingKey: string;
  saved: boolean;
  onSaved: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true); setErr(null); setOk(false);
    try {
      await api.put(`/admin/settings/${settingKey}`, { value });
      setOk(true); setValue(""); onSaved();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex items-center gap-2 py-1.5">
      <div className="w-44 text-sm text-slate-300">
        {PROVIDER_LABEL[provider]}
        <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${saved ? "bg-green-500/20 text-green-400" : "bg-slate-500/20 text-slate-400"}`}>
          {saved ? "tersimpan" : "kosong"}
        </span>
      </div>
      <input
        className="flex-1 px-3 py-1.5 rounded-md bg-[#0f172a] border border-white/10 text-sm text-slate-100"
        placeholder={saved ? "•••••• (isi untuk ganti)" : `${settingKey}`}
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

function Tester() {
  const [message, setMessage] = useState("Halo, produk ini ready stock kak?");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true); setErr(null); setReply("");
    try {
      const r = await api.post<{ reply: string }>("/ai/buyer-chat", { message });
      setReply(r.reply);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="bg-[#1e293b] rounded-xl border border-white/10 p-4">
      <div className="font-bold text-sm text-white mb-1">Uji Coba (Auto Chat Pembeli)</div>
      <div className="text-[12px] text-slate-400 mb-2">
        Mengirim pesan ke provider yang dipilih untuk fitur <b>Auto Chat Pembeli</b> — untuk memastikan API key & model benar.
      </div>
      <div className="flex gap-2">
        <input
          className="flex-1 px-3 py-1.5 rounded-md bg-[#0f172a] border border-white/10 text-sm text-slate-100"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button onClick={run} disabled={busy || !message.trim()} className="px-3 py-1.5 rounded-md bg-brand hover:bg-brand-dark text-white text-xs font-semibold disabled:opacity-40">
          {busy ? "…" : "Kirim"}
        </button>
      </div>
      {err && <div className="text-[12px] text-red-400 mt-2">{err}</div>}
      {reply && (
        <div className="text-[13px] text-slate-200 mt-2 whitespace-pre-wrap bg-[#0f172a] rounded-md p-3 border border-white/10">
          {reply}
        </div>
      )}
    </div>
  );
}

export function AiAutopilot() {
  const { data, reload } = useFetch<FeatureStatus>("/ai/features");

  return (
    <Layout title="AI Autopilot">
      <p className="text-sm text-slate-400 mb-4">
        Pilih <b>provider & model AI per fitur</b>. Misal: Auto Chat Pembeli pakai Gemini, Auto Chat Affiliator pakai OpenAI,
        Auto Approve pakai Claude. Semua tersimpan terenkripsi & bisa diganti tanpa deploy ulang.
      </p>

      {!data && <div className="text-slate-400 text-sm">Memuat…</div>}

      {data && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            {data.features.map((f) => (
              <FeatureCard
                key={f.key}
                f={f}
                defaults={data.defaultModels}
                keyStatus={data.providerKeyStatus}
                providers={data.providers}
                onSaved={reload}
              />
            ))}
          </div>

          <div className="bg-[#1e293b] rounded-xl border border-white/10 p-4">
            <div className="font-bold text-sm mb-1 text-white">API Key Provider</div>
            <div className="text-[12px] text-slate-400 mb-2">Isi minimal key untuk provider yang dipakai. Disimpan terenkripsi (AES-256).</div>
            {data.providers.map((p) => (
              <ProviderKeyField
                key={p}
                provider={p}
                settingKey={data.providerKeySetting[p]}
                saved={data.providerKeyStatus[p]}
                onSaved={reload}
              />
            ))}
          </div>

          <Tester />
        </div>
      )}
    </Layout>
  );
}
