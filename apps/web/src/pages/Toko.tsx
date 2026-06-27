import { useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";
import { dateShort } from "../lib/fmt";

interface Shop {
  id: string;
  marketplace: string;
  shopId: string;
  shopName: string | null;
  sellerRegion: string | null;
  shopStatus: string;
  accessTokenExpireAt: string | null;
  connectedAt: string | null;
}

const DAY = 86400_000;

/** Days until expiry; null if unknown. */
function daysToExpiry(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((new Date(iso).getTime() - Date.now()) / DAY);
}

export function Toko() {
  const { data, loading, reload } = useFetch<Shop[]>("/shops");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function connect(mp: "tiktok" | "shopee") {
    setBusy(mp);
    setErr(null);
    try {
      const { authUrl } = await api.get<{ authUrl: string }>(`/shops/connect/${mp}`);
      window.location.href = authUrl;
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  }

  async function refresh(id: string) {
    setBusy(id); setErr(null); setMsg(null);
    try {
      await api.post(`/shops/${id}/refresh`);
      setMsg("Token diperbarui.");
      reload();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function disconnect(s: Shop) {
    if (!confirm(`Putuskan koneksi toko "${s.shopName ?? s.shopId}"? Order lama tetap tersimpan.`)) return;
    setBusy(s.id); setErr(null); setMsg(null);
    try {
      await api.del(`/shops/${s.id}`);
      reload();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  return (
    <Layout title="Toko Saya">
      <div className="flex gap-2 mb-2">
        <button onClick={() => connect("shopee")} disabled={busy !== null} className="px-4 py-2 rounded-md bg-[#EE4D2D] text-white text-sm font-semibold disabled:opacity-60">
          + Hubungkan Shopee
        </button>
        <button onClick={() => connect("tiktok")} disabled={busy !== null} className="px-4 py-2 rounded-md bg-navy text-white text-sm font-semibold disabled:opacity-60">
          + Hubungkan TikTok
        </button>
      </div>
      <p className="text-[11px] text-slate-400 mb-4">
        Dengan menghubungkan toko, kamu menyetujui{" "}
        <Link to="/terms" className="underline">Ketentuan Layanan</Link> &{" "}
        <Link to="/privacy" className="underline">Kebijakan Privasi</Link>.
      </p>
      {err && <div className="text-red-500 text-sm mb-3">{err}</div>}
      {msg && <div className="text-green-600 text-sm mb-3">{msg}</div>}

      {loading ? (
        <div className="text-slate-400 text-sm">Memuat…</div>
      ) : !data?.length ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
          Belum ada toko terhubung. Klik tombol di atas untuk mulai (OAuth).
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {data.map((s) => {
            const dte = daysToExpiry(s.accessTokenExpireAt);
            const expiring = dte !== null && dte < 7;
            return (
              <div key={s.id} className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <div className="font-bold">{s.shopName ?? s.shopId}</div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${s.shopStatus === "active" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                    {s.shopStatus === "active" ? "Terhubung" : s.shopStatus}
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-1 capitalize">{s.marketplace} · {s.sellerRegion ?? "-"}</div>
                <div className="text-[11px] text-slate-400 mt-2">
                  Terhubung: {dateShort(s.connectedAt)}
                </div>
                <div className="text-[11px] mt-0.5 flex items-center gap-1">
                  <span className="text-slate-400">Token expire: {dateShort(s.accessTokenExpireAt)}</span>
                  {dte !== null && (
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${expiring ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-500"}`}>
                      {dte < 0 ? "kedaluwarsa" : `${dte} hari`}
                    </span>
                  )}
                </div>
                <div className="flex gap-2 mt-3">
                  <button onClick={() => refresh(s.id)} disabled={busy !== null} className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold disabled:opacity-50">
                    🔄 Refresh Token
                  </button>
                  <button onClick={() => disconnect(s)} disabled={busy !== null} className="px-2.5 py-1 rounded-md text-red-600 hover:bg-red-50 text-xs font-semibold disabled:opacity-50">
                    Putus Koneksi
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Layout>
  );
}
