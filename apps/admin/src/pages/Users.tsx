import { Fragment, useState } from "react";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";

type PlanType = "freemium" | "starter" | "pro";
type StatusFilter = "" | "active" | "suspended" | "inactive";

interface UserRow {
  id: string;
  email: string | null;
  whatsapp: string | null;
  fullName: string | null;
  planType: PlanType;
  planExpiredAt: string | null;
  isActive: boolean;
  isSuspended: boolean;
  createdAt: string;
  walletBalance: string;
  subSellerCount: number;
  subSubSellerCount: number;
  shopCount: number;
}
interface ListResponse {
  items: UserRow[];
  total: number;
  page: number;
  pageSize: number;
}
interface SubSubSellerNode {
  id: string; name: string; contact: string | null; bankAccount: string | null;
  defaultRate: string; status: "active" | "inactive";
}
interface SubSellerNode extends SubSubSellerNode {
  subSubSellers: SubSubSellerNode[];
}
interface UserDetail extends UserRow {
  planStartedAt: string | null;
  hierarchy: SubSellerNode[];
}

const PLAN_LABEL: Record<PlanType, string> = { freemium: "Freemium", starter: "Starter", pro: "Pro" };
const PAGE_SIZE = 20;

const rupiah = (v: string | number) =>
  `Rp ${Math.round(Number(v)).toLocaleString("id-ID")}`;
const dateShort = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "-";

function statusOf(u: { isActive: boolean; isSuspended: boolean }): { label: string; cls: string } {
  if (u.isSuspended) return { label: "Ditangguhkan", cls: "bg-red-500/15 text-red-400" };
  if (!u.isActive) return { label: "Nonaktif", cls: "bg-white/10 text-white/50" };
  return { label: "Aktif", cls: "bg-emerald-500/15 text-emerald-400" };
}

