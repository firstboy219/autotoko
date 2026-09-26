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
  const [couponCount, setCouponCount] = useState(0);
  const [fShop, setFShop] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fType, setFType] = useState("");
  const [q, setQ] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showAuto, setShowAuto] = useState(false);
  const [showAutomation, setShowAutomation] = useState(false);
  const [manage, setManage] = useState<{ shopId: string; activityId: string; title: string } | null>(null);
  const [confirmDeact, setConfirmDeact] = useState<Row | null>(null);
  const [manageC, setManageC] = useState<{ shopId: string; couponId: string; title: string } | null>(null);
  const [editAct, setEditAct] = useState<Row | null>(null);
  const [replicate, setReplicate] = useState<Row | null>(null);
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
        <Tile label="Voucher" value={couponCount} />
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
            <Button size="sm" variant="outline" icon="refresh" loading={acts.loading} onClick={() => acts.reload()}>Refresh</Button>
            <Button size="sm" variant="tonal" icon="settings" onClick={() => setShowAuto(true)}>Auto-ikut</Button>
            <Button size="sm" variant="tonal" onClick={() => setShowAutomation(true)}>Otomasi</Button>
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
                        <button onClick={() => setReplicate(r)} className="text-emerald-600 hover:underline">Replikasi</button>
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

      <CouponSection onCount={setCouponCount} onDetail={setManageC} />


      {showCreate && <CreateActivityModal shops={shops} onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); acts.reload(); }} />}
      {showAuto && <AutoJoinModal shops={shops} onClose={() => setShowAuto(false)} />}
      {showAutomation && <AutomationModal onClose={() => setShowAutomation(false)} />}
      {manage && <ManageProductsModal ctx={manage} onClose={() => setManage(null)} />}
      {manageC && <CouponDetailModal ctx={manageC} onClose={() => setManageC(null)} />}
      {editAct && <EditActivityModal row={editAct} onClose={() => setEditAct(null)} onDone={() => { setEditAct(null); acts.reload(); }} />}
      {replicate && <ReplicateModal row={replicate} shops={shops} onClose={() => setReplicate(null)} onDone={() => acts.reload()} />}

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

/* ------------------------------------------------ Voucher (kupon) + otomasi */

interface CouponCard {
  id: string; couponId: string; shopId: string | null; shopName: string;
  title: string | null; status: string | null; diskon: string; minSpend: number | null;
  productScope: string | null; targetBuyerSegment: string | null;
  claimStart: string | null; claimEnd: string | null;
  redemptionLimit: number | null; claimed: number; redeemed: number;
  sinyal: string[]; konversi: number | null; pakaiRasio: number;
}
interface CouponSettings {
  autoSync: boolean; alertExpiry: boolean; expiryDays: number; alertLimit: boolean; limitPct: number;
  alertZeroClaim: boolean; zeroClaimDays: number; tersimpan: boolean;
}
interface CouponRingkasan { total: number; aktif: number; klaim: number; redeem: number }

