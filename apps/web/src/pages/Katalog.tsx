import { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";

interface ProductHealth {
  id: string;
  name: string;
  sku: string;
  status: string;
  score: "A" | "B" | "C" | "D";
  sold7d: number;
  views7d: number;
  gmv7d: number;
  conversion: number;
  reviewScore: number | null;
  reviewCount: number;
  eliminationCandidate: boolean;
  reasons: string[];
}

const SCORE_STYLE: Record<ProductHealth["score"], string> = {
  A: "bg-green-100 text-green-700",
  B: "bg-blue-100 text-blue-700",
  C: "bg-amber-100 text-amber-700",
  D: "bg-red-100 text-red-700",
};

const rp = (n: number) => "Rp " + n.toLocaleString("id-ID");

function OptimizeModal({ p, onClose }: { p: ProductHealth; onClose: () => void }) {
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ title: string; description: string } | null>(null);

  useEffect(() => {
    api
      .post<{ title: string; description: string }>("/ai/optimize-product", { name: p.name })
      .then(setResult)
      .catch((e) => setErr((e as Error).message))
      .finally(() => setBusy(false));
  }, [p.name]);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-lg w-full p-5" onClick={(e) => e.stopPropagation()}>
        <div className="font-bold text-slate-800 mb-1">AI Optimasi — {p.name}</div>
        <p className="text-xs text-slate-400 mb-3">Saran AI. Salin ke produk bila cocok (apply otomatis ke marketplace menyusul saat integrasi listing aktif).</p>
        {busy && <div className="text-slate-400 text-sm">AI sedang menulis…</div>}
        {err && <div className="text-red-500 text-sm">{err}</div>}
        {result && (
          <div className="space-y-3">
            <div>
              <div className="text-[11px] font-semibold text-slate-500 mb-1">Judul</div>
              <div className="text-sm bg-slate-50 border border-slate-200 rounded-md p-2">{result.title}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold text-slate-500 mb-1">Deskripsi</div>
              <div className="text-sm bg-slate-50 border border-slate-200 rounded-md p-2 whitespace-pre-wrap max-h-60 overflow-y-auto">
                {result.description}
              </div>
            </div>
          </div>
        )}
        <button onClick={onClose} className="mt-4 w-full py-2 rounded-md bg-slate-700 text-white text-sm font-semibold">
          Tutup
        </button>
      </div>
    </div>
  );
}

export function Katalog() {
  const { data, loading } = useFetch<ProductHealth[]>("/catalog/health");
  const [optimize, setOptimize] = useState<ProductHealth | null>(null);

  const rows = data ?? [];
  const candidates = rows.filter((r) => r.eliminationCandidate);

  return (
    <Layout title="Kesehatan Katalog">
      <p className="text-sm text-slate-500 mb-4">
        Skor kesehatan produk (A–D) dihitung otomatis tiap minggu dari performa 7 hari. Produk
        berperforma rendah ditandai sebagai kandidat eliminasi (tidak dihapus otomatis).
      </p>

      {loading && <div className="text-slate-400 text-sm">Mengevaluasi…</div>}

      {!loading && rows.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
          Belum ada master produk untuk dievaluasi.
        </div>
      )}

      {candidates.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-sm text-red-700">
          ⚠️ {candidates.length} produk disarankan ditinjau untuk dinonaktifkan: {candidates.map((c) => c.name).join(", ")}
        </div>
      )}

      <div className="space-y-2">
        {rows.map((p) => (
          <div key={p.id} className="bg-white rounded-xl border border-slate-200 p-3 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center font-extrabold ${SCORE_STYLE[p.score]}`}>
              {p.score}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm text-slate-800 truncate">{p.name}</div>
              <div className="text-[11px] text-slate-400">
                {p.sold7d} terjual · {rp(p.gmv7d)} GMV · konversi {(p.conversion * 100).toFixed(1)}%
                {p.reviewScore != null && ` · ⭐ ${p.reviewScore} (${p.reviewCount})`}
              </div>
              {p.reasons.length > 0 && (
                <div className="text-[11px] text-amber-600 mt-0.5">{p.reasons.join(" · ")}</div>
              )}
            </div>
            <button
              onClick={() => setOptimize(p)}
              className="px-3 py-1.5 rounded-md bg-brand hover:bg-brand-dark text-white text-xs font-semibold whitespace-nowrap"
            >
              ✨ AI Optimasi
            </button>
          </div>
        ))}
      </div>

      {optimize && <OptimizeModal p={optimize} onClose={() => setOptimize(null)} />}
    </Layout>
  );
}
