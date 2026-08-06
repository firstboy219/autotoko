import { useState } from "react";
import { api } from "../lib/api";
import { useFetch } from "../lib/useFetch";
import { rupiah } from "../lib/fmt";
import { Icon } from "./Icon";
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  InlineAlert,
  Input,
  Select,
  SkeletonRows,
  Table,
  TableWrap,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from "./ui";

export interface PackingMaterial {
  id: string;
  materialId: string;
  name: string;
  unit: string | null;
  defaultQuantity: number;
  unitCost: number;
  currentStock: number;
}
interface CatalogMaterial {
  id: string;
  name: string;
  unit: string | null;
  unitCost: number;
}

/**
 * The shared packing list: which materials every shipment uses.
 *
 * Only the LIST and a starting amount live here. What each product actually
 * uses is set on that product's own HPP page, because a large item takes a
 * bigger box and more tape than a small one — the materials are shared, the
 * quantities are not.
 *
 * Cost is read from the material catalogue rather than typed in, so a price
 * change from a purchase reaches every product's HPP at once.
 */
export function PackingMaterialsCard() {
  const toast = useToast();
  const list = useFetch<PackingMaterial[]>("/costing/packing-materials");
  const catalog = useFetch<CatalogMaterial[]>("/materials");
  // Picking from the catalogue is the default and creating is the exception,
  // for the same reason it is on the recipe form: typing a name that already
  // exists is how "Dus" and "dus" become two materials with separate stock.
  const [mode, setMode] = useState<"pick" | "new">("pick");
  const [materialId, setMaterialId] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [cost, setCost] = useState("");
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);

  const rows = list.data ?? [];
  const used = new Set(rows.map((r) => r.materialId));
  const available = (catalog.data ?? []).filter((m) => !used.has(m.id));
  const totalDefault = rows.reduce((a, r) => a + r.defaultQuantity * r.unitCost, 0);

  const canAdd =
    Number(qty) > 0 && (mode === "pick" ? materialId !== "" : name.trim() !== "");

  async function add() {
    const q = Number(qty);
    if (!canAdd || !Number.isFinite(q) || q <= 0) return;
    setBusy(true);
    try {
      await api.post("/costing/packing-materials", {
        defaultQuantity: q,
        ...(mode === "pick"
          ? { materialId }
          : {
              materialName: name.trim(),
              unit: unit.trim() || undefined,
              unitCost: Number(cost) || 0,
            }),
      });
      setMaterialId("");
      setName("");
      setUnit("");
      setCost("");
      setQty("1");
      list.reload();
      catalog.reload();
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setBusy(false);
    }
  }

  async function saveDefault(row: PackingMaterial, value: string) {
    const q = Number(value);
    if (!Number.isFinite(q) || q <= 0 || q === row.defaultQuantity) return;
    try {
      await api.patch(`/costing/packing-materials/${row.id}`, { defaultQuantity: q });
      list.reload();
    } catch (e) {
      toast((e as Error).message, "danger");
    }
  }

  async function remove(row: PackingMaterial) {
    if (
      !window.confirm(
        `Hapus "${row.name}" dari daftar packing?\n\n` +
          "Bahannya tetap ada di katalog. Jumlah khusus yang sudah diatur di tiap produk untuk bahan ini ikut terhapus.",
      )
    ) {
      return;
    }
    try {
      await api.del(`/costing/packing-materials/${row.id}`);
      list.reload();
    } catch (e) {
      toast((e as Error).message, "danger");
    }
  }

  return (
    <Card padded={false} className="mb-5">
      <CardHeader
        title="Bahan Baku Packing"
        subtitle="Dipakai semua produk. Jumlah per produk diatur di halaman HPP produk masing-masing."
        action={
          rows.length > 0 ? (
            <span className="text-xs text-ink-2">
              Default: {rupiah(totalDefault)}/resi
            </span>
          ) : null
        }
      />

      <div className="px-5 py-3 border-b border-line">
        <div className="flex gap-2 mb-3">
          <Button
            type="button"
            variant={mode === "pick" ? "filled" : "outline"}
            onClick={() => setMode("pick")}
          >
            Dari Master Data
          </Button>
          <Button
            type="button"
            variant={mode === "new" ? "filled" : "outline"}
            onClick={() => setMode("new")}
          >
            Bahan Baru
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          {mode === "pick" ? (
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs text-ink-2 mb-1">Bahan dari katalog</label>
              <Select value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
                <option value="">Pilih bahan…</option>
                {available.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.unit ? ` (${m.unit})` : ""} — {rupiah(m.unitCost)}
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <>
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs text-ink-2 mb-1">Nama bahan</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="mis. Dus, Lakban, Bubble Wrap"
                />
              </div>
              <div className="w-24">
                <label className="block text-xs text-ink-2 mb-1">Satuan</label>
                <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="pcs" />
              </div>
              <div className="w-32">
                <label className="block text-xs text-ink-2 mb-1">Harga satuan</label>
                <Input
                  inputMode="numeric"
                  value={cost ? Number(cost).toLocaleString("id-ID") : ""}
                  onChange={(e) => setCost(e.target.value.replace(/\D/g, ""))}
                  placeholder="0"
                  className="tabular-nums"
                />
              </div>
            </>
          )}
          <div className="w-28">
            <label className="block text-xs text-ink-2 mb-1">Jumlah default</label>
            <Input
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ""))}
              className="tabular-nums"
            />
          </div>
          <Button variant="filled" onClick={add} disabled={busy || !canAdd}>
            <Icon name="plus" className="w-3.5 h-3.5" />
            Tambah
          </Button>
        </div>

        {mode === "new" && (
          <div className="text-[11px] text-ink-3 mt-2">
            Bahan ini ikut masuk ke master data. Kalau namanya sudah ada, yang lama yang
            dipakai — tidak dibuat ganda.
          </div>
        )}
      </div>

      {catalog.data && available.length === 0 && rows.length === 0 && (
        <div className="p-4">
          <InlineAlert tone="info">
            Belum ada bahan baku di katalog. Pakai tombol “Bahan Baru” di atas untuk membuatnya
            langsung di sini.
          </InlineAlert>
        </div>
      )}

      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>Bahan</TH>
              <TH className="text-right">Jumlah Default / resi</TH>
              <TH className="text-right">Harga Satuan</TH>
              <TH className="text-right">Biaya Default</TH>
              <TH className="text-right">Stok</TH>
              <TH />
            </TR>
          </THead>
          <tbody>
            {list.loading ? (
              <SkeletonRows n={3} cols={6} />
            ) : rows.length === 0 ? (
              <TR>
                <TD colSpan={6}>
                  <EmptyState
                    icon="package"
                    title="Belum ada bahan packing"
                    description="Tambahkan dus, lakban, bubble wrap, dan sejenisnya di atas."
                  />
                </TD>
              </TR>
            ) : (
              rows.map((r) => (
                <TR key={r.id}>
                  <TD>
                    {r.name}
                    {r.unit ? <span className="text-ink-2"> ({r.unit})</span> : null}
                  </TD>
                  <TD className="text-right">
                    <Input
                      inputMode="decimal"
                      defaultValue={String(r.defaultQuantity)}
                      onBlur={(e) => saveDefault(r, e.target.value)}
                      className="w-24 text-right tabular-nums"
                    />
                  </TD>
                  <TD className="text-right tabular-nums">{rupiah(r.unitCost)}</TD>
                  <TD className="text-right tabular-nums">
                    {rupiah(r.defaultQuantity * r.unitCost)}
                  </TD>
                  <TD className="text-right tabular-nums text-ink-2">{r.currentStock}</TD>
                  <TD className="text-right">
                    <Button variant="text" onClick={() => remove(r)}>
                      <Icon name="trash" className="w-3.5 h-3.5" />
                    </Button>
                  </TD>
                </TR>
              ))
            )}
          </tbody>
        </Table>
      </TableWrap>
    </Card>
  );
}
