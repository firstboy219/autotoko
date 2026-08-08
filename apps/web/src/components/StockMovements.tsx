import { useState } from "react";
import { api } from "../lib/api";
import { useFetch } from "../lib/useFetch";
import { dateShort } from "../lib/fmt";
import { Icon } from "./Icon";
import { Badge, Button, Field, InlineAlert, Input, Modal, Select, useToast } from "./ui";

/**
 * Where a material's stock came from and where it went.
 *
 * The number on the BOM page is a running total, and a running total on its own
 * cannot be argued with — when the shelf says one thing and the screen says
 * another there is nowhere to look. Every movement is already recorded; this is
 * the first thing that shows them.
 */

interface Movement {
  id: string;
  quantity: number;
  balance: number;
  reason: string;
  refTable: string | null;
  refId: string | null;
  note: string | null;
  createdAt: string;
  /** Only hand-entered rows may be changed here; see the note below. */
  editable: boolean;
}

interface Ledger {
  material: { id: string; name: string; unit: string | null; currentStock: number };
  outOfSync: boolean;
  ledgerTotal: number;
  movements: Movement[];
}

/** What each kind of movement is, said in the seller's own terms. */
const REASON: Record<string, { label: string; tone: "success" | "warning" | "info" | "neutral" }> = {
  delivery: { label: "Bahan datang (scan APK)", tone: "success" },
  purchase: { label: "Pembelian stok", tone: "success" },
  resi_scan: { label: "Terpakai — resi packing", tone: "warning" },
  reversal: { label: "Pembatalan", tone: "info" },
  adjustment: { label: "Penyesuaian manual", tone: "neutral" },
};

function num(v: number, unit: string | null) {
  const s = v.toLocaleString("id-ID", { maximumFractionDigits: 3 });
  return unit ? `${s} ${unit}` : s;
}

