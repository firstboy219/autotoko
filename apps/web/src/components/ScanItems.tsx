import { useState } from "react";
import { api } from "../lib/api";
import { useFetch } from "../lib/useFetch";
import { Icon } from "./Icon";
import { Badge, Button, Input, InlineAlert, Select, useToast } from "./ui";

interface ScanItem {
  id: string;
  masterProductId: string | null;
  productName: string | null;
  productSku: string | null;
  rawName: string | null;
  rawQty: number | null;
  qty: number;
  isMapped: boolean;
}
interface MasterProduct {
  id: string;
  sku: string;
  name: string;
}

/**
 * What was actually in the parcel, mapped to the seller's own products.
 *
 * OCR seeds the lines where it manages to read them, but it is a starting
 * point and nothing more — on real photographs it often finds nothing, and the
 * label's wording ("mouthspray siwak") rarely matches the product name
 * ("Mouthspray Siwak 100ml") closely enough for an automatic guess to be worth
 * trusting. So the operator decides, and can add lines OCR never saw.
 *
 * What OCR read is kept beside the mapping rather than replaced, so a wrong
 * reading stays visible instead of being quietly overwritten by the correction.
 *
 * Every edit saves as it is made, which is convenient and is NOT the same as
 * anyone declaring the parcel finished with. That declaration is the button at
 * the bottom, and it is what the rest of the system treats as authoritative.
 */
