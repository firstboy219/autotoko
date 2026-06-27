import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";

interface Affiliate {
  id: string;
  creatorName: string | null;
  creatorId: string | null;
  followerCount: number | null;
  niche: string | null;
  status: "prospect" | "invited" | "active" | "rejected" | "blacklist";
  commissionRate: string | null;
  totalGmv: string;
  notes: string | null;
}

const STATUS: Record<Affiliate["status"], { label: string; cls: string }> = {
  prospect: { label: "Prospek", cls: "bg-slate-100 text-slate-600" },
  invited: { label: "Diundang", cls: "bg-amber-100 text-amber-700" },
  active: { label: "Aktif", cls: "bg-green-100 text-green-700" },
  rejected: { label: "Ditolak", cls: "bg-red-100 text-red-700" },
  blacklist: { label: "Blacklist", cls: "bg-red-100 text-red-700" },
};

const fmt = (n: number) => n.toLocaleString("id-ID");

export function Affiliate() {
  const { data, loading } = useFetch<Affiliate[]>("/marketing/affiliates");
  const rows = data ?? [];

  return (
    <Layout title="Affiliate">
      <p className="text-sm text-slate-500 mb-4">
        Manajemen kreator/affiliator. AI membantu mencari, mengundang, dan chat negosiasi komisi
        secara otomatis.
      </p>
      {loading && <div className="text-slate-400 text-sm">Memuat…</div>}
      {!loading && rows.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
          Belum ada affiliator.
        </div>
      )}
      <div className="space-y-2">
        {rows.map((a) => {
          const s = STATUS[a.status];
          return (
            <div key={a.id} className="bg-white rounded-xl border border-slate-200 p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm text-slate-800">{a.creatorName ?? a.creatorId}</span>
                {a.creatorId && <span className="text-[11px] text-slate-400">{a.creatorId}</span>}
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${s.cls}`}>{s.label}</span>
              </div>
              <div className="text-[12px] text-slate-500 mt-0.5">
                {a.followerCount != null && `${fmt(a.followerCount)} follower`}
                {a.niche && ` · ${a.niche}`}
                {a.commissionRate && ` · komisi ${a.commissionRate}%`}
                {Number(a.totalGmv) > 0 && ` · GMV Rp ${fmt(Number(a.totalGmv))}`}
              </div>
              {a.notes && <div className="text-[11px] text-slate-400 mt-0.5">{a.notes}</div>}
            </div>
          );
        })}
      </div>
    </Layout>
  );
}
