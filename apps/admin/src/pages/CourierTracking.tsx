import { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";

interface TrackingConfig {
  configured: boolean;
  provider: string;
  blockInTransit: boolean;
}

/**
 * Courier lookup before a parcel is accepted.
 *
 * Inert until a key is stored, and deliberately so: with nothing configured,
 * scanning behaves exactly as it did before rather than failing. The page says
 * plainly what happens when the provider is slow or down, because a packer
 * standing at a bench needs to know whether silence means "checked" or "not
 * checked".
 */
export function CourierTracking() {
  const { data, loading, reload } = useFetch<TrackingConfig>("/resi/tracking-config");
  const [apiKey, setApiKey] = useState("");
  const [blockInTransit, setBlockInTransit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testAwb, setTestAwb] = useState("");
  const [testCourier, setTestCourier] = useState("jnt");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (data) setBlockInTransit(data.blockInTransit);
  }, [data]);

  async function save() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      await api.patch("/resi/tracking-config", {
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        blockInTransit,
      });
      setApiKey("");
      reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    if (!apiKey.trim() || !testAwb.trim()) return;
    setTesting(true);
    setResult(null);
    try {
      const r = await api.post<{ ok: boolean; message: string }>("/resi/tracking-test", {
        apiKey: apiKey.trim(),
        courier: testCourier,
        awb: testAwb.trim(),
      });
      setResult(r);
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Layout title="Cek Resi ke Kurir">
      <div className="max-w-2xl space-y-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-sm font-semibold text-slate-700 mb-1">
            Pengecekan Status ke Kurir
          </div>
          <p className="text-xs text-slate-500 mb-3 leading-relaxed">
            Saat sebuah resi discan dari aplikasi, sistem menanyakan statusnya ke kurir lebih
            dulu. Resi yang <strong>sudah dibatalkan/diretur</strong> atau{" "}
            <strong>sudah berstatus terkirim</strong> akan ditolak. Resi yang belum dikenal kurir
            tetap diterima &mdash; itu keadaan normal untuk paket yang baru dikemas.
          </p>

          {loading && <div className="text-xs text-slate-400">Memuat…</div>}

          {data && (
            <div
              className={`text-xs rounded-lg px-3 py-2 mb-3 ${
                data.configured
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-amber-50 text-amber-800 border border-amber-200"
              }`}
            >
              {data.configured
                ? `Aktif — penyedia ${data.provider}.`
                : "Belum aktif. Tanpa API key, pengecekan dilewati dan scan berjalan seperti biasa."}
            </div>
          )}

          <label className="block text-xs text-slate-500 mb-1">
            API Key (BinderByte) — daftar di binderbyte.com
          </label>
          <input
            className="w-full px-3 py-2 rounded-md border border-slate-200 text-sm mb-1"
            type="password"
            placeholder={data?.configured ? "•••••• (isi untuk mengganti)" : "tempel API key di sini"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <p className="text-[11px] text-slate-400 mb-3">
            Disimpan terenkripsi. Kolom ini tidak pernah menampilkan kunci yang sudah tersimpan.
          </p>

          <label className="flex items-start gap-2 text-xs text-slate-600 mb-3">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={blockInTransit}
              onChange={(e) => setBlockInTransit(e.target.checked)}
            />
            <span>
              Tolak juga resi yang <strong>sudah dalam pengiriman</strong>.
              <br />
              <span className="text-slate-400">
                Matikan kalau kurir Anda mencatat resi sebagai &quot;dalam proses&quot; sejak label
                dicetak &mdash; kalau itu terjadi, semua scan pertama akan ikut tertolak. Penolakan
                untuk resi batal dan terkirim tetap berlaku.
              </span>
            </span>
          </label>

          <button
            onClick={save}
            disabled={busy}
            className="px-3 py-2 rounded-md bg-brand hover:bg-brand-dark text-white text-xs font-semibold disabled:opacity-40"
          >
            {busy ? "Menyimpan…" : "Simpan"}
          </button>
          {err && <div className="text-red-500 text-xs mt-2">{err}</div>}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-sm font-semibold text-slate-700 mb-1">Uji Koneksi</div>
          <p className="text-xs text-slate-500 mb-3">
            Isi API key di atas, lalu coba dengan satu nomor resi yang Anda tahu statusnya.
          </p>
          <div className="flex gap-2 mb-2">
            <select
              className="px-3 py-2 rounded-md border border-slate-200 text-sm"
              value={testCourier}
              onChange={(e) => setTestCourier(e.target.value)}
            >
              <option value="jnt">J&amp;T</option>
              <option value="jne">JNE</option>
              <option value="spx">SPX / Shopee Express</option>
              <option value="sicepat">SiCepat</option>
              <option value="anteraja">Anteraja</option>
              <option value="ide">ID Express</option>
            </select>
            <input
              className="flex-1 px-3 py-2 rounded-md border border-slate-200 text-sm"
              placeholder="nomor resi"
              value={testAwb}
              onChange={(e) => setTestAwb(e.target.value)}
            />
            <button
              onClick={test}
              disabled={testing || !apiKey.trim() || !testAwb.trim()}
              className="px-3 rounded-md border border-slate-200 text-xs font-semibold disabled:opacity-40"
            >
              {testing ? "…" : "Uji"}
            </button>
          </div>
          {result && (
            <div
              className={`text-xs rounded-lg px-3 py-2 ${
                result.ok
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-red-50 text-red-700 border border-red-200"
              }`}
            >
              {result.message}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-sm font-semibold text-slate-700 mb-2">Yang perlu diketahui</div>
          <ul className="text-xs text-slate-500 space-y-1.5 list-disc pl-4 leading-relaxed">
            <li>
              Kalau penyedia lambat atau mati, scan <strong>tetap diterima</strong>. Gudang tidak
              boleh berhenti karena layanan pihak ketiga bermasalah. Batas tunggunya 2,5 detik.
            </li>
            <li>
              Resi yang kurirnya tidak dikenali (bukan J&amp;T, JNE, SPX, SiCepat, Anteraja, ID
              Express) tidak bisa dicek dan langsung diterima.
            </li>
            <li>
              Status mentah dari kurir disimpan di tiap scan, sehingga status yang belum dikenali
              sistem terlihat di data dan bisa ditambahkan.
            </li>
          </ul>
        </div>
      </div>
    </Layout>
  );
}