export function StockMovements({
  materialId,
  onClose,
  onChanged,
}: {
  materialId: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const toast = useToast();
  const ledger = useFetch<Ledger>(`/materials/${materialId}/movements`);
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Movement | null>(null);

  const d = ledger.data;
  const unit = d?.material.unit ?? null;

  async function add() {
    const v = Number(amount);
    if (!Number.isFinite(v) || v <= 0) {
      toast("Isi jumlahnya dulu.", "danger");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/materials/${materialId}/movements`, {
        // The sign is the direction, chosen above rather than typed. A minus
        // sign is easy to leave off and impossible to see afterwards.
        quantity: direction === "in" ? v : -v,
        note: note.trim() || undefined,
      });
      setAmount("");
      setNote("");
      ledger.reload();
      onChanged?.();
      toast("Mutasi dicatat.", "success");
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(m: Movement, quantity: number, newNote: string) {
    try {
      await api.patch(`/materials/movements/${m.id}`, { quantity, note: newNote });
      setEditing(null);
      ledger.reload();
      onChanged?.();
    } catch (e) {
      toast((e as Error).message, "danger");
    }
  }

  async function remove(m: Movement) {
    if (!window.confirm("Hapus mutasi ini? Stok akan disesuaikan kembali.")) return;
    try {
      await api.del(`/materials/movements/${m.id}`);
      ledger.reload();
      onChanged?.();
    } catch (e) {
      toast((e as Error).message, "danger");
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={d ? `Mutasi Stok — ${d.material.name}` : "Mutasi Stok"}
      width="max-w-4xl"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <div className="text-sm text-ink-2">
            {d ? (
              <>
                Stok sekarang <strong>{num(d.material.currentStock, unit)}</strong>
              </>
            ) : null}
          </div>
          <Button variant="text" onClick={onClose}>
            Tutup
          </Button>
        </div>
      }
    >
      {ledger.loading ? (
        <div className="py-6 text-center text-sm text-ink-3">Memuat…</div>
      ) : !d ? (
        <div className="py-6 text-center text-sm text-danger">Gagal memuat mutasi.</div>
      ) : (
        <div className="space-y-4">
          {/* Should never appear. Shown rather than quietly reconciled: the
              gap is evidence of a bug, and hiding it destroys the only trace. */}
          {d.outOfSync && (
            <InlineAlert tone="danger">
              Total stok ({num(d.material.currentStock, unit)}) tidak sama dengan jumlah
              mutasi ({num(d.ledgerTotal, unit)}). Laporkan ini — selisihnya menandakan ada
              perubahan stok yang tidak tercatat.
            </InlineAlert>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-3">
                  <th className="pb-2 font-medium">Waktu</th>
                  <th className="pb-2 font-medium">Sebab</th>
                  <th className="pb-2 text-right font-medium">Perubahan</th>
                  <th className="pb-2 text-right font-medium">Saldo</th>
                  <th className="pb-2 font-medium">Catatan</th>
                  <th className="w-16 pb-2" />
                </tr>
              </thead>
              <tbody>
                {d.movements.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-ink-3">
                      Belum ada mutasi tercatat untuk bahan ini.
                    </td>
                  </tr>
                ) : (
                  d.movements.map((m) => {
                    const r = REASON[m.reason] ?? { label: m.reason, tone: "neutral" as const };
                    return (
                      <tr key={m.id} className="border-b border-line/60 last:border-0">
                        <td className="whitespace-nowrap py-2 text-ink-2">
                          {dateShort(m.createdAt)}
                        </td>
                        <td className="py-2">
                          <Badge tone={r.tone}>{r.label}</Badge>
                        </td>
                        <td
                          className={`py-2 text-right tabular-nums ${
                            m.quantity >= 0 ? "text-emerald-600" : "text-red-600"
                          }`}
                        >
                          {m.quantity >= 0 ? "+" : ""}
                          {num(m.quantity, null)}
                        </td>
                        <td className="py-2 text-right tabular-nums text-ink">
                          {num(m.balance, null)}
                        </td>
                        <td className="py-2 text-xs text-ink-2">{m.note ?? "—"}</td>
                        <td className="py-2 text-right">
                          {m.editable ? (
                            <div className="flex justify-end gap-1">
                              <button
                                onClick={() => setEditing(m)}
                                aria-label="Ubah"
                                className="rounded p-1 text-ink-3 hover:text-brand-ink"
                              >
                                <Icon name="pencil" size={14} />
                              </button>
                              <button
                                onClick={() => remove(m)}
                                aria-label="Hapus"
                                className="rounded p-1 text-ink-3 hover:text-red-600"
                              >
                                <Icon name="trash" size={14} />
                              </button>
                            </div>
                          ) : (
                            <span
                              className="text-[11px] text-ink-3"
                              title="Berasal dari pembelian atau scan resi — ubah di dokumen asalnya supaya keduanya tetap sama."
                            >
                              terkunci
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* A stocktake finds more or less than the books say; a bottle gets
              dropped; something is taken as a sample. None of these has a
              document, and the old answer was to overwrite the stock figure —
              which changes the number and destroys the reason. */}
          <div className="rounded-lg border border-line p-3">
            <div className="mb-2 text-sm font-medium text-ink">Catat penyesuaian</div>
            <div className="grid gap-2 sm:grid-cols-4">
              <Field label="Arah">
                <Select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as "in" | "out")}
                >
                  <option value="in">Stok bertambah</option>
                  <option value="out">Stok berkurang</option>
                </Select>
              </Field>
              <Field label={`Jumlah${unit ? ` (${unit})` : ""}`}>
                <Input
                  value={amount}
                  inputMode="decimal"
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                  className="text-right tabular-nums"
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Alasan">
                  <Input
                    value={note}
                    placeholder="mis. stok opname, tumpah, dipakai sampel"
                    onChange={(e) => setNote(e.target.value)}
                  />
                </Field>
              </div>
            </div>
            <div className="mt-2 flex justify-end">
              <Button variant="filled" onClick={add} loading={busy}>
                Simpan mutasi
              </Button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <EditMovement
          movement={editing}
          unit={unit}
          onCancel={() => setEditing(null)}
          onSave={saveEdit}
        />
      )}
    </Modal>
  );
}

function EditMovement({
  movement,
  unit,
  onCancel,
  onSave,
}: {
  movement: Movement;
  unit: string | null;
  onCancel: () => void;
  onSave: (m: Movement, quantity: number, note: string) => void;
}) {
  const [direction, setDirection] = useState<"in" | "out">(
    movement.quantity >= 0 ? "in" : "out",
  );
  const [amount, setAmount] = useState(String(Math.abs(movement.quantity)));
  const [note, setNote] = useState(movement.note ?? "");

  return (
    <Modal
      open
      onClose={onCancel}
      title="Ubah mutasi"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="text" onClick={onCancel}>
            Batal
          </Button>
          <Button
            variant="filled"
            onClick={() => {
              const v = Number(amount);
              if (!Number.isFinite(v) || v <= 0) return;
              onSave(movement, direction === "in" ? v : -v, note);
            }}
          >
            Simpan
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Arah">
          <Select value={direction} onChange={(e) => setDirection(e.target.value as "in" | "out")}>
            <option value="in">Stok bertambah</option>
            <option value="out">Stok berkurang</option>
          </Select>
        </Field>
        <Field label={`Jumlah${unit ? ` (${unit})` : ""}`}>
          <Input
            value={amount}
            inputMode="decimal"
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            className="text-right tabular-nums"
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Alasan">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
