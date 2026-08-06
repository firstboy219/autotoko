import { useState } from "react";
import { api } from "../lib/api";
import { useFetch } from "../lib/useFetch";
import { Icon } from "./Icon";
import { Badge, Button, Input, Select, useToast } from "./ui";

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
 * point and nothing more — on real photographs it often finds nothing, and
 * the label's wording ("mouthspray siwak") rarely matches the product name
 * ("Mouthspray Siwak 100ml") closely enough for an automatic guess to be
 * worth trusting. So the operator decides, and can add lines OCR never saw.
 *
 * What OCR read is kept beside the mapping rather than replaced, so a wrong
 * reading stays visible instead of being quietly overwritten by the correction.
 */
export function ScanItemsEditor({ scanId }: { scanId: string }) {
  const toast = useToast();
  const items = useFetch<ScanItem[]>(`/resi/scans/${scanId}/items`);
  const products = useFetch<MasterProduct[]>("/products");
  const [addProduct, setAddProduct] = useState("");
  const [addQty, setAddQty] = useState("1");
  const [busy, setBusy] = useState(false);

  const rows = items.data ?? [];
  const unmapped = rows.filter((r) => !r.isMapped).length;

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

  return (
    <div className="rounded-lg border border-line bg-canvas p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-ink-2">Isi Paket</span>
        {unmapped > 0 && <Badge tone="warning">{unmapped} belum dipetakan</Badge>}
      </div>

      {items.loading ? (
        <div className="text-xs text-ink-3">Memuat…</div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-ink-3 mb-2">
          Belum ada isi paket. Tambahkan di bawah — OCR sering tidak berhasil membaca daftar
          produk dari foto label.
        </div>
      ) : (
        <div className="space-y-1.5 mb-2">
          {rows.map((it) => (
            <div key={it.id} className="flex flex-wrap items-center gap-1.5">
              <Select
                value={it.masterProductId ?? ""}
                onChange={(e) => patch(it, { masterProductId: e.target.value || null })}
                className="flex-1 min-w-[180px]"
              >
                <option value="">— pilih produk —</option>
                {(products.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <Input
                inputMode="decimal"
                defaultValue={String(it.qty)}
                onBlur={(e) => {
                  const q = Number(e.target.value);
                  if (Number.isFinite(q) && q > 0 && q !== it.qty) patch(it, { qty: q });
                }}
                className="w-16 text-right tabular-nums"
              />
              {/* Kept beside the mapping, not replaced by it: this is what the
                  label actually said, and it is the only way to see later
                  where the reading went wrong. */}
              {it.rawName && (
                <span
                  className="text-[10px] text-ink-3 truncate max-w-[150px]"
                  title={`OCR membaca: ${it.rawName}${it.rawQty ? ` x${it.rawQty}` : ""}`}
                >
                  dari label: {it.rawName}
                  {it.rawQty ? ` x${it.rawQty}` : ""}
                </span>
              )}
              <button
                onClick={() => remove(it)}
                aria-label="Hapus baris"
                className="p-1 rounded-full text-ink-3 hover:text-red-600 hover:bg-red-50 transition"
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-line">
        <Select
          value={addProduct}
          onChange={(e) => setAddProduct(e.target.value)}
          className="flex-1 min-w-[180px]"
        >
          <option value="">Tambah produk…</option>
          {(products.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Input
          inputMode="decimal"
          value={addQty}
          onChange={(e) => setAddQty(e.target.value.replace(/[^\d.]/g, ""))}
          className="w-16 text-right tabular-nums"
        />
        <Button variant="outline" onClick={add} disabled={busy || !addProduct}>
          <Icon name="plus" className="w-3.5 h-3.5" />
          Tambah
        </Button>
      </div>
    </div>
  );
}
