import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useFetch } from "../lib/useFetch";
import { Icon } from "./Icon";
import { Badge, Button, Input, Select, useToast } from "./ui";

interface LabelFields {
  orderNo: string | null;
  recipient: string | null;
  recipientArea: string | null;
  recipientAddress: string | null;
  senderName: string | null;
  senderArea: string | null;
  marketplace: string | null;
  service: string | null;
  weightKg: number | null;
  cod: boolean | null;
  sortCode: string | null;
  packageId: string | null;
  buyerNickname: string | null;
  qtyTotal: number | null;
  shipDate: string | null;
}
interface LabelDetail {
  id: string;
  resi: string;
  ocr: {
    status: string;
    attempts: number;
    at: string | null;
    confidence: number | null;
    text: string | null;
    textLength: number;
    canRecheck: boolean;
  };
  editedAt: string | null;
  label: LabelFields;
}

type Draft = Record<string, string>;

/** Text fields, in the order they are printed on the label. */
const FIELDS: { key: keyof LabelFields; label: string; hint?: string; wide?: boolean }[] = [
  { key: "senderName", label: "Nama toko (pengirim)" },
  { key: "senderArea", label: "Kota asal" },
  { key: "recipient", label: "Penerima" },
  { key: "recipientArea", label: "Wilayah tujuan", hint: "Provinsi, kota, kecamatan" },
  { key: "recipientAddress", label: "Alamat tujuan", wide: true },
  { key: "orderNo", label: "Nomor pesanan" },
  { key: "packageId", label: "Package ID" },
  { key: "buyerNickname", label: "Nickname pembeli" },
  { key: "service", label: "Layanan", hint: "ECO, EZ, REG" },
  { key: "sortCode", label: "Kode sortir", hint: "mis. 260-BKH08-05" },
  { key: "shipDate", label: "Tanggal kirim" },
];

const MARKETPLACES = ["tokopedia", "shopee", "tiktok", "lazada", "bukalapak", "blibli"];

function toDraft(l: LabelFields): Draft {
  const d: Draft = {};
  for (const [k, v] of Object.entries(l)) d[k] = v == null ? "" : String(v);
  d.cod = l.cod == null ? "" : l.cod ? "ya" : "tidak";
  return d;
}

/**
 * What the shipping label says — as read, and as corrected.
 *
 * The editing half is not a convenience. Tesseract reports 32-50% confidence
 * on these photographs and reads the small print essentially never: the order
 * number, the shop, the recipient and the product table come back empty on
 * every scan recorded so far. Without a keyboard route these columns would
 * stay empty forever and the information would exist only inside a JPEG.
 *
 * Saving stamps the record as edited, which stops the background reader from
 * replacing a typed-in fact with its next guess.
 */