const SINYAL_LABEL: Record<string, { t: string; tone: "danger" | "warning" | "success" | "neutral" }> = {
  segera_berakhir: { t: "segera berakhir", tone: "warning" },
  klaim_habis: { t: "kuota habis", tone: "danger" },
  klaim_hampir_habis: { t: "kuota menipis", tone: "warning" },
  nol_klaim: { t: "0 klaim", tone: "neutral" },
  berkinerja: { t: "berkinerja", tone: "success" },
};
const fmtRp = (n: number | null) => (n == null ? "-" : "Rp " + Math.round(n).toLocaleString("id-ID"));
const fmtTgl = (s: string | null) => (s ? new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short" }) : "-");

function CouponSection({ onCount, onDetail }: { onCount: (n: number) => void; onDetail: (c: { shopId: string; couponId: string; title: string }) => void }) {
  const toast = useToast();
  const [cards, setCards] = useState<CouponCard[] | null>(null);
  const [rekap, setRekap] = useState<CouponRingkasan | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [fStatus, setFStatus] = useState("");
  const [onlySignal, setOnlySignal] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [setelan, setSetelan] = useState(false);

  function muat() {
    api.get<{ cards: CouponCard[]; syncedAt: string | null }>("/promotion/coupons/cards")
      .then((r) => { setCards(r.cards); setSyncedAt(r.syncedAt); onCount(r.cards.length); })
      .catch(() => setCards([]));
    api.get<CouponRingkasan>("/promotion/coupons/ringkasan").then(setRekap).catch(() => setRekap(null));
  }
  useEffect(() => { muat(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function sinkron() {
    setSyncing(true);
    try {
      const r = await api.post<{ sinkron: { total: number; galat: string[] }; notif: number; berakhir: number; klaimHabis: number; klaimHampirHabis: number; nolKlaim: number }>("/promotion/coupons/sync", {});
      const g = r.sinkron?.galat ?? [];
      if (g.length && r.sinkron.total === 0) toast(`Belum tersinkron: ${g[0]}`, "warning");
      else toast(`${r.sinkron.total} voucher tersinkron · ${r.berakhir} segera berakhir · ${r.klaimHampirHabis + r.klaimHabis} kuota menipis/habis · ${r.nolKlaim} nol klaim · ${r.notif} notifikasi`, "success");
      muat();
    } catch (e) { toast((e as Error).message, "danger"); } finally { setSyncing(false); }
  }

  const list = (cards ?? []).filter((c) => {
    if (fStatus && (c.status ?? "").toUpperCase() !== fStatus) return false;
    if (onlySignal && c.sinyal.filter((s) => s !== "berkinerja").length === 0) return false;
    return true;
  });
  const perluPerhatian = (cards ?? []).filter((c) => c.sinyal.some((s) => s !== "berkinerja")).length;

  return (
    <Card className="mt-4 p-0 overflow-hidden">
      <div className="px-3 py-2.5 border-b border-line flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">Voucher</span>
        {rekap && (
          <span className="text-xs text-ink-3">
            {rekap.total} total · {rekap.aktif} aktif · {rekap.klaim.toLocaleString("id-ID")} klaim · {rekap.redeem.toLocaleString("id-ID")} dipakai
            {perluPerhatian > 0 && <> · <span className="text-amber-600 font-medium">{perluPerhatian} perlu perhatian</span></>}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="rounded-lg border border-line px-2 py-1 text-xs bg-surface">
            <option value="">Semua status</option>
            <option value="ONGOING">Berjalan</option>
            <option value="NOT_START">Akan datang</option>
            <option value="EXPIRED">Berakhir</option>
            <option value="DEACTIVATED">Nonaktif</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-ink-2"><input type="checkbox" checked={onlySignal} onChange={(e) => setOnlySignal(e.target.checked)} /> perlu perhatian</label>
          <Button size="sm" variant="outline" icon="settings" onClick={() => setSetelan(true)}>Otomasi voucher</Button>
          <Button size="sm" variant="tonal" icon="refresh" loading={syncing} onClick={sinkron}>Sinkron</Button>
        </div>
      </div>

      <InlineAlert tone="info">
        API TikTok untuk voucher hanya baca — voucher dibuat di Seller Center. AutoToko memantau otomatis: sinkron berkala,
        lalu memberi tahu bila voucher <b>segera berakhir</b>, <b>kuotanya menipis/habis</b>, atau <b>belum diklaim siapa pun</b>.
      </InlineAlert>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-ink/[0.03] text-left text-[11px] uppercase text-ink-3">
              <th className="px-3 py-2">Toko</th><th className="px-3 py-2">Voucher</th><th className="px-3 py-2">Diskon</th>
              <th className="px-3 py-2">Min. belanja</th><th className="px-3 py-2">Klaim / kuota</th><th className="px-3 py-2">Dipakai</th>
              <th className="px-3 py-2">Berlaku s/d</th><th className="px-3 py-2">Sinyal</th><th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {cards === null ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-ink-3">Memuat…</td></tr>
            ) : !list.length ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-ink-3">{cards.length ? "Tidak ada voucher yang cocok filter." : "Belum ada voucher tersinkron — klik Sinkron."}</td></tr>
            ) : (
              list.map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="px-3 py-2"><Badge tone="neutral">{c.shopName}</Badge></td>
                  <td className="px-3 py-2 text-ink max-w-[220px] truncate" title={c.title ?? ""}>{c.title ?? "-"}</td>
                  <td className="px-3 py-2 font-medium text-ink whitespace-nowrap">{c.diskon}</td>
                  <td className="px-3 py-2 text-ink-2 whitespace-nowrap">{c.minSpend ? fmtRp(c.minSpend) : "—"}</td>
                  <td className="px-3 py-2 text-ink-2 tabular-nums whitespace-nowrap">{c.claimed}{c.redemptionLimit ? ` / ${c.redemptionLimit}` : ""}{c.redemptionLimit ? ` (${c.pakaiRasio}%)` : ""}</td>
                  <td className="px-3 py-2 text-ink-2 tabular-nums">{c.redeemed}{c.konversi != null ? ` · ${c.konversi}%` : ""}</td>
                  <td className="px-3 py-2 text-ink-2 whitespace-nowrap">{fmtTgl(c.claimEnd)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {c.sinyal.length === 0 ? <span className="text-ink-3 text-xs">—</span> :
                        c.sinyal.map((s) => <Badge key={s} tone={SINYAL_LABEL[s]?.tone ?? "neutral"}>{SINYAL_LABEL[s]?.t ?? s}</Badge>)}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {c.shopId && <button onClick={() => onDetail({ shopId: c.shopId!, couponId: c.couponId, title: c.title ?? "-" })} className="text-brand hover:underline">Detail</button>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {syncedAt && <div className="px-3 py-1.5 text-[11px] text-ink-3 border-t border-line">Tersinkron: {new Date(syncedAt).toLocaleString("id-ID")}</div>}
      {setelan && <CouponAutomationModal onClose={() => setSetelan(false)} onSaved={muat} />}
    </Card>
  );
}

function CouponAutomationModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [s, setS] = useState<CouponSettings | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get<CouponSettings>("/promotion/coupons/settings").then(setS).catch(() => setS(null)); }, []);

  async function save() {
    if (!s) return;
    setBusy(true);
    try { await api.put("/promotion/coupons/settings", s); toast("Pengaturan otomasi voucher tersimpan.", "success"); onSaved(); onClose(); }
    catch (e) { toast((e as Error).message, "danger"); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title="Otomasi Voucher">
      {!s ? <Skeleton className="h-40 w-full" /> : (
        <div className="space-y-3 text-sm">
          <p className="text-ink-3 text-xs">Pantauan read-only — tidak mengubah apa pun di TikTok, hanya memberi tahu Anda. Notifikasi muncul di lonceng APK &amp; menu Notifikasi web.</p>
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.autoSync} onChange={(e) => setS({ ...s, autoSync: e.target.checked })} /> <span>Sinkron voucher otomatis tiap 6 jam</span></label>
          <hr className="border-line" />
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.alertExpiry} onChange={(e) => setS({ ...s, alertExpiry: e.target.checked })} /> <span>Ingatkan voucher segera berakhir</span></label>
          <div className="flex items-center gap-2 pl-6 text-xs text-ink-2">ambang <Input type="number" value={String(s.expiryDays)} onChange={(e) => setS({ ...s, expiryDays: Number(e.target.value) || 3 })} className="w-16 tabular-nums" /> hari sebelum berakhir</div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.alertLimit} onChange={(e) => setS({ ...s, alertLimit: e.target.checked })} /> <span>Ingatkan kuota klaim menipis/habis</span></label>
          <div className="flex items-center gap-2 pl-6 text-xs text-ink-2">saat klaim ≥ <Input type="number" value={String(s.limitPct)} onChange={(e) => setS({ ...s, limitPct: Number(e.target.value) || 80 })} className="w-16 tabular-nums" /> % dari kuota</div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.alertZeroClaim} onChange={(e) => setS({ ...s, alertZeroClaim: e.target.checked })} /> <span>Ingatkan voucher tanpa klaim</span></label>
          <div className="flex items-center gap-2 pl-6 text-xs text-ink-2">berjalan &gt; <Input type="number" value={String(s.zeroClaimDays)} onChange={(e) => setS({ ...s, zeroClaimDays: Number(e.target.value) || 3 })} className="w-16 tabular-nums" /> hari tapi 0 klaim</div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Batal</Button>
            <Button variant="filled" loading={busy} onClick={save}>Simpan</Button>
          </div>
        </div>
      )}
    </Modal>
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

interface RepResult { shopId: string; shopName?: string; activityId?: string; added?: number; error?: string }
function ReplicateModal({ row, shops, onClose, onDone }: { row: Row; shops: ShopActivities[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const targets = shops.filter((s) => s.shopId !== row.shopId);
  const [sel, setSel] = useState<string[]>([]);
  const [disc, setDisc] = useState("10");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<RepResult[] | null>(null);
  const toggle = (id: string) => setSel((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function run() {
    if (!sel.length) { setErr("Pilih minimal satu toko target"); return; }
    setBusy(true); setErr(null); setResults(null);
    try {
      const r = await api.post<{ results: RepResult[] }>(
        `/promotion/activities/${row.shopId}/${actId(row)}/replicate`,
        { targetShopIds: sel, discountPct: Number(disc) || 0 },
      );
      setResults(r.results);
      const okN = r.results.filter((x) => !x.error).length;
      toast(`Replikasi selesai: ${okN}/${r.results.length} toko`, okN ? "success" : "warning");
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={`Replikasi Promo — ${actTitle(row)}`} width="max-w-lg">
      <div className="space-y-3">
        <InlineAlert tone="info">
          Menggulirkan promo yang sukses ke toko lain: dibuat activity baru dgn tipe/judul/durasi yang sama, lalu produk
          aktif tiap toko target didaftarkan dgn diskon di bawah. Aksi nyata — mengubah harga di toko target. Waktu digeser
          ke masa depan otomatis bila jadwal promo asal sudah lewat.
        </InlineAlert>
        {err && <InlineAlert tone="danger">{err}</InlineAlert>}
        <div>
          <label className="block text-xs text-ink-2 mb-1">Diskon % di toko target</label>
          <Input value={disc} onChange={(e) => setDisc(e.target.value.replace(/[^0-9.]/g, ""))} className="w-24 tabular-nums" />
        </div>
        <div>
          <div className="text-xs text-ink-2 mb-1">Toko target</div>
          {!targets.length ? (
            <div className="text-xs text-ink-3">Tak ada toko lain.</div>
          ) : (
            <div className="max-h-48 space-y-1 overflow-y-auto rounded border border-line p-2">
              {targets.map((t) => (
                <label key={t.shopId} className="flex items-center gap-2 text-sm text-ink-2">
                  <input type="checkbox" checked={sel.includes(t.shopId)} onChange={() => toggle(t.shopId)} /> {t.shopName}
                </label>
              ))}
            </div>
          )}
        </div>
        {results && (
          <div className="space-y-1 rounded bg-ink/[0.03] p-2 text-xs">
            {results.map((x, i) => (
              <div key={i} className={x.error ? "text-red-600" : "text-emerald-700"}>
                {x.shopName ?? x.shopId}: {x.error ? `gagal — ${x.error}` : `dibuat (${x.added ?? 0} produk)`}
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="text" onClick={onClose} disabled={busy}>Tutup</Button>
          <Button variant="filled" loading={busy} onClick={run} disabled={!targets.length}>Replikasi</Button>
        </div>
      </div>
    </Modal>
  );
}

interface AutoSettings {
  enabled: boolean; dryRun: boolean; onlyOngoing: boolean; minUpliftPct: number; requireProfit: boolean;
  minOrders: number; autoExtend: boolean; extendDays: number; autoReplicate: boolean; replicateDiscountPct: number;
  lastRunAt?: string | null;
}
interface RunRow {
  shop: string; title: string; status?: string; skipped?: string;
  window?: { orders: number; sales: number; net: number }; baseline?: { orders: number; sales: number };
  upliftPct?: number; positive?: boolean; actions?: string[];
}
const rp = (n: number) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");

function AutomationModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { data } = useFetch<AutoSettings>("/promotion/automation");
  const [f, setF] = useState<AutoSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<RunRow[] | null>(null);
  useEffect(() => { if (data && !f) setF(data); }, [data, f]);

  if (!f) {
    return (
      <Modal open onClose={onClose} title="Otomasi Promosi" width="max-w-3xl">
        <Skeleton className="h-40 w-full" />
      </Modal>
    );
  }
  const upd = (p: Partial<AutoSettings>) => setF({ ...f, ...p });
  async function save() {
    setBusy(true);
    try { await api.put("/promotion/automation", f); toast("Pengaturan otomasi disimpan", "success"); }
    catch (e) { toast((e as Error).message, "danger"); } finally { setBusy(false); }
  }
  async function run() {
    setRunning(true); setReport(null);
    try {
      const r = await api.post<{ dryRun: boolean; summary: { total: number; positif: number }; report: RunRow[] }>(
        "/promotion/automation/run", { dryRun: f!.dryRun },
      );
      setReport(r.report);
      toast(`Otomasi ${r.dryRun ? "(uji coba) " : ""}selesai: ${r.summary.positif}/${r.summary.total} promo positif`, "success");
    } catch (e) { toast((e as Error).message, "danger"); } finally { setRunning(false); }
  }
  const numF = (label: string, key: keyof AutoSettings) => (
    <div>
      <label className="block text-[11px] text-ink-3 mb-1">{label}</label>
      <input
        value={String(f[key] as number)}
        onChange={(e) => upd({ [key]: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 } as Partial<AutoSettings>)}
        className="w-24 rounded border border-line px-2 py-1 text-sm tabular-nums"
      />
    </div>
  );
  const chk = (label: string, key: keyof AutoSettings, hint?: string) => (
    <label className="flex items-start gap-2 text-sm text-ink-2">
      <input type="checkbox" className="mt-0.5" checked={f[key] as boolean} onChange={(e) => upd({ [key]: e.target.checked } as Partial<AutoSettings>)} />
      <span>{label}{hint && <span className="block text-[11px] text-ink-3">{hint}</span>}</span>
    </label>
  );

  return (
    <Modal open onClose={onClose} title="Otomasi Promosi" width="max-w-3xl">
      <div className="space-y-3">
        <InlineAlert tone="info">
          Alur: cek tiap promo → bandingkan penjualan rentang promo vs periode sebelum yang sama panjang → hitung net
          pencairan → bila positif, perpanjang rentang & replikasi ke semua toko. <b>Mode uji coba</b> hanya melaporkan
          tanpa mengubah apa pun. Aksi live mengubah harga nyata di TikTok.
        </InlineAlert>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {chk("Aktifkan otomasi terjadwal (harian)", "enabled", "Jalan otomatis tiap hari untuk akun ini.")}
          {chk("Mode uji coba (dry-run)", "dryRun", "Hanya laporan, TIDAK mengeksekusi aksi.")}
          {chk("Hanya promo yang sedang berjalan", "onlyOngoing")}
          {chk("Wajib untung (net > 0)", "requireProfit")}
        </div>
        <div className="flex flex-wrap gap-3">
          {numF("Min. kenaikan penjualan %", "minUpliftPct")}
          {numF("Min. jumlah order", "minOrders")}
        </div>
        <div className="space-y-2 rounded-lg border border-line p-3">
          <div className="text-xs font-semibold text-ink-2">Aksi bila hasil positif</div>
          <div className="flex flex-wrap items-end gap-3">
            {chk("Perpanjang rentang", "autoExtend")}
            {numF("+ hari", "extendDays")}
            {chk("Replikasi ke semua toko", "autoReplicate")}
            {numF("Diskon replikasi %", "replicateDiscountPct")}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="filled" loading={busy} onClick={save}>Simpan Pengaturan</Button>
          <Button variant="tonal" loading={running} onClick={run}>Jalankan Sekarang{f.dryRun ? " (uji coba)" : ""}</Button>
          {data?.lastRunAt && <span className="text-[11px] text-ink-3">terakhir: {new Date(data.lastRunAt).toLocaleString("id-ID")}</span>}
        </div>
        {report && (
          <div className="max-h-72 overflow-y-auto overflow-x-auto rounded border border-line">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface">
                <tr className="text-left text-ink-3">
                  <th className="px-2 py-1">Toko</th><th className="px-2 py-1">Promo</th>
                  <th className="px-2 py-1 text-right">Order (promo/sblm)</th><th className="px-2 py-1 text-right">Uplift</th>
                  <th className="px-2 py-1 text-right">Net</th><th className="px-2 py-1">Hasil</th><th className="px-2 py-1">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {report.map((r, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-2 py-1">{r.shop}</td>
                    <td className="px-2 py-1">{r.title}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.skipped ? "—" : `${r.window?.orders ?? 0} / ${r.baseline?.orders ?? 0}`}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.skipped ? "—" : `${r.upliftPct ?? 0}%`}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.skipped ? "—" : rp(r.window?.net ?? 0)}</td>
                    <td className="px-2 py-1">{r.skipped ? <span className="text-ink-3">{r.skipped}</span> : r.positive ? <Badge tone="success">positif</Badge> : <Badge tone="neutral">-</Badge>}</td>
                    <td className="px-2 py-1 text-ink-3">{(r.actions ?? []).join("; ")}</td>
                  </tr>
                ))}
                {!report.length && <tr><td colSpan={7} className="px-2 py-3 text-center text-ink-3">Tak ada promo yang cocok kriteria.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-end"><Button variant="text" onClick={onClose}>Tutup</Button></div>
      </div>
    </Modal>
  );
}
