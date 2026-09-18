import { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";
import { Card, CardHeader, Badge, Button, Select, Input, InlineAlert, Skeleton, ConfirmModal, useToast } from "../components/ui";

interface Activity { id?: string; activity_id?: string; title?: string; activity_type?: string; type?: string; status?: string; begin_time?: number; end_time?: number; }
interface ShopActivities { shopId: string; shopName: string; activities: Activity[]; error?: string; }
interface Coupon { id?: string; coupon_id?: string; title?: string; name?: string; status?: string; }
interface ShopCoupons { shopId: string; shopName: string; coupons: Coupon[]; error?: string; }
interface PromoSetting { shopId: string; autoJoin: boolean; activityId: string | null; discountPct: string; }

const fmtTime = (t?: number) => (t ? new Date(t * 1000).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "-");
const actId = (a: Activity) => a.id ?? a.activity_id ?? "";
const actTitle = (a: Activity) => a.title ?? actId(a) ?? "(tanpa judul)";
const actType = (a: Activity) => a.activity_type ?? a.type ?? "-";

export function Promotion() {
  const toast = useToast();
  const acts = useFetch<ShopActivities[]>("/promotion/activities");
  const coups = useFetch<ShopCoupons[]>("/promotion/coupons");
  const sett = useFetch<PromoSetting[]>("/promotion/settings");
  const [edit, setEdit] = useState<Record<string, { autoJoin: boolean; activityId: string; discountPct: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDeact, setConfirmDeact] = useState<{ shopId: string; activityId: string; title: string } | null>(null);

  useEffect(() => {
    if (!sett.data) return;
    const m: Record<string, { autoJoin: boolean; activityId: string; discountPct: string }> = {};
    for (const s of sett.data) m[s.shopId] = { autoJoin: s.autoJoin, activityId: s.activityId ?? "", discountPct: String(s.discountPct ?? "10") };
    setEdit((prev) => ({ ...m, ...prev }));
  }, [sett.data]);

  const shops = acts.data ?? [];
  const couponsByShop = new Map((coups.data ?? []).map((c) => [c.shopId, c]));
  const ed = (shopId: string) => edit[shopId] ?? { autoJoin: false, activityId: "", discountPct: "10" };
  const setEd = (shopId: string, patch: Partial<{ autoJoin: boolean; activityId: string; discountPct: string }>) =>
    setEdit((p) => ({ ...p, [shopId]: { ...ed(shopId), ...patch } }));

  async function saveSetting(shopId: string) {
    setBusy(shopId + ":save");
    try {
      const e = ed(shopId);
      await api.put(`/promotion/settings/${shopId}`, { autoJoin: e.autoJoin, activityId: e.activityId || null, discountPct: Number(e.discountPct) || 0 });
      toast("Pengaturan auto-ikut disimpan", "success");
    } catch (e) { toast((e as Error).message, "danger"); } finally { setBusy(null); }
  }
  async function applyNow(shopId: string) {
    setBusy(shopId + ":apply");
    try {
      const r = await api.post<{ added: number }>(`/promotion/settings/${shopId}/apply`);
      toast(`${r.added} produk didaftarkan ke promo`, "success");
    } catch (e) { toast((e as Error).message, "danger"); } finally { setBusy(null); }
  }
  async function deactivate() {
    if (!confirmDeact) return;
    setBusy("deact");
    try {
      await api.post(`/promotion/activities/${confirmDeact.shopId}/${confirmDeact.activityId}/deactivate`);
      toast("Promo dinonaktifkan", "success");
      setConfirmDeact(null);
      acts.reload();
    } catch (e) { toast((e as Error).message, "danger"); } finally { setBusy(null); }
  }

  return (
    <Layout title="Promosi">
      <InlineAlert tone="info">
        Kelola promo TikTok: <b>activity</b> (flash sale / diskon) &amp; <b>coupon</b>. Catatan: API TikTok hanya
        menyediakan promo yang <b>dibuat seller</b> — tidak ada endpoint untuk ikut campaign resmi platform. Fitur
        <b> Auto-ikut</b> mendaftarkan produk aktif toko ke salah satu activity milikmu dengan diskon tertentu (memicu
        harga promo nyata di TikTok).
      </InlineAlert>

      {acts.loading ? (
        <Skeleton className="h-40 w-full mt-4" />
      ) : (
        <div className="space-y-4 mt-4">
          {!shops.length && <Card className="p-4 text-sm text-ink-3">Belum ada toko TikTok tersambung.</Card>}
          {shops.map((s) => {
            const e = ed(s.shopId);
            const shopCoupons = couponsByShop.get(s.shopId)?.coupons ?? [];
            return (
              <Card key={s.shopId} className="p-0">
                <CardHeader
                  title={s.shopName}
                  subtitle={s.error ? `Error: ${s.error}` : `${s.activities.length} activity · ${shopCoupons.length} coupon`}
                />
                <div className="p-4 space-y-4">
                  <div className="rounded-lg border border-line p-3">
                    <div className="text-xs font-semibold text-ink-2 mb-2">Auto-ikut promo</div>
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="flex items-center gap-1.5 pb-2 text-sm text-ink-2">
                        <input type="checkbox" checked={e.autoJoin} onChange={(ev) => setEd(s.shopId, { autoJoin: ev.target.checked })} /> Aktif
                      </label>
                      <div>
                        <label className="block text-[11px] text-ink-3 mb-1">Activity target</label>
                        <Select value={e.activityId} onChange={(ev) => setEd(s.shopId, { activityId: ev.target.value })}>
                          <option value="">— pilih —</option>
                          {s.activities.map((a) => (
                            <option key={actId(a)} value={actId(a)}>{actTitle(a)}</option>
                          ))}
                        </Select>
                      </div>
                      <div>
                        <label className="block text-[11px] text-ink-3 mb-1">Diskon %</label>
                        <Input value={e.discountPct} onChange={(ev) => setEd(s.shopId, { discountPct: ev.target.value.replace(/[^0-9.]/g, "") })} className="w-20 tabular-nums" />
                      </div>
                      <Button size="sm" variant="filled" loading={busy === s.shopId + ":save"} onClick={() => saveSetting(s.shopId)}>Simpan</Button>
                      <Button size="sm" variant="tonal" loading={busy === s.shopId + ":apply"} disabled={!e.activityId} onClick={() => applyNow(s.shopId)} title="Daftarkan produk aktif toko ke activity target sekarang">
                        Terapkan sekarang
                      </Button>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-ink-2 mb-2">Activity</div>
                    {!s.activities.length ? (
                      <div className="text-xs text-ink-3">Belum ada activity.</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-ink-3">
                              <th className="py-1 pr-2">Judul</th>
                              <th className="py-1 pr-2">Tipe</th>
                              <th className="py-1 pr-2">Status</th>
                              <th className="py-1 pr-2">Periode</th>
                              <th className="py-1"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {s.activities.map((a) => (
                              <tr key={actId(a)} className="border-t border-line">
                                <td className="py-1 pr-2">{actTitle(a)}</td>
                                <td className="py-1 pr-2">{actType(a)}</td>
                                <td className="py-1 pr-2">
                                  <Badge tone={a.status === "ONGOING" || a.status === "ACTIVE" ? "success" : "neutral"}>{a.status ?? "-"}</Badge>
                                </td>
                                <td className="py-1 pr-2 whitespace-nowrap">{fmtTime(a.begin_time)} – {fmtTime(a.end_time)}</td>
                                <td className="py-1 text-right">
                                  <button onClick={() => setConfirmDeact({ shopId: s.shopId, activityId: actId(a), title: actTitle(a) })} className="text-red-600 hover:underline">
                                    Nonaktifkan
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {shopCoupons.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-ink-2 mb-2">Coupon</div>
                      <div className="flex flex-wrap gap-2">
                        {shopCoupons.map((c, i) => (
                          <Badge key={c.id ?? c.coupon_id ?? i} tone="brand">
                            {c.title ?? c.name ?? c.id ?? c.coupon_id}{c.status ? ` · ${c.status}` : ""}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmModal
        open={confirmDeact != null}
        onClose={() => setConfirmDeact(null)}
        onConfirm={deactivate}
        loading={busy === "deact"}
        title="Nonaktifkan promo?"
        confirmLabel="Nonaktifkan"
        description={confirmDeact ? `Promo "${confirmDeact.title}" akan dinonaktifkan di TikTok (harga kembali normal). Lanjutkan?` : ""}
      />
    </Layout>
  );
}
