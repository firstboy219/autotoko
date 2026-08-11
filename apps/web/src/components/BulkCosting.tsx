import { useState } from "react";
import { api } from "../lib/api";
import { Button, Field, InlineAlert, Input, Modal, useToast } from "./ui";

/**
 * One set of rates across many products.
 *
 * These numbers are the same for most of a catalogue and change together —
 * a marketplace raises its fee, an affiliate programme starts, the sedekah
 * share is agreed once. Editing them one product at a time is how they end up
 * inconsistent, and an inconsistent margin is one nobody trusts.
 *
 * A blank field is left alone rather than written as zero. That is the whole
 * safety of this screen: setting the affiliator rate on forty products must not
 * silently zero their ads rate because the form had a box for it.
 */

interface Field {
  key: string;
  label: string;
  hint?: string;
  /** Rates are entered as percentages and stored as fractions. */
  percent?: boolean;
}

const FIELDS: Field[] = [
  { key: "marketplaceFeeRate", label: "Fee marketplace", percent: true },
  { key: "affiliatorRate", label: "Afiliator", percent: true },
  { key: "adsRate", label: "Iklan (%)", percent: true },
  { key: "adsFixedPerPcs", label: "Iklan (Rp/pcs)", hint: "Selain persentase di atas" },
  { key: "eventRate", label: "Event / promo", percent: true },
  { key: "sedekahRate", label: "Sedekah", percent: true },
  { key: "resellerRate", label: "Reseller", percent: true },
  { key: "targetProfitRate", label: "Target profit", percent: true },
  { key: "serviceCostPerPcs", label: "Biaya jasa (Rp/pcs)" },
  { key: "packingCostPerOrder", label: "Biaya packing (Rp/order)" },
];

export function BulkCosting({
  productIds,
  onClose,
  onDone,
}: {
  productIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const filled = FIELDS.filter((f) => (values[f.key] ?? "").trim() !== "");

  async function save() {
    if (!filled.length) {
      toast("Isi minimal satu kolom.", "danger");
      return;
    }
    const body: Record<string, unknown> = { productIds };
    for (const f of filled) {
      const n = Number(values[f.key]);
      if (!Number.isFinite(n) || n < 0) {
        toast(`${f.label} bukan angka yang benar.`, "danger");
        return;
      }
      // Percentages are typed the way people say them and stored the way the
      // calculator wants them.
      body[f.key] = f.percent ? n / 100 : n;
    }

    setBusy(true);
    try {
      const r = await api.patch<{ updated: number }>("/costing/bulk", body);
      toast(`${r.updated} produk diperbarui.`, "success");
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, "danger");
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Ubah komposisi harga — ${productIds.length} produk`}
      width="max-w-2xl"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <div className="text-xs text-ink-3">
            {filled.length === 0
              ? "Belum ada kolom yang diisi."
              : `${filled.length} kolom akan diterapkan.`}
          </div>
          <div className="flex gap-2">
            <Button variant="text" onClick={onClose} disabled={busy}>
              Batal
            </Button>
            <Button variant="filled" onClick={save} loading={busy}>
              Terapkan ke {productIds.length} produk
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Said before the button rather than after the damage: this writes to
            every selected product at once and there is no undo. */}
        <InlineAlert tone="warning">
          Kolom yang <strong>dikosongkan tidak diubah</strong> — hanya yang Anda isi
          yang ditulis ke semua produk terpilih. Tidak ada pembatalan setelah disimpan.
        </InlineAlert>

        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <Field
              key={f.key}
              label={f.percent ? `${f.label} (%)` : f.label}
              hint={f.hint}
            >
              <Input
                value={values[f.key] ?? ""}
                inputMode="decimal"
                placeholder="biarkan kosong = tidak diubah"
                onChange={(e) =>
                  setValues((v) => ({ ...v, [f.key]: e.target.value.replace(/[^\d.]/g, "") }))
                }
                className="tabular-nums"
              />
            </Field>
          ))}
        </div>
      </div>
    </Modal>
  );
}
