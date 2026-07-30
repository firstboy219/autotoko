import { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";

interface SmtpInfo {
  host: string | null;
  port: number;
  user: string | null;
  from: string | null;
  hasPassword: boolean;
  source: "db" | "env" | "none";
}

const SOURCE_LABEL: Record<SmtpInfo["source"], string> = {
  db: "Tersimpan di database (bisa diubah di sini)",
  env: "Dari file .env server (belum pernah diatur lewat halaman ini)",
  none: "Belum dikonfigurasi",
};

export function Smtp() {
  const { data, loading, reload } = useFetch<SmtpInfo>("/admin/smtp");
  const [host, setHost] = useState("smtp.gmail.com");
  const [port, setPort] = useState("587");
  const [user, setUser] = useState("");
  const [from, setFrom] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setHost(data.host ?? "smtp.gmail.com");
    setPort(String(data.port ?? 587));
    setUser(data.user ?? "");
    setFrom(data.from ?? "");
    setPass("");
  }, [data]);

  async function save() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      await api.put("/admin/smtp", {
        host: host.trim(),
        port: Number(port) || 587,
        user: user.trim(),
        from: from.trim() || undefined,
        // Blank means "keep the stored password" — the secret is never sent
        // back to the browser, so there is nothing to round-trip.
        ...(pass ? { pass } : {}),
      });
      setPass("");
      reload();
      setResult({ ok: true, message: "Pengaturan tersimpan. Jalankan tes untuk memastikan." });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setTesting(true);
    setErr(null);
    setResult(null);
    try {
      const r = await api.post<{ ok: boolean; message: string }>("/admin/smtp/test", {
        ...(testTo.trim() ? { to: testTo.trim() } : {}),
      });
      setResult(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setTesting(false);
    }
  }

  async function clearCfg() {
    if (!confirm("Hapus pengaturan SMTP dari database? Sistem akan kembali memakai nilai dari file .env server.")) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      await api.del("/admin/smtp");
      reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input =
    "w-full px-3 py-2 rounded-md bg-[#0f172a] border border-white/10 text-sm text-slate-100 placeholder:text-slate-600";
  const label = "block text-xs font-semibold text-slate-400 mb-1";

  return (
    <Layout title="Email / SMTP">
      <div className="max-w-2xl space-y-4">
        <div className="bg-[#1e293b] rounded-xl border border-white/10 p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="font-bold text-sm text-white">Konfigurasi Pengirim Email</div>
              <div className="text-xs text-slate-400 mt-0.5">
                Dipakai untuk OTP login lewat email dan notifikasi.
              </div>
            </div>
            {!loading && data && (
              <span className="text-[10px] font-semibold px-2 py-1 rounded bg-white/10 text-slate-300">
                {SOURCE_LABEL[data.source]}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
            <div>
              <label className={label}>Host</label>
              <input className={input} value={host} onChange={(e) => setHost(e.target.value)} />
            </div>
            <div>
              <label className={label}>Port</label>
              <input
                className={input}
                inputMode="numeric"
                value={port}
                onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
              />
              <p className="text-[10px] text-slate-500 mt-1">587 = STARTTLS, 465 = SSL.</p>
            </div>
            <div>
              <label className={label}>Akun / Username</label>
              <input
                className={input}
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder="kamu@gmail.com"
              />
            </div>
            <div>
              <label className={label}>Alamat Pengirim (From)</label>
              <input
                className={input}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                placeholder="AutoToko <kamu@gmail.com>"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Gmail hanya mengizinkan pengirim yang sama dengan akun di atas.
              </p>
            </div>
            <div className="sm:col-span-2">
              <label className={label}>
                App Password {data?.hasPassword && <span className="text-emerald-400">· sudah tersimpan</span>}
              </label>
              <input
                className={`${input} font-mono`}
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                placeholder={data?.hasPassword ? "Kosongkan jika tidak ingin mengubah" : "16 karakter dari Google"}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mt-4">
            <button
              onClick={save}
              disabled={busy || !host.trim() || !user.trim()}
              className="text-xs px-4 py-2 rounded-md bg-brand hover:bg-brand-dark text-white font-semibold disabled:opacity-50"
            >
              {busy ? "…" : "Simpan"}
            </button>
            {data?.source === "db" && (
              <button
                onClick={clearCfg}
                disabled={busy}
                className="text-xs px-3 py-2 rounded-md border border-white/10 text-slate-300 hover:bg-white/5 disabled:opacity-50"
              >
                Hapus & pakai .env
              </button>
            )}
          </div>
        </div>

        <div className="bg-[#1e293b] rounded-xl border border-white/10 p-4">
          <div className="font-bold text-sm text-white">Tes Koneksi</div>
          <div className="text-xs text-slate-400 mt-0.5 mb-3">
            Mengecek autentikasi ke server SMTP. Isi alamat tujuan bila ingin sekalian mengirim
            email percobaan.
          </div>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[220px]">
              <label className={label}>Kirim tes ke (opsional)</label>
              <input
                className={input}
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="tujuan@email.com"
              />
            </div>
            <button
              onClick={test}
              disabled={testing}
              className="text-xs px-4 py-2 rounded-md border border-white/10 text-slate-200 hover:bg-white/5 font-semibold disabled:opacity-50"
            >
              {testing ? "Menguji…" : "Jalankan Tes"}
            </button>
          </div>

          {result && (
            <div
              className={`mt-3 rounded-md border p-3 text-xs ${
                result.ok
                  ? "border-emerald-800/60 bg-emerald-900/20 text-emerald-300"
                  : "border-red-900/50 bg-red-900/20 text-red-300"
              }`}
            >
              {result.message}
            </div>
          )}
          {err && (
            <div className="mt-3 rounded-md border border-red-900/50 bg-red-900/20 p-3 text-xs text-red-300">
              {err}
            </div>
          )}
        </div>

        <div className="bg-[#1e293b] rounded-xl border border-white/10 p-4">
          <div className="font-bold text-sm text-white mb-2">Cara membuat Gmail App Password</div>
          <ol className="text-xs text-slate-400 space-y-1.5 list-decimal list-inside leading-relaxed">
            <li>Buka <span className="text-slate-200">myaccount.google.com</span> → Security.</li>
            <li>Aktifkan <span className="text-slate-200">2-Step Verification</span> (wajib, kalau belum aktif menu App passwords tidak muncul).</li>
            <li>Masuk ke <span className="text-slate-200">App passwords</span>, pilih jenis “Mail”.</li>
            <li>Salin 16 karakter yang muncul, tempel ke kolom App Password di atas — tanpa spasi.</li>
            <li>Simpan, lalu jalankan Tes Koneksi.</li>
          </ol>
          <p className="text-[10px] text-slate-500 mt-3 leading-relaxed">
            Password disimpan terenkripsi (AES-256) di database dan tidak pernah dikirim balik ke
            browser. Password akun Google biasa tidak akan bekerja — Gmail SMTP hanya menerima app
            password.
          </p>
        </div>
      </div>
    </Layout>
  );
}