export function Users() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [plan, setPlan] = useState<PlanType | "">("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const qs = new URLSearchParams();
  if (search.trim()) qs.set("search", search.trim());
  if (plan) qs.set("plan", plan);
  if (status) qs.set("status", status);
  qs.set("page", String(page));
  qs.set("pageSize", String(PAGE_SIZE));

  const { data, loading, error, reload } = useFetch<ListResponse>(`/admin/users?${qs.toString()}`);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
  }

  return (
    <Layout title="Manajemen User">
      <div className="bg-[#1e293b] rounded-xl border border-white/10 p-4 mb-4">
        <form onSubmit={submitSearch} className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">Cari</label>
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Nama, email, atau nomor WhatsApp…"
              className="w-full px-3 py-2 rounded-md bg-[#0f172a] border border-white/10 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-brand"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">Plan</label>
            <select
              value={plan}
              onChange={(e) => { setPlan(e.target.value as PlanType | ""); setPage(1); }}
              className="px-3 py-2 rounded-md bg-[#0f172a] border border-white/10 text-sm text-slate-100"
            >
              <option value="">Semua</option>
              <option value="freemium">Freemium</option>
              <option value="starter">Starter</option>
              <option value="pro">Pro</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value as StatusFilter); setPage(1); }}
              className="px-3 py-2 rounded-md bg-[#0f172a] border border-white/10 text-sm text-slate-100"
            >
              <option value="">Semua</option>
              <option value="active">Aktif</option>
              <option value="suspended">Ditangguhkan</option>
              <option value="inactive">Nonaktif</option>
            </select>
          </div>
          <button className="px-4 py-2 rounded-md bg-brand hover:bg-brand-dark text-white text-sm font-semibold">
            Cari
          </button>
        </form>
      </div>

      {error && <div className="text-red-400 text-sm mb-3">{error}</div>}

      <div className="bg-[#1e293b] rounded-xl border border-white/10 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <span className="font-bold text-sm text-white">
            {loading ? "Memuat…" : `${data?.total ?? 0} seller`}
          </span>
          {data && data.total > 0 && (
            <span className="text-xs text-slate-400">
              Halaman {data.page} dari {totalPages}
            </span>
          )}
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-black/20 text-[10px] uppercase text-slate-400">
              <th className="text-left px-4 py-2">Seller</th>
              <th className="text-left px-4 py-2">Plan</th>
              <th className="text-left px-4 py-2">Toko / Hierarki</th>
              <th className="text-left px-4 py-2">Saldo</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="text-left px-4 py-2">Daftar</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">Memuat…</td></tr>
            ) : !data?.items.length ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">Tidak ada seller yang cocok.</td></tr>
            ) : (
              data.items.map((u) => {
                const s = statusOf(u);
                return (
                  <Fragment key={u.id}>
                    <tr className="border-t border-white/5 text-slate-200">
                      <td className="px-4 py-2.5">
                        <div className="font-semibold">{u.fullName || "(tanpa nama)"}</div>
                        <div className="text-[11px] text-slate-500">{u.email ?? u.whatsapp ?? "-"}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-white/10 text-slate-200">
                          {PLAN_LABEL[u.planType]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-400 text-xs">
                        {u.shopCount} toko
                        {u.subSellerCount > 0 && ` · ${u.subSellerCount} sub-seller`}
                        {u.subSubSellerCount > 0 && ` · ${u.subSubSellerCount} sub-sub-seller`}
                      </td>
                      <td className="px-4 py-2.5">{rupiah(u.walletBalance)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${s.cls}`}>{s.label}</span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-400 text-xs">{dateShort(u.createdAt)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => setExpandedId(expandedId === u.id ? null : u.id)}
                          className="text-xs text-brand font-semibold hover:underline"
                        >
                          {expandedId === u.id ? "Tutup" : "Kelola →"}
                        </button>
                      </td>
                    </tr>
                    {expandedId === u.id && (
                      <tr className="border-t border-white/5">
                        <td colSpan={7} className="px-4 py-4 bg-black/20">
                          <UserDetailPanel id={u.id} onChange={reload} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
        {data && data.total > PAGE_SIZE && (
          <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="text-xs px-3 py-1.5 rounded-md border border-white/10 text-slate-300 hover:bg-white/5 disabled:opacity-40"
            >
              ← Sebelumnya
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="text-xs px-3 py-1.5 rounded-md border border-white/10 text-slate-300 hover:bg-white/5 disabled:opacity-40"
            >
              Berikutnya →
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
}

function UserDetailPanel({ id, onChange }: { id: string; onChange: () => void }) {
  const { data: u, loading, reload } = useFetch<UserDetail>(`/admin/users/${id}`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [planType, setPlanType] = useState<PlanType>("freemium");
  const [planExpiredAt, setPlanExpiredAt] = useState("");
  const [editing, setEditing] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  function startEdit() {
    if (!u) return;
    setFullName(u.fullName ?? "");
    setPlanType(u.planType);
    setPlanExpiredAt(u.planExpiredAt ? u.planExpiredAt.slice(0, 10) : "");
    setEditing(true);
  }

  async function saveEdit() {
    setBusy(true); setErr(null);
    try {
      await api.patch(`/admin/users/${id}`, {
        fullName: fullName || undefined,
        planType,
        planExpiredAt: planExpiredAt ? planExpiredAt : null,
      });
      setEditing(false);
      reload(); onChange();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function toggleSuspend() {
    if (!u) return;
    setBusy(true); setErr(null);
    try {
      await api.post(`/admin/users/${id}/${u.isSuspended ? "unsuspend" : "suspend"}`);
      reload(); onChange();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function doDelete() {
    setBusy(true); setErr(null);
    try {
      await api.del(`/admin/users/${id}`);
      onChange();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  if (loading || !u) return <div className="text-slate-400 text-sm">Memuat detail…</div>;

  const expectedConfirm = u.email ?? u.whatsapp ?? u.id;

  return (
    <div className="space-y-4">
      {err && <div className="text-red-400 text-xs">{err}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[#0f172a] rounded-lg border border-white/10 p-3">
          <div className="text-[10px] uppercase text-slate-500 mb-2">Info Akun</div>
          {!editing ? (
            <>
              <div className="text-sm text-slate-200 font-semibold">{u.fullName || "(tanpa nama)"}</div>
              <div className="text-xs text-slate-400 mt-1">{u.email ?? "-"}</div>
              <div className="text-xs text-slate-400">{u.whatsapp ?? "-"}</div>
              <div className="text-xs text-slate-400 mt-1">
                Plan: <span className="text-slate-200 font-semibold">{PLAN_LABEL[u.planType]}</span>
                {u.planExpiredAt && ` (s/d ${dateShort(u.planExpiredAt)})`}
              </div>
              <button onClick={startEdit} className="text-xs text-brand font-semibold hover:underline mt-2">
                ✎ Edit nama / plan
              </button>
            </>
          ) : (
            <div className="space-y-2">
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nama lengkap"
                className="w-full px-2 py-1.5 rounded bg-[#1e293b] border border-white/10 text-xs text-slate-100" />
              <select value={planType} onChange={(e) => setPlanType(e.target.value as PlanType)}
                className="w-full px-2 py-1.5 rounded bg-[#1e293b] border border-white/10 text-xs text-slate-100">
                <option value="freemium">Freemium</option>
                <option value="starter">Starter</option>
                <option value="pro">Pro</option>
              </select>
              <label className="block text-[10px] text-slate-500">Plan berlaku s/d (opsional)</label>
              <input type="date" value={planExpiredAt} onChange={(e) => setPlanExpiredAt(e.target.value)}
                className="w-full px-2 py-1.5 rounded bg-[#1e293b] border border-white/10 text-xs text-slate-100" />
              <div className="flex gap-2">
                <button onClick={saveEdit} disabled={busy}
                  className="text-xs px-3 py-1.5 rounded bg-brand hover:bg-brand-dark text-white font-semibold disabled:opacity-50">
                  {busy ? "…" : "Simpan"}
                </button>
                <button onClick={() => setEditing(false)} className="text-xs px-3 py-1.5 rounded border border-white/10 text-slate-300">
                  Batal
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="bg-[#0f172a] rounded-lg border border-white/10 p-3">
          <div className="text-[10px] uppercase text-slate-500 mb-2">Akses</div>
          <div className="text-xs text-slate-400 mb-2">
            Status saat ini: <span className="font-semibold text-slate-200">{statusOf(u).label}</span>
          </div>
          <button
            onClick={toggleSuspend}
            disabled={busy}
            className={`text-xs px-3 py-1.5 rounded font-semibold disabled:opacity-50 ${
              u.isSuspended
                ? "bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30"
                : "bg-amber-600/20 text-amber-400 hover:bg-amber-600/30"
            }`}
          >
            {busy ? "…" : u.isSuspended ? "Aktifkan Kembali" : "Tangguhkan Akun"}
          </button>
          <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
            {u.isSuspended
              ? "Akun ditangguhkan — akses diblokir pada request berikutnya."
              : "Menangguhkan langsung memblokir akses akun ini, termasuk sesi yang sedang berjalan."}
          </p>
        </div>

        <div className="bg-[#0f172a] rounded-lg border border-red-900/40 p-3">
          <div className="text-[10px] uppercase text-red-400/80 mb-2">Zona Berbahaya</div>
          {!showDeleteConfirm ? (
            <button onClick={() => setShowDeleteConfirm(true)}
              className="text-xs px-3 py-1.5 rounded bg-red-600/20 text-red-400 hover:bg-red-600/30 font-semibold">
              Hapus Akun Permanen
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-[10px] text-red-300/80 leading-relaxed">
                Ini menghapus PERMANEN akun ini beserta seluruh riwayat order, invoice, toko, dan data pencairan terkait. Tidak bisa dibatalkan.
                Ketik <span className="font-mono font-bold">{expectedConfirm}</span> untuk konfirmasi.
              </p>
              <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
                className="w-full px-2 py-1.5 rounded bg-[#1e293b] border border-red-900/50 text-xs text-slate-100" />
              <div className="flex gap-2">
                <button
                  onClick={doDelete}
                  disabled={busy || confirmText !== expectedConfirm}
                  className="text-xs px-3 py-1.5 rounded bg-red-600 hover:bg-red-700 text-white font-semibold disabled:opacity-40"
                >
                  {busy ? "…" : "Hapus Permanen"}
                </button>
                <button onClick={() => { setShowDeleteConfirm(false); setConfirmText(""); }}
                  className="text-xs px-3 py-1.5 rounded border border-white/10 text-slate-300">
                  Batal
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-[#0f172a] rounded-lg border border-white/10 p-3">
        <div className="text-[10px] uppercase text-slate-500 mb-2">
          Hierarki Sub-seller ({u.hierarchy.length}) — dikelola oleh seller sendiri, tampilan di sini read-only
        </div>
        {!u.hierarchy.length ? (
          <div className="text-xs text-slate-500">Belum ada sub-seller.</div>
        ) : (
          <div className="space-y-2">
            {u.hierarchy.map((s) => (
              <div key={s.id} className="text-xs">
                <div className="flex items-center gap-2 text-slate-200">
                  <span className="font-semibold">{s.name}</span>
                  <span className="text-slate-500">{(Number(s.defaultRate) * 100).toFixed(1)}%</span>
                  {s.bankAccount && <span className="text-slate-500">· {s.bankAccount}</span>}
                  <span className={s.status === "active" ? "text-emerald-400" : "text-slate-500"}>
                    {s.status === "active" ? "aktif" : "nonaktif"}
                  </span>
                </div>
                {s.subSubSellers.map((ss) => (
                  <div key={ss.id} className="ml-4 mt-0.5 text-slate-400">
                    ↳ {ss.name} · {(Number(ss.defaultRate) * 100).toFixed(1)}%
                    {ss.bankAccount && ` · ${ss.bankAccount}`}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
