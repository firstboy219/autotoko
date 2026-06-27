import { useCallback } from "react";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { useRealtime } from "../lib/realtime";

interface Activity {
  id: string;
  feature: string;
  action: string;
  status: "done" | "held" | "error";
  provider: string | null;
  summary: string | null;
  refType: string | null;
  refId: string | null;
  createdAt: string;
}

const STATUS_STYLE: Record<Activity["status"], { label: string; cls: string }> = {
  done: { label: "Dijalankan", cls: "bg-green-100 text-green-700" },
  held: { label: "Ditahan (review)", cls: "bg-amber-100 text-amber-700" },
  error: { label: "Gagal", cls: "bg-red-100 text-red-700" },
};

const FEATURE_LABEL: Record<string, string> = {
  auto_approve: "Auto Approve Pesanan",
  buyer_chat: "Auto Chat Pembeli",
  affiliate_chat: "Auto Chat Affiliator",
  review_reply: "Auto Balas Review",
  product_optimize: "Optimasi Produk",
};

function timeAgo(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
}

interface ChatLog {
  id: string;
  chatType: "buyer" | "affiliate";
  counterpartName: string | null;
  messageIn: string | null;
  messageOut: string | null;
  aiModel: string | null;
}
interface ReviewLog {
  id: string;
  rating: number | null;
  reviewText: string | null;
  replyText: string | null;
}

export function Autopilot() {
  const { data, reload } = useFetch<Activity[]>("/ai/activity?limit=100");
  const { data: chats } = useFetch<ChatLog[]>("/marketing/chat-logs");
  const { data: reviews } = useFetch<ReviewLog[]>("/marketing/review-logs");

  // Live-refresh when an order event arrives (autopilot may have just acted).
  useRealtime(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const rows = data ?? [];

  return (
    <Layout title="Aktivitas Autopilot">
      <p className="text-sm text-slate-500 mb-4">
        Catatan setiap tindakan yang dijalankan AI secara otomatis untukmu. Setup dilakukan sekali
        di Admin CMS; aktivitas berjalan otomatis dan bisa kamu pantau di sini.
      </p>

      {rows.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
          Belum ada aktivitas autopilot. Aktifkan fitur (mis. Auto Approve) di Admin CMS → AI Autopilot.
        </div>
      )}

      <div className="space-y-2">
        {rows.map((a) => {
          const s = STATUS_STYLE[a.status];
          return (
            <div
              key={a.id}
              className="bg-white rounded-xl border border-slate-200 p-3 flex items-start gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm text-slate-800">
                    {FEATURE_LABEL[a.feature] ?? a.feature}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${s.cls}`}>{s.label}</span>
                  {a.provider && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                      {a.provider}
                    </span>
                  )}
                </div>
                {a.summary && <div className="text-[13px] text-slate-600 mt-0.5">{a.summary}</div>}
                {a.refType && (
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {a.refType}: {a.refId}
                  </div>
                )}
              </div>
              <div className="text-[11px] text-slate-400 whitespace-nowrap">{timeAgo(a.createdAt)}</div>
            </div>
          );
        })}
      </div>

      {chats && chats.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-bold text-slate-700 mb-2">💬 Auto Chat AI</h2>
          <div className="space-y-2">
            {chats.map((c) => (
              <div key={c.id} className="bg-white rounded-xl border border-slate-200 p-3">
                <div className="text-[11px] text-slate-400 mb-1">
                  {c.chatType === "buyer" ? "Pembeli" : "Affiliator"}
                  {c.counterpartName ? ` · ${c.counterpartName}` : ""}
                  {c.aiModel ? ` · ${c.aiModel}` : ""}
                </div>
                {c.messageIn && <div className="text-[13px] text-slate-500">🗨️ {c.messageIn}</div>}
                {c.messageOut && <div className="text-[13px] text-slate-800 mt-1">🤖 {c.messageOut}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {reviews && reviews.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-bold text-slate-700 mb-2">⭐ Auto Balas Review AI</h2>
          <div className="space-y-2">
            {reviews.map((r) => (
              <div key={r.id} className="bg-white rounded-xl border border-slate-200 p-3">
                <div className="text-[12px] text-amber-600 mb-0.5">{"★".repeat(r.rating ?? 0)}{"☆".repeat(5 - (r.rating ?? 0))}</div>
                {r.reviewText && <div className="text-[13px] text-slate-500">🗨️ {r.reviewText}</div>}
                {r.replyText && <div className="text-[13px] text-slate-800 mt-1">🤖 {r.replyText}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </Layout>
  );
}
