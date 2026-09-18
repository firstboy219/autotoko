import { useEffect, useMemo, useState } from "react";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";
import {
  Card, Badge, Button, Select, Input, InlineAlert, Skeleton, Modal, ConfirmModal, useToast,
} from "../components/ui";

interface Activity {
  id?: string; activity_id?: string; title?: string; activity_type?: string;
  status?: string; begin_time?: number; end_time?: number; product_level?: string; duration_type?: string;
}
interface ShopActivities { shopId: string; shopName: string; activities: Activity[]; error?: string }
interface Coupon { id?: string; coupon_id?: string; title?: string; status?: string; display_type?: string; promo_code?: string }
interface ShopCoupons { shopId: string; shopName: string; coupons: Coupon[]; error?: string }
interface PromoSetting { shopId: string; autoJoin: boolean; activityId: string | null; discountPct: string }

type Row = Activity & { shopId: string; shopName: string };

const ACT_TYPES = ["FLASHSALE", "DIRECT_DISCOUNT", "FIXED_PRICE"];
const actId = (a: Activity) => a.id ?? a.activity_id ?? "";
const actTitle = (a: Activity) => a.title || actId(a) || "(tanpa judul)";
const actType = (a: Activity) => a.activity_type ?? "-";
const fmt = (t?: number) => (t ? new Date(t * 1000).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "-");
const toUnix = (s: string) => (s ? Math.floor(new Date(s).getTime() / 1000) : 0);
const statusTone = (s?: string): "success" | "warning" | "neutral" | "danger" => {
  const u = (s ?? "").toUpperCase();
  if (u === "ONGOING" || u === "ACTIVE") return "success";
  if (u === "NOT_START" || u === "UPCOMING" || u === "DRAFT") return "warning";
  if (u === "EXPIRED" || u === "DEACTIVATED" || u === "DELETED") return "neutral";
  return "neutral";
};

