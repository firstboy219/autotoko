import { useMemo, useState } from "react";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";

interface Entry {
  category: string;
  cat: string;
  method: string;
  path: string;
  name: string;
  desc: string;
  used: boolean;
  feature: string;
  purpose: string;
}
interface Resp {
  catalog: Entry[];
  stats: { total: number; used: number };
}

const METHOD_CLS: Record<string, string> = {
  GET: "bg-emerald-500/15 text-emerald-400",
  POST: "bg-sky-500/15 text-sky-400",
  PUT: "bg-amber-500/15 text-amber-400",
  DELETE: "bg-red-500/15 text-red-400",
  PATCH: "bg-fuchsia-500/15 text-fuchsia-400",
};

type Filter = "used" | "unused" | "all";

export function TiktokApis() {
  const { data, loading, error } = useFetch<Resp>("/admin/tiktok-apis");
  const [filter, setFilter] = useState<Filter>("used");
  const [q, setQ] = useState("");

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const rows = (data?.catalog ?? []).filter((e) => {
      if (filter === "used" && !e.used) return false;
      if (filter === "unused" && e.used) return false;
      if (term) {
        const hay = `${e.path} ${e.name} ${e.desc} ${e.feature} ${e.category}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
    const byCat = new Map<string, Entry[]>();
    for (const e of rows) {
      const arr = byCat.get(e.category) ?? [];
      arr.push(e);
      byCat.set(e.category, arr);
    }
    return [...byCat.entries()];
  }, [data, filter, q]);

  const usedInCat = (cat: string) =>
    (data?.catalog ?? []).filter((e) => e.category === cat && e.used).length;
  const totalInCat = (cat: string) =>
    (data?.catalog ?? []).filter((e) => e.category === cat).length;

  const Btn = ({ v, label }: { v: Filter; label: string }) => (
    <button
      onClick={() => setFilter(v)}
      className={`px-3 py-1.5 rounded-md text-xs font-semibold ${
        filter === v ? "bg-brand text-white" : "border border-white/10 text-slate-300 hover:bg-white/5"
      }`}
    >
      {label}
    </button>
  );

  return (
    <Layout title="API Management — TikTok Shop">
      <div className="bg-[#1e293b] rounded-xl border border-white/10 p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-sm text-slate-300">
            {data ? (
              <>
                <span className="text-2xl font-bold text-emerald-400">{data.stats.used}</span>
                <span className="text-slate-500"> / {data.stats.total} endpoint dipakai AutoToko</span>
              </>
            ) : (
              "Memuat…"
            )}
          </div>
          <div className="flex gap-2 ml-auto">
            <Btn v="used" label="✔ Dipakai" />
            <Btn v="unused" label="○ Belum" />
            <Btn v="all" label="Semua" />
          </div>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari path, nama, fitur… (mis. withdraw, order, resi)"
          className="w-full mt-3 px-3 py-2 rounded-md bg-[#0f172a] border border-white/10 text-sm text-slate-100 placeholder:text-slate-500"
        />
        <p className="text-[11px] text-slate-500 mt-2">
          Katalog otomatis dari TikTok Shop OpenAPI. ✔ = dipakai AutoToko (dengan fitur & fungsinya); ○ = tersedia tapi belum dipakai.
        </p>
      </div>

      {error && <div className="text-red-400 text-sm mb-3">{error}</div>}
      {loading && <div className="text-slate-500 text-sm">Memuat katalog…</div>}

      <div className="space-y-4">
        {groups.map(([cat, rows]) => (
          <div key={cat} className="bg-[#1e293b] rounded-xl border border-white/10 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-white/10 flex items-center justify-between">
              <span className="font-bold text-sm text-white">{cat}</span>
              <span className="text-[11px] text-slate-400">
                {usedInCat(cat)} / {totalInCat(cat)} dipakai · {rows.length} tampil
              </span>
            </div>
            <div className="divide-y divide-white/5">
              {rows.map((e, i) => (
                <div key={`${e.method}${e.path}${i}`} className="px-4 py-2.5 flex items-start gap-3">
                  <span className={`shrink-0 mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded ${METHOD_CLS[e.method] ?? "bg-white/10 text-slate-300"}`}>
                    {e.method}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-xs text-slate-200 break-all">{e.path}</code>
                      {e.used ? (
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">✔ DIPAKAI</span>
                      ) : (
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-white/5 text-slate-500">○ belum</span>
                      )}
                    </div>
                    <div className="text-[12px] text-slate-300 font-medium mt-0.5">{e.name}</div>
                    {e.used ? (
                      <div className="mt-1 flex items-start gap-2">
                        <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-brand/20 text-brand">{e.feature}</span>
                        <span className="text-[11px] text-slate-400">{e.purpose}</span>
                      </div>
                    ) : (
                      e.desc && <div className="text-[11px] text-slate-500 mt-0.5">{e.desc}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {!loading && !groups.length && (
          <div className="text-slate-500 text-sm">Tidak ada endpoint yang cocok.</div>
        )}
      </div>
    </Layout>
  );
}
