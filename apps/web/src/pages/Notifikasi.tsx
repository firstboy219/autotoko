import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";

interface Notif {
  id: string;
  type: string | null;
  title: string | null;
  message: string | null;
  channel: "wa" | "email" | "in_app";
  sent: boolean;
  sentAt: string | null;
  createdAt: string;
}

const ICON: Record<string, string> = {
  low_stock: "⚠️", daily_report: "📊", weekly_report: "📈", autopilot: "🤖",
  topup: "💳", token_expiry: "🔑", order: "🛒",
};

export function Notifikasi() {
  const { data, loading } = useFetch<Notif[]>("/account/notifications");
  const rows = data ?? [];

  return (
    <Layout title="Notifikasi">
      {loading && <div className="text-slate-400 text-sm">Memuat…</div>}
      {!loading && rows.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
          Belum ada notifikasi.
        </div>
      )}
      <div className="space-y-2 max-w-2xl">
        {rows.map((n) => (
          <div key={n.id} className="bg-white rounded-xl border border-slate-200 p-3 flex gap-3">
            <div className="text-xl">{ICON[n.type ?? ""] ?? "🔔"}</div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm text-slate-800">{n.title ?? n.type}</div>
              {n.message && <div className="text-[13px] text-slate-600 mt-0.5">{n.message}</div>}
              <div className="text-[11px] text-slate-400 mt-1">
                {new Date(n.createdAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                {" · "}via {n.channel === "in_app" ? "aplikasi" : n.channel}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Layout>
  );
}