export function ScanItemsEditor({
  scanId,
  confirmedAt,
  onConfirmed,
}: {
  scanId: string;
  /** ISO timestamp, or null while nobody has checked the contents. */
  confirmedAt?: string | null;
  onConfirmed?: () => void;
}) {
  const toast = useToast();
  const items = useFetch<ScanItem[]>(`/resi/scans/${scanId}/items`);
  const products = useFetch<MasterProduct[]>("/products");
  const [addProduct, setAddProduct] = useState("");
  const [addQty, setAddQty] = useState("1");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [justConfirmed, setJustConfirmed] = useState(false);

  const rows = items.data ?? [];
  const unmapped = rows.filter((r) => !r.isMapped).length;
  const confirmed = justConfirmed || Boolean(confirmedAt);
  const blocker =
    rows.length === 0
      ? "Belum ada isi paket yang bisa dikonfirmasi."
      : unmapped > 0
        ? `Masih ada ${unmapped} baris tanpa produk.`
        : null;

  async function add() {
    const q = Number(addQty);
    if (!addProduct || !Number.isFinite(q) || q <= 0) return;
    setBusy(true);
    try {
      await api.post(`/resi/scans/${scanId}/items`, { masterProductId: addProduct, qty: q });
      setAddProduct("");
      setAddQty("1");
      items.reload();
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setBusy(false);
    }
  }

  async function patch(item: ScanItem, body: Record<string, unknown>) {
    try {
      await api.patch(`/resi/scans/${scanId}/items/${item.id}`, body);
      items.reload();
    } catch (e) {
      toast((e as Error).message, "danger");
    }
  }

  async function remove(item: ScanItem) {
    try {
      await api.del(`/resi/scans/${scanId}/items/${item.id}`);
      items.reload();
    } catch (e) {
      toast((e as Error).message, "danger");
    }
  }

  async function confirm() {
    setConfirming(true);
    try {
      await api.post(`/resi/scans/${scanId}/items/confirm`, { by: "web" });
      setJustConfirmed(true);
      toast("Isi paket dikonfirmasi.", "success");
      onConfirmed?.();
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="rounded-lg border border-line bg-canvas p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink">Isi Paket</span>
        <div className="flex items-center gap-2">
          {unmapped > 0 && <Badge tone="warning">{unmapped} belum dipetakan</Badge>}
          {confirmed ? (
            <Badge tone="success">Sudah dikonfirmasi</Badge>
          ) : (
            <Badge tone="neutral">Belum dikonfirmasi</Badge>
          )}
        </div>
      </div>

      {items.loading ? (
        <div className="text-sm text-ink-3">Memuat…</div>
      ) : rows.length === 0 ? (
        <div className="mb-3 text-sm text-ink-3">
          Belum ada isi paket. Tambahkan di bawah — OCR sering tidak berhasil membaca
          daftar produk dari foto label.
        </div>
      ) : (
        <div className="mb-3 overflow-x-auto">
          {/* A table on desktop rather than a wrapping row of controls. The
              old layout put a product dropdown, a quantity box, the OCR text
              and a delete button on one flex line, which reflowed into a
              different shape for every row and gave the eye no column to
              scan down. */}
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-3">
                <th className="pb-1.5 font-medium">Produk</th>
                <th className="w-20 pb-1.5 text-right font-medium">Jumlah</th>
                <th className="pb-1.5 font-medium">Dibaca dari label</th>
                <th className="w-10 pb-1.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((it) => (
                <tr key={it.id} className="border-b border-line/60 last:border-0">
                  <td className="py-1.5 pr-2">
                    <Select
                      value={it.masterProductId ?? ""}
                      onChange={(e) => patch(it, { masterProductId: e.target.value || null })}
                      className="w-full"
                    >
                      <option value="">— pilih produk —</option>
                      {(products.data ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="py-1.5 pr-2">
                    <Input
                      inputMode="decimal"
                      defaultValue={String(it.qty)}
                      onBlur={(e) => {
                        const q = Number(e.target.value);
                        if (Number.isFinite(q) && q > 0 && q !== it.qty) patch(it, { qty: q });
                      }}
                      className="w-full text-right tabular-nums"
                    />
                  </td>
                  {/* Kept beside the mapping, not replaced by it: this is what
                      the label actually said, and it is the only way to see
                      later where the reading went wrong. */}
                  <td className="py-1.5 pr-2 text-xs text-ink-3">
                    {it.rawName ? (
                      <span title={it.rawName}>
                        {it.rawName}
                        {it.rawQty ? ` ×${it.rawQty}` : ""}
                      </span>
                    ) : (
                      <span className="text-ink-3">ditambahkan manual</span>
                    )}
                  </td>
                  <td className="py-1.5 text-right">
                    <button
                      onClick={() => remove(it)}
                      aria-label="Hapus baris"
                      className="rounded-full p-1 text-ink-3 transition hover:bg-red-50 hover:text-red-600"
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
        <div className="min-w-[200px] flex-1">
          <label className="mb-1 block text-xs text-ink-3">Tambah produk</label>
          <Select value={addProduct} onChange={(e) => setAddProduct(e.target.value)}>
            <option value="">— pilih produk —</option>
            {(products.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-20">
          <label className="mb-1 block text-xs text-ink-3">Jumlah</label>
          <Input
            inputMode="decimal"
            value={addQty}
            onChange={(e) => setAddQty(e.target.value.replace(/[^\d.]/g, ""))}
            className="text-right tabular-nums"
          />
        </div>
        <Button variant="outline" onClick={add} disabled={busy || !addProduct}>
          <Icon name="plus" className="h-3.5 w-3.5" />
          Tambah
        </Button>
      </div>

      {/* The submit this panel never had. Everything above saves as it is
          typed, so without this there was no moment at which anybody said the
          parcel was right — and no way for the rest of the system to tell a
          checked parcel from one still being filled in. */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <div className="text-xs text-ink-3">
          {confirmed
            ? "Isi paket sudah dikonfirmasi. Mengubahnya di sini tetap boleh."
            : (blocker ?? "Semua baris sudah punya produk.")}
        </div>
        <Button
          variant={confirmed ? "outline" : "filled"}
          onClick={confirm}
          loading={confirming}
          disabled={Boolean(blocker)}
        >
          <Icon name="check" className="h-3.5 w-3.5" />
          {confirmed ? "Konfirmasi ulang" : "Simpan & Konfirmasi Isi Paket"}
        </Button>
      </div>

      {!confirmed && blocker && rows.length > 0 && (
        <div className="mt-2">
          <InlineAlert tone="warning">{blocker}</InlineAlert>
        </div>
      )}
    </div>
  );
}
