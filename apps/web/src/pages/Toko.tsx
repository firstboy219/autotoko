import { useState } from "react";
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

export function Toko() {
  const { data, loading } = useFetch<Shop[]>("/shops");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

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

  return (
    <Layout title="Toko Saya">
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => connect("shopee")}
          disabled={busy !== null}
          className="px-4 py-2 rounded-md bg-[#EE4D2D] text-white text-sm font-semibold disabled:opacity-60"
        >
          + Hubungkan Shopee
        </button>
        <button
          onClick={() => connect("tiktok")}
          disabled={busy !== null}
          className="px-4 py-2 rounded-md bg-navy text-white text-sm font-semibold disabled:opacity-60"
        >
          + Hubungkan TikTok
        </button>
      </div>
      {err && <div className="text-red-500 text-sm mb-3">{err}</div>}

      {loading ? (
        <div className="text-slate-400 text-sm">Memuat…</div>
      ) : !data?.length ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
          Belum ada toko terhubung. Klik tombol di atas untuk mulai (OAuth).
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {data.map((s) => (
            <div key={s.id} className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <div className="font-bold">{s.shopName ?? s.shopId}</div>
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                    s.shopStatus === "active"
                      ? "bg-green-100 text-green-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {s.shopStatus}
                </span>
              </div>
              <div className="text-xs text-slate-500 mt-1 capitalize">
                {s.marketplace} · {s.sellerRegion ?? "-"}
              </div>
              <div className="text-[11px] text-slate-400 mt-2">
                Terhubung: {dateShort(s.connectedAt)} · Token exp:{" "}
                {dateShort(s.accessTokenExpireAt)}
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
