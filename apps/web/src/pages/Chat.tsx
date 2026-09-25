import { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { api } from "../lib/api";
import { Card, Badge, Skeleton, InlineAlert, Button, Input, Textarea, useToast } from "../components/ui";
import { Icon } from "../components/Icon";

/**
 * Chat Pelanggan — inbox terpadu + OTOMASI.
 *
 * Pesan masuk ditarik real-time lewat webhook TikTok (New message) dan cron 10
 * menit. Balas otomatis (opsional, per toko) memakai Knowledge Base seller:
 * placeholder {resi}/{status}/{pembeli}/{toko} diisi dari order terakhir
 * pembeli; pesan yang tak cocok KB menunggu dijawab manual. Balasan manual
 * yang gagal terkirim diantre & dikirim ulang otomatis. Semua butuh izin
 * Customer Service TikTok per toko (status tampil di panel).
 */

interface Conv {
  id: string;
  buyerName: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unread: number;
  marketplace: string;
  shopId: string | null;
}
interface Msg {
  id: string;
  direction: "in" | "out";
  sender: string | null;
  text: string | null;
  status: string;
  createdAt: string;
}
interface Izin { shopId: string; shopName: string; aktif: boolean; pesan: string | null }
interface Status { izin: Izin[]; antre: number; gagal: number; otomatis7Hari: number }
interface Settings {
  autoReply: boolean;
  autoReplyShopIds: string[] | null;
  officeStart: number | null;
  officeEnd: number | null;
  fallbackText: string | null;
  tersimpan: boolean;
}
interface Uji { akanDibalas: boolean; sumber: string | null; balasan: string | null; catatan: string | null }

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
  const [status, setStatus] = useState<Status | null>(null);
  const [panel, setPanel] = useState(false);

  function muatConvs() {
    api.get<Conv[]>("/chat/conversations").then(setConvs).catch(() => setConvs([]));
  }
  function muatStatus() {
    api.get<Status>("/chat/status").then(setStatus).catch(() => setStatus(null));
  }
  useEffect(() => { muatConvs(); muatStatus(); }, []);

  async function jalankanSekarang() {
    setSinkron(true);
    try {
      const r = await api.post<{ percakapan: number; pesanBaru: number; dibalasOtomatis: number; antreanTerkirim: number; galat: string[] }>(
        "/chat/run", {});
      if (r.galat?.length && r.percakapan === 0) toast(`Belum tersambung: ${r.galat[0]}`, "warning");
      else toast(`${r.percakapan} percakapan · ${r.pesanBaru} pesan baru · ${r.dibalasOtomatis} dibalas otomatis · ${r.antreanTerkirim} antrean terkirim`, "success");
      muatConvs(); muatStatus();
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
      if (r?.matched && r.reply) { setTeks(r.reply); toast("Draf dari KB terisi — periksa lalu kirim.", "success"); }
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
        r?.error ? `Belum terkirim (${r.error.slice(0, 90)}) — disimpan & dikirim ulang otomatis.` : "Balasan diantre — dikirim ulang otomatis.",
        "warning",
      );
      muatStatus();
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setKirim(false);
    }
  }

  const izin = status?.izin ?? [];
  const aktif = izin.filter((i) => i.aktif);

  return (
    <Layout title="Chat Pelanggan">
      {status === null ? (
        <Skeleton className="h-14 w-full" />
      ) : aktif.length > 0 ? (
        <InlineAlert tone="success">
          Chat TikTok <b>tersambung</b> di {aktif.map((i) => i.shopName).join(", ")}. Pesan masuk ditarik otomatis (webhook
          real-time + tiap 10 menit){izin.length > aktif.length ? `; ${izin.length - aktif.length} toko lain belum berizin.` : "."}
        </InlineAlert>
      ) : (
        <InlineAlert tone="warning">
          Izin <b>Customer Service</b> TikTok belum aktif di toko mana pun, jadi chat belum bisa ditarik/dikirim. Setelah izin
          disetujui di Partner Center, <b>hubungkan ulang</b> toko (menu Toko / Integrasi Toko di APK) — otomasi langsung menyala
          tanpa perlu diubah. Balasan yang Anda tulis sekarang tetap disimpan &amp; dikirim ulang otomatis.
        </InlineAlert>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="tonal" loading={sinkron} onClick={jalankanSekarang} icon="refresh">Jalankan sekarang</Button>
        <Button size="sm" variant={panel ? "filled" : "outline"} onClick={() => setPanel((v) => !v)}>
          Otomasi chat {panel ? "▲" : "▼"}
        </Button>
        {status && (
          <span className="text-xs text-ink-3">
            {status.otomatis7Hari} dibalas otomatis (7 hari) · {status.antre} antre{status.gagal ? ` · ${status.gagal} gagal` : ""}
          </span>
        )}
      </div>

      {panel && <PanelOtomasi izin={izin} onSaved={muatStatus} />}

      <div className="grid gap-3 md:grid-cols-[320px_1fr] mt-4">
        {/* Daftar percakapan */}
        <Card className="p-0 overflow-hidden md:max-h-[70vh] md:overflow-y-auto">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-ink">Percakapan</span>
            <span className="text-xs text-ink-3">{convs?.length ?? 0}</span>
          </div>
          {convs === null ? (
            <div className="p-4 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : convs.length === 0 ? (
            <div className="p-6 text-center text-sm text-ink-3">
              <Icon name="cart" size={26} />
              <div className="mt-2">Belum ada percakapan.</div>
              <div className="text-xs mt-1">{aktif.length ? "Tekan Jalankan sekarang untuk menarik chat." : "Menunggu izin Customer Service TikTok."}</div>
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
                  <div className="text-[11px] text-ink-3 mt-0.5">
                    {izin.find((i) => i.shopId === c.shopId)?.shopName ?? ""} · {jam(c.lastMessageAt)}
                  </div>
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
                        <div className="whitespace-pre-wrap">{m.text}</div>
                        <div className={`text-[10px] mt-1 ${m.direction === "out" ? "text-white/70" : "text-ink-3"}`}>
                          {jam(m.createdAt)}
                          {m.sender === "auto" ? " · otomatis" : ""}
                          {m.direction === "out" && m.status === "queued" ? " · diantre" : ""}
                          {m.direction === "out" && m.status === "failed" ? " · gagal terkirim" : ""}
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

/** Pengaturan balas otomatis + uji balasan tanpa mengirim. */
function PanelOtomasi({ izin, onSaved }: { izin: Izin[]; onSaved: () => void }) {
  const toast = useToast();
  const [s, setS] = useState<Settings | null>(null);
  const [simpan, setSimpan] = useState(false);
  const [contoh, setContoh] = useState("kak pesanan saya kapan dikirim?");
  const [uji, setUji] = useState<Uji | null>(null);
  const [menguji, setMenguji] = useState(false);

  useEffect(() => { api.get<Settings>("/chat/settings").then(setS).catch(() => setS(null)); }, []);

  if (!s) return <Card className="mt-3 p-4"><Skeleton className="h-24 w-full" /></Card>;
  const semua = !s.autoReplyShopIds || s.autoReplyShopIds.length === 0;
  const pilih = new Set(s.autoReplyShopIds ?? []);

  async function save() {
    if (!s) return;
    setSimpan(true);
    try {
      const r = await api.put<Settings>("/chat/settings", {
        autoReply: s.autoReply,
        autoReplyShopIds: semua ? [] : [...pilih],
        officeStart: s.officeStart, officeEnd: s.officeEnd,
        fallbackText: s.fallbackText ?? "",
      });
      setS(r);
      toast(r.autoReply ? "Tersimpan — balas otomatis AKTIF." : "Tersimpan — balas otomatis mati.", "success");
      onSaved();
    } catch (e) {
      const m = (e as Error).message;
      toast(/chat_settings/.test(m) ? "Tabel pengaturan chat belum dibuat (jalankan migrasi 0081)." : m, "danger");
    } finally { setSimpan(false); }
  }

  async function jalankanUji() {
    setMenguji(true);
    try { setUji(await api.post<Uji>("/chat/uji-balasan", { text: contoh })); }
    catch (e) { toast((e as Error).message, "danger"); }
    finally { setMenguji(false); }
  }

  const jamOpsi = Array.from({ length: 24 }, (_, i) => i);

  return (
    <Card className="mt-3 p-4 space-y-4">
      {!s.tersimpan && (
        <div className="text-xs text-ink-3">Belum pernah disimpan — semua otomasi mati secara default.</div>
      )}
      <label className="flex items-start gap-2 text-sm text-ink">
        <input type="checkbox" className="mt-0.5" checked={s.autoReply} onChange={(e) => setS({ ...s, autoReply: e.target.checked })} />
        <span>
          <b>Balas otomatis</b> pesan pembeli yang cocok dengan Knowledge Base.
          <span className="block text-xs text-ink-3">Satu balasan per pesan; tidak membalas bila Anda sudah menjawab; pesan tanpa jawaban KB menunggu Anda.</span>
        </span>
      </label>

      <div>
        <div className="text-xs font-medium text-ink-2 mb-1">Berlaku untuk toko</div>
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={semua} onChange={(e) => setS({ ...s, autoReplyShopIds: e.target.checked ? null : izin.map((i) => i.shopId) })} />
            Semua toko
          </label>
          {izin.map((i) => (
            <label key={i.shopId} className={`flex items-center gap-1.5 ${semua ? "opacity-50" : ""}`}>
              <input type="checkbox" disabled={semua} checked={semua || pilih.has(i.shopId)}
                onChange={(e) => {
                  const n = new Set(pilih);
                  if (e.target.checked) n.add(i.shopId); else n.delete(i.shopId);
                  setS({ ...s, autoReplyShopIds: [...n] });
                }} />
              {i.shopName}
              <Badge tone={i.aktif ? "success" : "neutral"}>{i.aktif ? "izin aktif" : "belum berizin"}</Badge>
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[auto_1fr]">
        <div>
          <div className="text-xs font-medium text-ink-2 mb-1">Jam kerja (WIB)</div>
          <div className="flex items-center gap-2 text-sm">
            <select className="rounded-lg border border-line px-2 py-1.5 text-sm bg-white" value={s.officeStart ?? ""}
              onChange={(e) => setS({ ...s, officeStart: e.target.value === "" ? null : Number(e.target.value) })}>
              <option value="">24 jam</option>
              {jamOpsi.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
            </select>
            <span>–</span>
            <select className="rounded-lg border border-line px-2 py-1.5 text-sm bg-white" value={s.officeEnd ?? ""}
              disabled={s.officeStart == null}
              onChange={(e) => setS({ ...s, officeEnd: e.target.value === "" ? null : Number(e.target.value) })}>
              <option value="">—</option>
              {jamOpsi.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
            </select>
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-ink-2 mb-1">Pesan di luar jam kerja (bila KB tak cocok; maks 1× per 12 jam per pembeli)</div>
          <Textarea rows={2} value={s.fallbackText ?? ""} placeholder="Contoh: Halo kak, terima kasih pesannya 🙏 Admin kami online jam 08.00–17.00, pesan kakak akan kami balas secepatnya."
            onChange={(e) => setS({ ...s, fallbackText: e.target.value })} />
        </div>
      </div>

      <div className="flex justify-end">
        <Button variant="filled" loading={simpan} onClick={save}>Simpan pengaturan</Button>
      </div>

      <div className="border-t border-line pt-4">
        <div className="text-sm font-medium text-ink mb-1">Uji balasan otomatis</div>
        <div className="text-xs text-ink-3 mb-2">Ketik contoh pesan pembeli — lihat jawaban bot. Tidak mengirim apa pun ke TikTok.</div>
        <div className="flex gap-2">
          <Input value={contoh} onChange={(e) => setContoh(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") jalankanUji(); }} />
          <Button variant="tonal" loading={menguji} onClick={jalankanUji} disabled={!contoh.trim()}>Uji</Button>
        </div>
        {uji && (
          <div className={`mt-2 rounded-lg p-3 text-sm ${uji.akanDibalas ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
            <div className="font-medium">{uji.akanDibalas ? `Akan dibalas otomatis (${uji.sumber === "kb" ? "Knowledge Base" : "pesan luar jam"})` : "Tidak dibalas otomatis"}</div>
            {uji.balasan && <div className="mt-1 whitespace-pre-wrap">{uji.balasan}</div>}
            {uji.catatan && <div className="mt-1 text-xs opacity-80">{uji.catatan}</div>}
          </div>
        )}
      </div>
    </Card>
  );
}
