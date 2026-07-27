import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { portalApi, clearPortalToken, getPortalToken } from "../lib/portalApi";
import { rupiah, dateShort } from "../lib/fmt";

interface Me { id: string; name: string; contact: string | null; type: "sub_seller" | "sub_sub_seller"; }
interface Shop { id: string; marketplace: string; shopName: string | null; shopId: string; }
interface HistoryRow {
  id: string; expectedAmount: string;
  validationStatus: "belum_upload" | "cocok_otomatis" | "tidak_cocok" | "override_manual";
  payoutDate: string; shopName: string | null; marketplace: string;
}

const STATUS_LABEL: Record<HistoryRow["validationStatus"], string> = {
  belum_upload: "Diproses",
  cocok_otomatis: "Selesai",
  tidak_cocok: "Diproses",
  override_manual: "Selesai",
};
const STATUS_BADGE: Record<HistoryRow["validationStatus"], string> = {
  belum_upload: "bg-slate-100 text-slate-500",
  cocok_otomatis: "bg-green-100 text-green-700",
  tidak_cocok: "bg-slate-100 text-slate-500",
  override_manual: "bg-green-100 text-green-700",
};
const TYPE_LABEL: Record<Me["type"], string> = { sub_seller: "Sub-seller", sub_sub_seller: "Sub-sub-seller" };

export function PortalDashboard() {
  const navigate = useNavigate();
  const [me, setMe] = useState<Me | null>(null);
  const [shops, setShops] = useState<Shop[] | null>(null);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!getPortalToken()) { navigate("/portal/login"); return; }
    Promise.all([
      portalApi.get<Me>("/payout/portal/me"),
      portalApi.get<Shop[]>("/payout/portal/shops"),
      portalApi.get<HistoryRow[]>("/payout/portal/history"),
    ])
      .then(([m, s, h]) => { setMe(m); setShops(s); setHistory(h); })
      .catch((e) => setErr((e as Error).message));
  }, [navigate]);

  function logout() {
    clearPortalToken();
    navigate("/portal/login");
  }

  if (err) return <div className="min-h-screen flex items-center justify-center text-red-500 text-sm">{err}</div>;
  if (!me) return <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">Memuat…</div>;

  const total = (history ?? []).reduce((acc, h) => acc + Number(h.expectedAmount), 0);

  return (
    <div className="min-h-screen bg-[#F0F4F8]">
      <header className="bg-navy text-white px-4 py-3 flex items-center justify-between">
        <div>
          <div className="font-extrabold text-sm">{me.name}</div>
          <div className="text-[10px] text-white/50 uppercase tracking-wide">{TYPE_LABEL[me.type]} · Portal Read-only</div>
        </div>
        <button onClick={logout} className="text-xs text-white/60 hover:text-white">Keluar</button>
      </header>

      <main className="p-4 max-w-2xl mx-auto space-y-4">
        <div className="bg-gradient-to-br from-navy to-[#252558] rounded-xl p-4 text-white">
          <div className="text-[10px] uppercase tracking-wide text-white/40">Total Riwayat Pencairan Anda</div>
          <div className="text-2xl font-extrabold mt-1">{rupiah(total)}</div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 font-bold text-sm">Toko Anda ({shops?.length ?? 0})</div>
          {!shops?.length ? (
            <div className="px-4 py-4 text-center text-slate-400 text-sm">Belum ada toko terhubung.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {shops.map((s) => (
                <div key={s.id} className="px-4 py-2 flex items-center justify-between text-sm">
                  <span className="font-medium">{s.shopName ?? s.shopId}</span>
                  <span className="text-xs text-slate-400">{s.marketplace}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 font-bold text-sm">Riwayat Pencairan</div>
          {!history?.length ? (
            <div className="px-4 py-6 text-center text-slate-400 text-sm">Belum ada riwayat.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-[10px] uppercase text-slate-500">
                  <th className="text-left px-3 py-2">Tanggal</th>
                  <th className="text-left px-3 py-2">Toko</th>
                  <th className="text-right px-3 py-2">Nominal</th>
                  <th className="text-left px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-500">{dateShort(h.payoutDate)}</td>
                    <td className="px-3 py-2">{h.shopName} <span className="text-slate-400 text-xs">({h.marketplace})</span></td>
                    <td className="px-3 py-2 text-right font-semibold">{rupiah(h.expectedAmount)}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${STATUS_BADGE[h.validationStatus]}`}>
                        {STATUS_LABEL[h.validationStatus]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}
