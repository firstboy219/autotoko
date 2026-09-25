import { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { api } from "../lib/api";
import {
  Badge,
  Button,
  Card,
  InlineAlert,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from "../components/ui";

interface KbEntry {
  id: string;
  kind: "chat" | "review";
  keywords: string;
  answer: string;
  priority: number;
  active: boolean;
}

type Draft = { id?: string; kind: "chat" | "review"; keywords: string; answer: string; priority: number; active: boolean };
const KOSONG: Draft = { kind: "chat", keywords: "", answer: "", priority: 0, active: true };

export function Kb() {
  const toast = useToast();
  const [kind, setKind] = useState<"chat" | "review">("chat");
  const [rows, setRows] = useState<KbEntry[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [uji, setUji] = useState("");
  const [ujiHasil, setUjiHasil] = useState<{ matched: boolean; reply: string } | null>(null);
  const [ujiBusy, setUjiBusy] = useState(false);

  function muat() {
    setRows(null);
    api.get<KbEntry[]>(`/kb?kind=${kind}`).then(setRows).catch(() => setRows([]));
  }
  useEffect(() => { muat(); /* eslint-disable-next-line */ }, [kind]);

  async function simpan() {
    if (!draft) return;
    if (!draft.keywords.trim() || !draft.answer.trim()) { toast("Kata kunci & jawaban wajib diisi.", "warning"); return; }
    setBusy(true);
    try {
      const body = { kind: draft.kind, keywords: draft.keywords.trim(), answer: draft.answer.trim(), priority: draft.priority, active: draft.active };
      if (draft.id) await api.put(`/kb/${draft.id}`, body);
      else await api.post("/kb", body);
      toast("Tersimpan.", "success");
      setDraft(null);
      muat();
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setBusy(false);
    }
  }

  async function hapus(id: string) {
    if (!window.confirm("Hapus entri KB ini?")) return;
    try { await api.del(`/kb/${id}`); muat(); } catch (e) { toast((e as Error).message, "danger"); }
  }

  async function toggleAktif(r: KbEntry) {
    try { await api.put(`/kb/${r.id}`, { keywords: r.keywords, answer: r.answer, active: !r.active }); muat(); }
    catch (e) { toast((e as Error).message, "danger"); }
  }

  async function coba() {
    const t = uji.trim();
    if (!t) return;
    setUjiBusy(true);
    try {
      const r = await api.post<{ matched: boolean; reply: string }>("/kb/draft", { text: t, kind });
      setUjiHasil(r);
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setUjiBusy(false);
    }
  }

  return (
    <Layout title="Balasan Otomatis (KB)">
      <PageHeader
        title="Balasan Otomatis (KB)"
        subtitle="Basis pengetahuan buatanmu sendiri untuk menyusun balasan — tanpa biaya AI eksternal."
      />

      <InlineAlert tone="info">
        Tulis kata kunci &amp; jawaban. Saat ada chat/review masuk, sistem mencocokkan kata kunci lalu menyusun draf balasan.
        Pakai placeholder <b>{"{resi}"}</b>, <b>{"{status}"}</b>, <b>{"{pembeli}"}</b>, <b>{"{toko}"}</b> — otomatis diisi dari data order.
        Gunakan lewat tombol <b>Saran (KB)</b> di halaman Chat.
      </InlineAlert>

      <Card className="mt-4">
        <div className="text-sm font-medium text-ink mb-2">Uji balasan <span className="text-xs font-normal text-ink-3">(hasilnya juga tercatat di menu Autopilot)</span></div>
        <div className="flex gap-2">
          <Input
            value={uji}
            onChange={(e) => setUji(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void coba(); } }}
            placeholder={kind === "review" ? "Contoh isi review pembeli\u2026" : "Contoh pertanyaan pembeli\u2026"}
          />
          <Button variant="filled" loading={ujiBusy} onClick={() => void coba()} disabled={!uji.trim()}>Coba</Button>
        </div>
        {ujiHasil && (
          ujiHasil.matched ? (
            <div className="mt-2 rounded-lg bg-green-50 ring-1 ring-green-200 p-3 text-sm text-ink whitespace-pre-wrap">{ujiHasil.reply}</div>
          ) : (
            <div className="mt-2 text-sm text-ink-3">Tak ada entri KB yang cocok. Tambah/sesuaikan kata kunci di bawah.</div>
          )
        )}
      </Card>

      <div className="flex items-center gap-2 mt-4">
        {(["chat", "review"] as const).map((k) => (
          <Button key={k} size="sm" variant={k === kind ? "filled" : "outline"} onClick={() => { setKind(k); setDraft(null); }}>
            {k === "chat" ? "Chat pembeli" : "Balas review"}
          </Button>
        ))}
        <div className="flex-1" />
        <Button size="sm" variant="tonal" icon="plus" onClick={() => setDraft({ ...KOSONG, kind })}>Tambah</Button>
      </div>

      {draft && (
        <Card className="mt-3">
          <div className="space-y-2">
            <div>
              <label className="text-xs text-ink-2">Kata kunci pemicu (pisah dengan koma/spasi)</label>
              <Input value={draft.keywords} onChange={(e) => setDraft({ ...draft, keywords: e.target.value })}
                placeholder="mis. kapan dikirim, resi, dikirim kapan" />
            </div>
            <div>
              <label className="text-xs text-ink-2">Jawaban</label>
              <Textarea rows={3} value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })}
                placeholder="mis. Halo {pembeli}, pesanan {status}. Nomor resi: {resi}. Terima kasih ya!" />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs text-ink-2">Prioritas</label>
              <Input type="number" className="w-24" value={String(draft.priority)}
                onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) || 0 })} />
              <label className="inline-flex items-center gap-2 text-sm text-ink-2">
                <input type="checkbox" className="w-4 h-4 accent-brand" checked={draft.active}
                  onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
                Aktif
              </label>
              <div className="flex-1" />
              <Button variant="text" onClick={() => setDraft(null)} disabled={busy}>Batal</Button>
              <Button variant="filled" loading={busy} onClick={simpan}>Simpan</Button>
            </div>
          </div>
        </Card>
      )}

      <div className="mt-4 space-y-2">
        {rows === null ? (
          <Skeleton className="h-24 w-full" />
        ) : rows.length === 0 ? (
          <div className="text-sm text-ink-3 py-6 text-center">Belum ada entri. Klik “Tambah”.</div>
        ) : (
          rows.map((r) => (
            <Card key={r.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge tone={r.active ? "success" : "neutral"}>{r.active ? "aktif" : "nonaktif"}</Badge>
                    {r.priority > 0 && <Badge tone="info">prioritas {r.priority}</Badge>}
                    <span className="text-xs text-ink-3 truncate">{r.keywords}</span>
                  </div>
                  <div className="text-sm text-ink mt-1 whitespace-pre-wrap">{r.answer}</div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <button className="text-xs text-brand-ink hover:underline" onClick={() => setDraft({ ...r })}>Edit</button>
                  <button className="text-xs text-ink-2 hover:underline" onClick={() => toggleAktif(r)}>{r.active ? "Nonaktifkan" : "Aktifkan"}</button>
                  <button className="text-xs text-danger hover:underline" onClick={() => hapus(r.id)}>Hapus</button>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </Layout>
  );
}