export function ScanLabelEditor({ scanId, onSaved }: { scanId: string; onSaved?: () => void }) {
  const toast = useToast();
  const detail = useFetch<LabelDetail>(`/resi/scans/${scanId}/label`);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<LabelFields | null>(null);
  const [busy, setBusy] = useState(false);
  const [showText, setShowText] = useState(false);

  const data = detail.data;

  // Re-seeded whenever a fetch returns, compared by identity because useFetch
  // hands back a fresh object each time. Seeding only once instead would leave
  // the form showing the values from before a save: the reload is asynchronous,
  // so at the moment the draft is cleared the old response is still in hand.
  useEffect(() => {
    if (data && data.label !== saved) {
      setSaved(data.label);
      setDraft(toDraft(data.label));
    }
  }, [data, saved]);

  if (detail.loading || !data || !draft) {
    return <div className="rounded-lg border border-line bg-canvas p-3 text-xs text-ink-3">Memuat…</div>;
  }

  const set = (k: string, v: string) => setDraft({ ...draft, [k]: v });
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(data.label));

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {};
      for (const f of FIELDS) {
        const v = (draft[f.key] ?? "").trim();
        body[f.key] = v === "" ? null : v;
      }
      body.marketplace = draft.marketplace || null;
      body.cod = draft.cod === "" ? null : draft.cod === "ya";
      for (const k of ["weightKg", "qtyTotal"] as const) {
        const v = (draft[k] ?? "").trim();
        const n = Number(v);
        body[k] = v !== "" && Number.isFinite(n) ? n : null;
      }
      await api.patch(`/resi/scans/${scanId}/label`, body);
      detail.reload();
      onSaved?.();
      toast("Data label disimpan.", "success");
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setBusy(false);
    }
  }

  async function recheck() {
    setBusy(true);
    try {
      await api.post(`/resi/scans/${scanId}/recheck-ocr`, {});
      detail.reload();
      onSaved?.();
      toast("Foto masuk antrean untuk dibaca ulang.", "success");
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setBusy(false);
    }
  }

  const conf = data.ocr.confidence;

  return (
    <div className="rounded-lg border border-line bg-canvas p-3">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs font-medium text-ink-2">Data Label</span>

        {data.editedAt ? (
          <Badge tone="success">sudah dikoreksi manual</Badge>
        ) : data.ocr.status === "pending" ? (
          <Badge tone="info">menunggu dibaca</Badge>
        ) : data.ocr.status === "failed" ? (
          <Badge tone="danger">gagal dibaca</Badge>
        ) : null}

        {conf != null && !data.editedAt && (
          <Badge tone={conf >= 70 ? "success" : conf >= 55 ? "warning" : "danger"}>
            keyakinan OCR {conf.toFixed(0)}%
          </Badge>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {data.ocr.canRecheck && (
            <Button variant="outline" onClick={recheck} disabled={busy}>
              <Icon name="refresh" className="w-3.5 h-3.5" />
              Periksa Ulang OCR
            </Button>
          )}
          <Button onClick={save} disabled={busy || !dirty}>
            Simpan
          </Button>
        </div>
      </div>

      {conf != null && conf < 55 && !data.editedAt && (
        <div className="mb-3 text-[11px] text-ink-2 leading-relaxed">
          Keyakinan pembacaan rendah. Tulisan kecil pada resi (nomor pesanan, nama toko,
          penerima) hampir selalu tidak terbaca dari foto — isi manual di bawah, lalu simpan.
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {FIELDS.map((f) => (
          <label key={f.key} className={f.wide ? "sm:col-span-2" : undefined}>
            <span className="block text-[11px] text-ink-2 mb-0.5">{f.label}</span>
            <Input
              value={draft[f.key] ?? ""}
              onChange={(e) => set(f.key, e.target.value)}
              placeholder={f.hint ?? "—"}
              className="w-full"
            />
          </label>
        ))}

        <label>
          <span className="block text-[11px] text-ink-2 mb-0.5">Marketplace</span>
          <Select
            value={draft.marketplace ?? ""}
            onChange={(e) => set("marketplace", e.target.value)}
            className="w-full"
          >
            <option value="">—</option>
            {MARKETPLACES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </label>

        <label>
          <span className="block text-[11px] text-ink-2 mb-0.5">COD</span>
          <Select value={draft.cod ?? ""} onChange={(e) => set("cod", e.target.value)} className="w-full">
            <option value="">—</option>
            <option value="ya">COD</option>
            <option value="tidak">Bukan COD</option>
          </Select>
        </label>

        <label>
          <span className="block text-[11px] text-ink-2 mb-0.5">Berat (kg)</span>
          <Input
            inputMode="decimal"
            value={draft.weightKg ?? ""}
            onChange={(e) => set("weightKg", e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="0.159"
            className="w-full text-right tabular-nums"
          />
        </label>

        <label>
          <span className="block text-[11px] text-ink-2 mb-0.5">Total qty</span>
          <Input
            inputMode="decimal"
            value={draft.qtyTotal ?? ""}
            onChange={(e) => set("qtyTotal", e.target.value.replace(/[^\d.]/g, ""))}
            className="w-full text-right tabular-nums"
          />
        </label>
      </div>

      {/* The raw text is the only way to tell "the photo is unreadable" from
          "the parser missed it", and that decides whether the operator retakes
          the photo or just types the value in. */}
      {data.ocr.text && (
        <div className="mt-3 pt-2 border-t border-line">
          <button
            onClick={() => setShowText(!showText)}
            className="text-[11px] text-ink-2 hover:text-ink"
          >
            {showText ? "Sembunyikan" : "Lihat"} teks mentah OCR ({data.ocr.textLength} karakter)
          </button>
          {showText && (
            <pre className="mt-2 max-h-56 overflow-auto rounded bg-surface p-2 text-[10px] leading-snug whitespace-pre-wrap text-ink-2">
              {data.ocr.text}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