export function Promotion() {
  const toast = useToast();
  const acts = useFetch<ShopActivities[]>("/promotion/activities");
  const coups = useFetch<ShopCoupons[]>("/promotion/coupons");
  const [fShop, setFShop] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fType, setFType] = useState("");
  const [q, setQ] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showAuto, setShowAuto] = useState(false);
  const [manage, setManage] = useState<{ shopId: string; activityId: string; title: string } | null>(null);
  const [confirmDeact, setConfirmDeact] = useState<Row | null>(null);
  const [manageC, setManageC] = useState<{ shopId: string; couponId: string; title: string } | null>(null);
  const [editAct, setEditAct] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);

  const shops = acts.data ?? [];
  const rows: Row[] = useMemo(
    () => shops.flatMap((s) => (s.activities ?? []).map((a) => ({ ...a, shopId: s.shopId, shopName: s.shopName }))),
    [shops],
  );
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (fShop && r.shopId !== fShop) return false;
      if (fStatus && (r.status ?? "").toUpperCase() !== fStatus) return false;
      if (fType && actType(r) !== fType) return false;
      if (term && !`${actTitle(r)} ${actId(r)}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [rows, fShop, fStatus, fType, q]);

  const couponRows = useMemo(
    () => (coups.data ?? []).flatMap((s) => (s.coupons ?? []).map((c) => ({ ...c, shopId: s.shopId, shopName: s.shopName }))),
    [coups.data],
  );
  const statuses = useMemo(() => [...new Set(rows.map((r) => (r.status ?? "").toUpperCase()).filter(Boolean))], [rows]);
  const ongoing = rows.filter((r) => statusTone(r.status) === "success").length;
  const shopErrors = shops.filter((s) => s.error);

  async function deactivate() {
    if (!confirmDeact) return;
    setBusy(true);
    try {
      await api.post(`/promotion/activities/${confirmDeact.shopId}/${actId(confirmDeact)}/deactivate`);
      toast("Promo dinonaktifkan", "success");
      setConfirmDeact(null);
      acts.reload();
    } catch (e) { toast((e as Error).message, "danger"); } finally { setBusy(false); }
  }

  const Tile = ({ label, value, tone }: { label: string; value: number | string; tone?: string }) => (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-3">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${tone ?? "text-ink"}`}>{value}</div>
    </div>
  );

  return (
    <Layout title="Promosi">
      <InlineAlert tone="info">
        Kelola semua promo TikTok dari satu halaman: <b>activity</b> (flash sale / diskon) &amp; <b>coupon</b> lintas toko.
        Catatan: API TikTok hanya untuk promo <b>buatan seller</b> — tak ada endpoint ikut campaign resmi platform.
        Aksi yang mengubah harga (buat, tambah produk, nonaktifkan, auto-ikut) memicu perubahan nyata di TikTok.
      </InlineAlert>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Total activity" value={rows.length} />
        <Tile label="Sedang berjalan" value={ongoing} tone="text-emerald-600" />
        <Tile label="Coupon" value={couponRows.length} />
        <Tile label="Toko TikTok" value={shops.length} />
      </div>

      <Card className="mt-4 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-[11px] text-ink-3 mb-1">Cari judul promo</label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ketik judul / id…" />
          </div>
          <div>
            <label className="block text-[11px] text-ink-3 mb-1">Toko</label>
            <Select value={fShop} onChange={(e) => setFShop(e.target.value)}>
              <option value="">Semua toko</option>
              {shops.map((s) => <option key={s.shopId} value={s.shopId}>{s.shopName}</option>)}
            </Select>
          </div>
          <div>
            <label className="block text-[11px] text-ink-3 mb-1">Status</label>
            <Select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
              <option value="">Semua</option>
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
          <div>
            <label className="block text-[11px] text-ink-3 mb-1">Tipe</label>
            <Select value={fType} onChange={(e) => setFType(e.target.value)}>
              <option value="">Semua</option>
              {ACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </div>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" icon="refresh" loading={acts.loading} onClick={() => { acts.reload(); coups.reload(); }}>Refresh</Button>
            <Button size="sm" variant="tonal" icon="settings" onClick={() => setShowAuto(true)}>Auto-ikut</Button>
            <Button size="sm" variant="filled" icon="plus" onClick={() => setShowCreate(true)}>Buat Promo</Button>
          </div>
        </div>
      </Card>

      {shopErrors.length > 0 && (
        <div className="mt-3">
          <InlineAlert tone="warning">
            {shopErrors.length} toko belum bisa memuat promo (scope Promotion mungkin belum aktif): {shopErrors.map((s) => s.shopName).join(", ")}.
          </InlineAlert>
        </div>
      )}

      <Card className="mt-3 p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-ink/[0.03] text-left text-[11px] uppercase text-ink-3">
                <th className="px-3 py-2">Toko</th>
                <th className="px-3 py-2">Judul</th>
                <th className="px-3 py-2">Tipe</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Periode</th>
                <th className="px-3 py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {acts.loading ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-ink-3">Memuat…</td></tr>
              ) : !filtered.length ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-ink-3">Tidak ada activity yang cocok.</td></tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.shopId + actId(r)} className="border-t border-line">
                    <td className="px-3 py-2"><Badge tone="neutral">{r.shopName}</Badge></td>
                    <td className="px-3 py-2 font-medium text-ink">{actTitle(r)}</td>
                    <td className="px-3 py-2 text-ink-2">{actType(r)}</td>
                    <td className="px-3 py-2"><Badge tone={statusTone(r.status)}>{r.status ?? "-"}</Badge></td>
                    <td className="px-3 py-2 whitespace-nowrap text-ink-2">{fmt(r.begin_time)} – {fmt(r.end_time)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setManage({ shopId: r.shopId, activityId: actId(r), title: actTitle(r) })} className="text-brand hover:underline">Produk</button>
                        <button onClick={() => setEditAct(r)} className="text-ink-2 hover:underline">Edit</button>
                        <button onClick={() => setConfirmDeact(r)} className="text-red-600 hover:underline">Nonaktifkan</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {couponRows.length > 0 && (
        <Card className="mt-4 p-0 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-line text-sm font-semibold text-ink">Coupon ({couponRows.length})</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-ink/[0.03] text-left text-[11px] uppercase text-ink-3">
                  <th className="px-3 py-2">Toko</th><th className="px-3 py-2">Judul</th><th className="px-3 py-2">Kode</th>
                  <th className="px-3 py-2">Tipe</th><th className="px-3 py-2">Status</th><th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {couponRows.map((c, i) => (
                  <tr key={(c.id ?? c.coupon_id ?? "") + i} className="border-t border-line">
                    <td className="px-3 py-2"><Badge tone="neutral">{c.shopName}</Badge></td>
                    <td className="px-3 py-2 text-ink">{c.title ?? "-"}</td>
                    <td className="px-3 py-2 font-mono text-xs text-ink-2">{c.promo_code ?? "-"}</td>
                    <td className="px-3 py-2 text-ink-2">{c.display_type ?? "-"}</td>
                    <td className="px-3 py-2"><Badge tone={statusTone(c.status)}>{c.status ?? "-"}</Badge></td>
                    <td className="px-3 py-2 text-right"><button onClick={() => setManageC({ shopId: c.shopId, couponId: c.id ?? c.coupon_id ?? "", title: c.title ?? "-" })} className="text-brand hover:underline">Detail</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {showCreate && <CreateActivityModal shops={shops} onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); acts.reload(); }} />}
      {showAuto && <AutoJoinModal shops={shops} onClose={() => setShowAuto(false)} />}
      {manage && <ManageProductsModal ctx={manage} onClose={() => setManage(null)} />}
      {manageC && <CouponDetailModal ctx={manageC} onClose={() => setManageC(null)} />}
      {editAct && <EditActivityModal row={editAct} onClose={() => setEditAct(null)} onDone={() => { setEditAct(null); acts.reload(); }} />}

      <ConfirmModal
        open={confirmDeact != null}
        onClose={() => setConfirmDeact(null)}
        onConfirm={deactivate}
        loading={busy}
        title="Nonaktifkan promo?"
        confirmLabel="Nonaktifkan"
        description={confirmDeact ? `Promo "${actTitle(confirmDeact)}" (${confirmDeact.shopName}) akan dinonaktifkan di TikTok — harga kembali normal.` : ""}
      />
    </Layout>
  );
}

function CreateActivityModal({ shops, onClose, onDone }: { shops: ShopActivities[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [shopId, setShopId] = useState(shops[0]?.shopId ?? "");
  const [type, setType] = useState(ACT_TYPES[0]);
  const [title, setTitle] = useState("");
  const [durationType, setDurationType] = useState("NORMAL");
  const [begin, setBegin] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    if (!shopId || !title.trim()) { setErr("Toko & judul wajib diisi"); return; }
    if (durationType === "NORMAL" && (!begin || !end)) { setErr("Isi waktu mulai & selesai"); return; }
    setBusy(true);
    try {
      await api.post(`/promotion/activities/${shopId}`, {
        activityType: type, title: title.trim(), durationType, productLevel: "PRODUCT",
        ...(durationType === "NORMAL" ? { beginTime: toUnix(begin), endTime: toUnix(end) } : {}),
      });
      toast("Promo dibuat — tambahkan produk lewat tombol Produk.", "success");
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title="Buat Promo Baru" width="max-w-lg">
      <div className="space-y-3">
        {err && <InlineAlert tone="danger">{err}</InlineAlert>}
        <div>
          <label className="block text-xs text-ink-2 mb-1">Toko</label>
          <Select value={shopId} onChange={(e) => setShopId(e.target.value)}>
            {shops.map((s) => <option key={s.shopId} value={s.shopId}>{s.shopName}</option>)}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-ink-2 mb-1">Tipe</label>
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {ACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </div>
          <div>
            <label className="block text-xs text-ink-2 mb-1">Durasi</label>
            <Select value={durationType} onChange={(e) => setDurationType(e.target.value)}>
              <option value="NORMAL">Ada tanggal</option>
              <option value="INDEFINITE">Tanpa batas</option>
            </Select>
          </div>
        </div>
        <div>
          <label className="block text-xs text-ink-2 mb-1">Judul (maks 50)</label>
          <Input value={title} maxLength={50} onChange={(e) => setTitle(e.target.value)} placeholder="mis. Flash Sale Gajian" />
        </div>
        {durationType === "NORMAL" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-ink-2 mb-1">Mulai</label>
              <Input type="datetime-local" value={begin} onChange={(e) => setBegin(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-ink-2 mb-1">Selesai</label>
              <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
        )}
        <p className="text-[11px] text-ink-3">Setelah dibuat, buka <b>Produk</b> pada baris promo untuk menambahkan produk + diskonnya.</p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="text" onClick={onClose} disabled={busy}>Batal</Button>
          <Button variant="filled" loading={busy} onClick={submit}>Buat</Button>
        </div>
      </div>
    </Modal>
  );
}

interface DetailProduct { id?: string; discount?: string; activity_price?: { amount?: string }; quantity_limit?: number; quantity_per_user?: number }
function ManageProductsModal({ ctx, onClose }: { ctx: { shopId: string; activityId: string; title: string }; onClose: () => void }) {
  const toast = useToast();
  const [detail, setDetail] = useState<{ products?: DetailProduct[]; status?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [pid, setPid] = useState("");
  const [disc, setDisc] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setErr(null);
    try { setDetail(await api.get(`/promotion/activities/${ctx.shopId}/${ctx.activityId}`)); }
    catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  async function add() {
    if (!pid.trim() || !disc.trim()) { setErr("Isi Product ID & diskon %"); return; }
    setBusy(true); setErr(null);
    try {
      await api.put(`/promotion/activities/${ctx.shopId}/${ctx.activityId}/products`, {
        products: [{ id: pid.trim(), discount: String(Number(disc) || 0) }],
      });
      toast("Produk ditambahkan ke promo", "success");
      setPid(""); setDisc(""); await load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function remove(id: string) {
    setBusy(true); setErr(null);
    try {
      await api.post(`/promotion/activities/${ctx.shopId}/${ctx.activityId}/products/remove`, { productIds: [id] });
      toast("Produk dihapus dari promo", "success"); await load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const products = detail?.products ?? [];
  return (
    <Modal open onClose={onClose} title={`Produk Promo — ${ctx.title}`} width="max-w-2xl">
      <div className="space-y-3">
        {err && <InlineAlert tone="danger">{err}</InlineAlert>}
        <div className="rounded-lg border border-line p-3">
          <div className="text-xs font-semibold text-ink-2 mb-2">Tambah produk</div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-[11px] text-ink-3 mb-1">TikTok Product ID</label>
              <Input value={pid} onChange={(e) => setPid(e.target.value)} placeholder="mis. 17298..." />
            </div>
            <div>
              <label className="block text-[11px] text-ink-3 mb-1">Diskon %</label>
              <Input value={disc} onChange={(e) => setDisc(e.target.value.replace(/[^0-9.]/g, ""))} className="w-24 tabular-nums" />
            </div>
            <Button size="sm" variant="filled" loading={busy} onClick={add}>Tambah</Button>
          </div>
        </div>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : !products.length ? (
          <div className="text-sm text-ink-3">Belum ada produk di promo ini.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-ink-3">
                  <th className="py-1 pr-2">Product ID</th><th className="py-1 pr-2">Diskon</th>
                  <th className="py-1 pr-2">Harga deal</th><th className="py-1 pr-2">Limit</th><th className="py-1"></th>
                </tr>
              </thead>
              <tbody>
                {products.map((p, i) => (
                  <tr key={(p.id ?? "") + i} className="border-t border-line">
                    <td className="py-1 pr-2 font-mono">{p.id}</td>
                    <td className="py-1 pr-2">{p.discount ? `${p.discount}%` : "-"}</td>
                    <td className="py-1 pr-2">{p.activity_price?.amount ?? "-"}</td>
                    <td className="py-1 pr-2">{p.quantity_limit ?? "-"}</td>
                    <td className="py-1 text-right"><button disabled={busy} onClick={() => p.id && remove(p.id)} className="text-red-600 hover:underline disabled:opacity-50">Hapus</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-end pt-1"><Button variant="text" onClick={onClose}>Tutup</Button></div>
      </div>
    </Modal>
  );
}

function AutoJoinModal({ shops, onClose }: { shops: ShopActivities[]; onClose: () => void }) {
  const toast = useToast();
  const sett = useFetch<PromoSetting[]>("/promotion/settings");
  const [edit, setEdit] = useState<Record<string, { autoJoin: boolean; activityId: string; discountPct: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!sett.data) return;
    const m: Record<string, { autoJoin: boolean; activityId: string; discountPct: string }> = {};
    for (const s of sett.data) m[s.shopId] = { autoJoin: s.autoJoin, activityId: s.activityId ?? "", discountPct: String(s.discountPct ?? "10") };
    setEdit((p) => ({ ...m, ...p }));
  }, [sett.data]);

  const ed = (id: string) => edit[id] ?? { autoJoin: false, activityId: "", discountPct: "10" };
  const setEd = (id: string, patch: Partial<{ autoJoin: boolean; activityId: string; discountPct: string }>) =>
    setEdit((p) => ({ ...p, [id]: { ...ed(id), ...patch } }));

  async function save(shopId: string) {
    setBusy(shopId + ":s");
    try {
      const e = ed(shopId);
      await api.put(`/promotion/settings/${shopId}`, { autoJoin: e.autoJoin, activityId: e.activityId || null, discountPct: Number(e.discountPct) || 0 });
      toast("Tersimpan", "success");
    } catch (e) { toast((e as Error).message, "danger"); } finally { setBusy(null); }
  }
  async function apply(shopId: string) {
    setBusy(shopId + ":a");
    try { const r = await api.post<{ added: number }>(`/promotion/settings/${shopId}/apply`); toast(`${r.added} produk didaftarkan ke promo`, "success"); }
    catch (e) { toast((e as Error).message, "danger"); } finally { setBusy(null); }
  }

  return (
    <Modal open onClose={onClose} title="Auto-ikut promo per toko" width="max-w-2xl">
      <div className="space-y-3">
        <InlineAlert tone="info">
          Auto-ikut mendaftarkan produk aktif toko ke <b>activity target</b> milikmu dengan diskon tertentu. Pilih activity,
          set diskon, lalu <b>Terapkan</b> untuk mendaftarkan produk sekarang (aksi nyata mengubah harga).
        </InlineAlert>
        {shops.map((s) => {
          const e = ed(s.shopId);
          return (
            <div key={s.shopId} className="rounded-lg border border-line p-3">
              <div className="text-sm font-medium text-ink mb-2">{s.shopName}</div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex items-center gap-1.5 pb-2 text-sm text-ink-2">
                  <input type="checkbox" checked={e.autoJoin} onChange={(ev) => setEd(s.shopId, { autoJoin: ev.target.checked })} /> Aktif
                </label>
                <div>
                  <label className="block text-[11px] text-ink-3 mb-1">Activity target</label>
                  <Select value={e.activityId} onChange={(ev) => setEd(s.shopId, { activityId: ev.target.value })}>
                    <option value="">— pilih —</option>
                    {(s.activities ?? []).map((a) => <option key={actId(a)} value={actId(a)}>{actTitle(a)}</option>)}
                  </Select>
                </div>
                <div>
                  <label className="block text-[11px] text-ink-3 mb-1">Diskon %</label>
                  <Input value={e.discountPct} onChange={(ev) => setEd(s.shopId, { discountPct: ev.target.value.replace(/[^0-9.]/g, "") })} className="w-20 tabular-nums" />
                </div>
                <Button size="sm" variant="filled" loading={busy === s.shopId + ":s"} onClick={() => save(s.shopId)}>Simpan</Button>
                <Button size="sm" variant="tonal" loading={busy === s.shopId + ":a"} disabled={!e.activityId} onClick={() => apply(s.shopId)}>Terapkan sekarang</Button>
              </div>
            </div>
          );
        })}
        <div className="flex justify-end"><Button variant="text" onClick={onClose}>Tutup</Button></div>
      </div>
    </Modal>
  );
}

function CouponDetailModal({ ctx, onClose }: { ctx: { shopId: string; couponId: string; title: string }; onClose: () => void }) {
  const [d, setD] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.get<Record<string, unknown>>(`/promotion/coupons/${ctx.shopId}/${ctx.couponId}`)
      .then(setD).catch((e) => setErr((e as Error).message)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const row = (k: string, v: unknown) =>
    v == null ? null : (
      <div className="flex justify-between gap-4 py-1">
        <dt className="text-ink-3">{k}</dt>
        <dd className="text-right text-ink break-all">{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
      </div>
    );
  return (
    <Modal open onClose={onClose} title={`Coupon — ${ctx.title}`} width="max-w-lg">
      {err && <InlineAlert tone="danger">{err}</InlineAlert>}
      {loading ? (
        <Skeleton className="h-32 w-full" />
      ) : d ? (
        <dl className="divide-y divide-line text-sm">
          {row("ID", d.id ?? d.coupon_id)}
          {row("Judul", d.title)}
          {row("Status", d.status)}
          {row("Tipe tampilan", d.display_type)}
          {row("Kode promo", d.promo_code)}
          {row("Diskon", d.discount)}
          {row("Threshold", d.threshold)}
          {row("Cakupan produk", d.product_scope)}
          {row("Batas pakai", d.usage_limits)}
        </dl>
      ) : (
        <div className="text-sm text-ink-3">Tidak ada data.</div>
      )}
      <div className="flex justify-end pt-2"><Button variant="text" onClick={onClose}>Tutup</Button></div>
    </Modal>
  );
}

function EditActivityModal({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(actTitle(row));
  const [begin, setBegin] = useState(row.begin_time ? new Date(row.begin_time * 1000).toISOString().slice(0, 16) : "");
  const [end, setEnd] = useState(row.end_time ? new Date(row.end_time * 1000).toISOString().slice(0, 16) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setBusy(true); setErr(null);
    try {
      await api.put(`/promotion/activities/${row.shopId}/${actId(row)}`, {
        title: title.trim() || undefined,
        ...(begin ? { beginTime: toUnix(begin) } : {}),
        ...(end ? { endTime: toUnix(end) } : {}),
      });
      toast("Promo diperbarui", "success");
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={`Edit Promo — ${actTitle(row)}`} width="max-w-md">
      <div className="space-y-3">
        {err && <InlineAlert tone="danger">{err}</InlineAlert>}
        <div>
          <label className="block text-xs text-ink-2 mb-1">Judul</label>
          <Input value={title} maxLength={50} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-ink-2 mb-1">Mulai</label>
            <Input type="datetime-local" value={begin} onChange={(e) => setBegin(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-ink-2 mb-1">Selesai</label>
            <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <p className="text-[11px] text-ink-3">Perubahan waktu umumnya hanya diterima TikTok sebelum promo berjalan.</p>
        <div className="flex justify-end gap-2">
          <Button variant="text" onClick={onClose} disabled={busy}>Batal</Button>
          <Button variant="filled" loading={busy} onClick={save}>Simpan</Button>
        </div>
      </div>
    </Modal>
  );
}
