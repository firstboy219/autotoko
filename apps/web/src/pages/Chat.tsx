import { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { api } from "../lib/api";
import { Card, Badge, Skeleton, InlineAlert, Button, useToast } from "../components/ui";
import { Icon } from "../components/Icon";

/**
 * Chat Pelanggan (Fase 1) — inbox terpadu. Web = take-action + monitoring, jadi
 * di sinilah CS dilakukan tanpa buka Seller Center. Fondasi: percakapan &
 * pesan dibaca dari backend; balasan di-ANTRE (status 'queued') dan benar-benar
 * terkirim begitu koneksi TikTok IM (scope) diaktifkan.
 */

interface Conv {
  id: string;
  buyerName: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unread: number;
  marketplace: string;
}
interface Msg {
  id: string;
  direction: "in" | "out";
  sender: string | null;
  text: string | null;
  status: string;
  createdAt: string;
}

const jam = (s?: string | null) =>
  s ? new Date(s).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "";

export function Chat() {
  const toast = useToast();
  const [convs, setConvs] = useState<Conv[] | null>(null);
  const [sel, setSel] = useState<Conv | null>(null);
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [teks, setTeks] = useState("");
  const [kirim, setKirim] = useState(false);
  const [sinkron, setSinkron] = useState(false);
  const [saran, setSaran] = useState(false);

  function muatConvs() {
    api.get<Conv[]>("/chat/conversations").then(setConvs).catch(() => setConvs([]));
  }
  useEffect(() => { muatConvs(); }, []);

  async function tarikDariMarketplace() {
    setSinkron(true);
    try {
      const r = await api.post<{ conversations: number; hasil: { shop: string; error?: string }[] }>(
        "/marketplace-sync/chat/sync", {});
      const err = r.hasil?.find((h) => h.error);
      if (err) toast(`Belum tersambung: ${err.error}. Pastikan scope Customer Service aktif.`, "warning");
      else toast(`${r.conversations} percakapan tersinkron.`, "success");
      muatConvs();
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setSinkron(false);
    }
  }

  useEffect(() => {
    if (!sel) { setMsgs(null); return; }
    setMsgs(null);
    api.get<Msg[]>(`/chat/conversations/${sel.id}/messages`).then(setMsgs).catch(() => setMsgs([]));
  }, [sel]);

  async function saranKb() {
    if (!sel) return;
    const lastIn = [...(msgs ?? [])].reverse().find((m) => m.direction === "in");
    const src = lastIn?.text ?? teks;
    if (!src.trim()) { toast("Tak ada pesan pembeli untuk dasar saran.", "warning"); return; }
    setSaran(true);
    try {
      const r = await api.post<{ matched: boolean; reply: string }>("/kb/draft", { text: src, kind: "chat" });
      if (r?.matched && r.reply) { setTeks(r.reply); toast("Draf dari KB terisi \u2014 periksa lalu kirim.", "success"); }
      else toast("Tak ada saran cocok dari KB. Tambah entri di menu Balasan Otomatis.", "warning");
    } catch (e) { toast((e as Error).message, "danger"); }
    finally { setSaran(false); }
  }

  async function balas() {
    if (!sel || !teks.trim()) return;
    setKirim(true);
    try {
      const r = await api.post<{ sent?: boolean; queued?: boolean; error?: string }>(
        `/chat/conversations/${sel.id}/reply`,
        { text: teks.trim() },
      );
      setTeks("");
      const m = await api.get<Msg[]>(`/chat/conversations/${sel.id}/messages`);
      setMsgs(m);
      if (r?.sent) toast("Balasan terkirim ke pembeli.", "success");
      else toast(
        r?.error ? `Belum terkirim (${r.error}) — disimpan & diantre.` : "Balasan diantre — terkirim saat koneksi TikTok IM aktif.",
        "warning",
      );
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setKirim(false);
    }
  }

  return (
    <Layout title="Chat Pelanggan">
      <InlineAlert tone="info">
        Balasan <b>langsung terkirim ke pembeli</b> begitu <b>scope Customer Service (TikTok IM)</b> aktif pada koneksi toko.
        Bila scope belum aktif, balasan tetap tersimpan &amp; diantre (tidak hilang). Klik <b>Sinkron</b> untuk menarik
        percakapan &amp; pesan terbaru dari TikTok. Buka sebuah percakapan untuk menarik pesannya otomatis.
      </InlineAlert>

      <div className="grid gap-3 md:grid-cols-[320px_1fr] mt-4">
        {/* Daftar percakapan */}
        <Card className="p-0 overflow-hidden md:max-h-[70vh] md:overflow-y-auto">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-ink">Percakapan</span>
            <Button size="sm" variant="tonal" loading={sinkron} onClick={tarikDariMarketplace}>Sinkron</Button>
          </div>
          {convs === null ? (
            <div className="p-4 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : convs.length === 0 ? (
            <div className="p-6 text-center text-sm text-ink-3">
              <Icon name="cart" size={26} />
              <div className="mt-2">Belum ada percakapan.</div>
              <div className="text-xs mt-1">Menunggu koneksi TikTok IM.</div>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {convs.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSel(c)}
                  className={`w-full text-left px-4 py-3 hover:bg-canvas transition ${sel?.id === c.id ? "bg-canvas" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-ink truncate">{c.buyerName ?? "Pembeli"}</span>
                    {c.unread > 0 && <Badge tone="danger">{c.unread}</Badge>}
                  </div>
                  <div className="text-xs text-ink-3 truncate mt-0.5">{c.lastMessage ?? "—"}</div>
                  <div className="text-[11px] text-ink-3 mt-0.5">{jam(c.lastMessageAt)}</div>
                </button>
              ))}
            </div>
          )}
        </Card>

        {/* Thread */}
        <Card className="p-0 overflow-hidden flex flex-col md:max-h-[70vh]">
          {!sel ? (
            <div className="flex-1 grid place-items-center p-10 text-sm text-ink-3">
              Pilih percakapan untuk melihat pesan.
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-line">
                <div className="text-sm font-medium text-ink">{sel.buyerName ?? "Pembeli"}</div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-canvas">
                {msgs === null ? (
                  <Skeleton className="h-24 w-full" />
                ) : msgs.length === 0 ? (
                  <div className="text-center text-sm text-ink-3 py-8">Belum ada pesan.</div>
                ) : (
                  msgs.map((m) => (
                    <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${
                          m.direction === "out" ? "bg-brand text-white" : "bg-white text-ink ring-1 ring-line"
                        }`}
                      >
                        <div>{m.text}</div>
                        <div className={`text-[10px] mt-1 ${m.direction === "out" ? "text-white/70" : "text-ink-3"}`}>
                          {jam(m.createdAt)}{m.direction === "out" && m.status === "queued" ? " · diantre" : ""}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="border-t border-line p-3 flex gap-2">
                <input
                  value={teks}
                  onChange={(e) => setTeks(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); balas(); } }}
                  placeholder="Tulis balasan…"
                  className="flex-1 rounded-lg border border-line px-3 py-2 text-sm bg-white text-ink focus:outline-none focus:ring-2 focus:ring-brand/40"
                />
                <Button variant="outline" loading={saran} onClick={saranKb} title="Saran balasan dari Knowledge Base">Saran (KB)</Button>
                <Button variant="filled" loading={kirim} onClick={balas} disabled={!teks.trim()}>Kirim</Button>
              </div>
            </>
          )}
        </Card>
      </div>
    </Layout>
  );
}
