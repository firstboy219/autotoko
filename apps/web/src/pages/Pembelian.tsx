import { useState } from "react";
import { Layout } from "../components/Layout";
import { FileUpload } from "../components/FileUpload";
import { PurchaseEditor } from "../components/PurchaseEditor";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";
import { rupiah, dateShort } from "../lib/fmt";
import { Icon } from "../components/Icon";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  PageHeader,
  Select,
  SkeletonRows,
  Table,
  TableWrap,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from "../components/ui";

interface Material {
  id: string;
  name: string;
  unit: string | null;
  currentStock: number;
  unitCost: number;
  minimumThreshold: number;
  stockValue: number;
  usedByProducts: number;
  isLow: boolean;
}
interface PurchaseRow {
  id: string;
  purchasedAt: string;
  supplierName: string | null;
  totalCost: number;
  itemCount: number;
  /** Packages counted off the trolley, summed across the lines. */
  totalPcs: number | null;
  receiptUrl: string | null;
  /** Null for purchases typed into the form. */
  resi: string | null;
  source: string;
  isCod: boolean;
  codAmount: number | null;
}
interface ParsedItem {
  materialName: string;
  quantity: number;
  unit: string | null;
  totalCost: number;
  matchedMaterialId: string | null;
  matchedMaterialName: string | null;
}
/** A row in the review table — OCR proposes, the admin confirms. */
interface DraftLine {
  key: string;
  materialId: string | null;
  materialName: string;
  unit: string;
  quantity: string;
  totalCost: string;
}

let seq = 0;
const newKey = () => `l${++seq}`;

export function Pembelian() {
  const toast = useToast();
  const materials = useFetch<Material[]>("/materials");
  const purchases = useFetch<PurchaseRow[]>("/materials/purchases");

  const [receiptUrl, setReceiptUrl] = useState("");
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrNote, setOcrNote] = useState<string | null>(null);
  const [ocrRaw, setOcrRaw] = useState<unknown>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [purchasedAt, setPurchasedAt] = useState(new Date().toISOString().slice(0, 10));
  const [supplier, setSupplier] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** The purchase being corrected, or null when the list is just a list. */
  const [editing, setEditing] = useState<string | null>(null);

  const catalog = materials.data ?? [];

  async function onReceipt(url: string) {
    setReceiptUrl(url);
    setOcrBusy(true);
    setOcrNote(null);
    try {
      const r = await api.post<{ raw: string; items: ParsedItem[] }>("/materials/purchases/parse", {
        imageUrl: url,
      });
      setOcrRaw(r.raw);
      setLines(
        r.items.map((i) => ({
          key: newKey(),
          materialId: i.matchedMaterialId,
          materialName: i.matchedMaterialName ?? i.materialName,
          unit: i.unit ?? "",
          quantity: String(i.quantity),
          totalCost: String(i.totalCost),
        })),
      );
      setOcrNote(
        r.items.length
          ? `${r.items.length} baris terbaca — periksa dan koreksi sebelum disimpan.`
          : "Tidak ada baris yang terbaca. Tambahkan manual di bawah.",
      );
    } catch (e) {
      setOcrNote(`OCR gagal: ${(e as Error).message}. Tambahkan manual di bawah.`);
    } finally {
      setOcrBusy(false);
    }
  }

  function addLine() {
    setLines((s) => [
      ...s,
      { key: newKey(), materialId: null, materialName: "", unit: "", quantity: "", totalCost: "" },
    ]);
  }
  function setLine(key: string, patch: Partial<DraftLine>) {
    setLines((s) => s.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) {
    setLines((s) => s.filter((l) => l.key !== key));
  }

  const valid = lines.filter((l) => l.materialName.trim() && Number(l.quantity) > 0);
  const grandTotal = valid.reduce((n, l) => n + (Number(l.totalCost) || 0), 0);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await api.post("/materials/purchases", {
        purchasedAt,
        supplierName: supplier.trim() || undefined,
        receiptUrl: receiptUrl || undefined,
        ocrRaw,
        items: valid.map((l) => ({
          ...(l.materialId ? { materialId: l.materialId } : { materialName: l.materialName.trim() }),
          unit: l.unit.trim() || undefined,
          quantity: Number(l.quantity),
          totalCost: Number(l.totalCost) || 0,
        })),
      });
      toast(`${valid.length} bahan baku diperbarui`, "success");
      setLines([]);
      setReceiptUrl("");
      setOcrNote(null);
      setOcrRaw(null);
      setSupplier("");
      materials.reload();
      purchases.reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout title="Pembelian Stok">
      <PageHeader
        title="Pembelian Stok Bahan Baku"
        subtitle="Unggah screenshot order, periksa hasil bacanya, lalu simpan — stok dan harga rata-rata ikut diperbarui."
      />

      <div className="space-y-4">
        <Card padded={false}>
          <CardHeader
            title="Rekam Pembelian"
            subtitle="Bahan yang belum ada akan dibuatkan otomatis saat disimpan."
          />
          <div className="p-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Tanggal Pembelian" required>
                <Input type="date" value={purchasedAt} onChange={(e) => setPurchasedAt(e.target.value)} />
              </Field>
              <Field label="Supplier (opsional)">
                <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Nama toko/supplier" />
              </Field>
              <div className="sm:col-span-3">
                <FileUpload
                  label="Screenshot Order (opsional — nama bahan, qty & total akan dicoba dibaca otomatis)"
                  value={receiptUrl}
                  onChange={onReceipt}
                />
                {ocrBusy && (
                  <div className="flex items-center gap-1.5 text-xs text-ink-2 mt-1.5">
                    <Icon name="refresh" size={13} className="animate-spin" /> Membaca gambar…
                  </div>
                )}
                {ocrNote && !ocrBusy && <div className="text-xs text-ink-2 mt-1.5">{ocrNote}</div>}
              </div>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-ink">Baris Pembelian ({lines.length})</div>
                <Button size="sm" variant="tonal" icon="plus" onClick={addLine}>
                  Tambah Baris
                </Button>
              </div>

              {!lines.length ? (
                <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-ink-2">
                  Unggah screenshot di atas, atau tambahkan baris manual.
                </div>
              ) : (
                <>
                  <TableWrap>
                    <Table className="min-w-[760px]">
                      <THead>
                        <TR className="border-t-0">
                          <TH>Bahan Baku</TH>
                          <TH align="right">Qty</TH>
                          <TH>Satuan</TH>
                          <TH align="right">Total Harga</TH>
                          <TH align="right">Per Satuan</TH>
                          <TH align="right" />
                        </TR>
                      </THead>
                      <tbody>
                        {lines.map((l) => {
                          const qty = Number(l.quantity) || 0;
                          const tot = Number(l.totalCost) || 0;
                          return (
                            <TR key={l.key}>
                              <TD>
                                <Select
                                  value={l.materialId ?? "__new__"}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    if (v === "__new__") {
                                      setLine(l.key, { materialId: null });
                                    } else {
                                      const m = catalog.find((c) => c.id === v);
                                      setLine(l.key, {
                                        materialId: v,
                                        materialName: m?.name ?? l.materialName,
                                        unit: m?.unit ?? l.unit,
                                      });
                                    }
                                  }}
                                  className="mb-1.5"
                                >
                                  <option value="__new__">+ Bahan baru</option>
                                  {catalog.map((m) => (
                                    <option key={m.id} value={m.id}>{m.name}</option>
                                  ))}
                                </Select>
                                {!l.materialId && (
                                  <Input
                                    value={l.materialName}
                                    onChange={(e) => setLine(l.key, { materialName: e.target.value })}
                                    placeholder="Nama bahan baru"
                                  />
                                )}
                              </TD>
                              <TD align="right">
                                <Input
                                  inputMode="decimal"
                                  value={l.quantity}
                                  onChange={(e) => setLine(l.key, { quantity: e.target.value.replace(/[^\d.]/g, "") })}
                                  className="w-24 text-right tabular-nums"
                                />
                              </TD>
                              <TD>
                                <Input
                                  value={l.unit}
                                  onChange={(e) => setLine(l.key, { unit: e.target.value })}
                                  placeholder="kg"
                                  className="w-20"
                                />
                              </TD>
                              <TD align="right">
                                <Input
                                  inputMode="numeric"
                                  value={l.totalCost ? Number(l.totalCost).toLocaleString("id-ID") : ""}
                                  onChange={(e) => setLine(l.key, { totalCost: e.target.value.replace(/\D/g, "") })}
                                  className="w-32 text-right tabular-nums"
                                />
                              </TD>
                              <TD align="right" className="text-ink-2 tabular-nums whitespace-nowrap">
                                {qty > 0 ? rupiah(tot / qty) : "—"}
                              </TD>
                              <TD align="right">
                                <button
                                  onClick={() => removeLine(l.key)}
                                  className="p-1.5 rounded-full text-ink-3 hover:text-red-600 hover:bg-red-50"
                                  aria-label="Hapus baris"
                                >
                                  <Icon name="trash" size={16} />
                                </button>
                              </TD>
                            </TR>
                          );
                        })}
                      </tbody>
                    </Table>
                  </TableWrap>

                  {err && (
                    <div className="mt-3">
                      <InlineAlert tone="danger">{err}</InlineAlert>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
                    <div className="text-sm text-ink-2">
                      Total pembelian:{" "}
                      <span className="text-ink tabular-nums font-medium">{rupiah(grandTotal)}</span>
                    </div>
                    <Button
                      variant="filled"
                      icon="check"
                      loading={busy}
                      disabled={!valid.length}
                      onClick={submit}
                    >
                      Simpan & Update Stok ({valid.length})
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </Card>

        <Card padded={false}>
          <CardHeader
            title={`Stok Bahan Baku (${catalog.length})`}
            subtitle="Harga satuan adalah rata-rata tertimbang dari seluruh pembelian — dipakai untuk menghitung HPP."
          />
          <TableWrap>
            <Table className="min-w-[680px]">
              <THead>
                <TR className="border-t-0">
                  <TH>Bahan</TH>
                  <TH align="right">Stok</TH>
                  <TH align="right">Harga Satuan</TH>
                  <TH align="right">Nilai Stok</TH>
                  <TH align="right">Dipakai</TH>
                </TR>
              </THead>
              <tbody>
                {materials.loading ? (
                  <SkeletonRows n={4} cols={5} />
                ) : !catalog.length ? (
                  <TR>
                    <TD colSpan={5} className="p-0">
                      <EmptyState
                        icon="beaker"
                        title="Belum ada bahan baku"
                        description="Rekam pembelian di atas, atau tambahkan bahan lewat halaman HPP."
                      />
                    </TD>
                  </TR>
                ) : (
                  catalog.map((m) => (
                    <TR key={m.id}>
                      <TD>
                        <div className="text-ink">{m.name}</div>
                        {m.isLow && (
                          <div className="mt-1">
                            <Badge tone="warning">stok menipis</Badge>
                          </div>
                        )}
                      </TD>
                      <TD align="right" className="text-ink tabular-nums">
                        {m.currentStock.toLocaleString("id-ID")} {m.unit ?? ""}
                      </TD>
                      <TD align="right" className="text-ink-2 tabular-nums">{rupiah(m.unitCost)}</TD>
                      <TD align="right" className="text-ink-2 tabular-nums">{rupiah(m.stockValue)}</TD>
                      <TD align="right" className="text-ink-2">{m.usedByProducts} produk</TD>
                    </TR>
                  ))
                )}
              </tbody>
            </Table>
          </TableWrap>
        </Card>

        <Card padded={false}>
          <CardHeader title="Riwayat Pembelian" />
          <TableWrap>
            <Table className="min-w-[560px]">
              <THead>
                <TR className="border-t-0">
                  <TH>Tanggal</TH>
                  <TH>Supplier</TH>
                  <TH align="right">Item / pcs</TH>
                  <TH align="right">Total</TH>
                  <TH align="right">Bukti</TH>
                </TR>
              </THead>
              <tbody>
                {purchases.loading ? (
                  <SkeletonRows n={3} cols={5} />
                ) : !purchases.data?.length ? (
                  <TR>
                    <TD colSpan={5} className="p-0">
                      <EmptyState icon="fileText" title="Belum ada pembelian tercatat" />
                    </TD>
                  </TR>
                ) : (
                  purchases.data.map((p) => (
                    <TR
                      key={p.id}
                      onClick={() => setEditing(p.id)}
                      className="cursor-pointer hover:bg-canvas"
                    >
                      <TD className="text-ink">{dateShort(p.purchasedAt)}</TD>
                      <TD className="text-ink-2">
                        {p.supplierName ?? (p.resi ? "Bahan datang" : "—")}
                        {/* A scanned delivery has no supplier typed in, so
                            without the waybill it is an anonymous row nobody
                            can trace back to a parcel. */}
                        {p.resi && (
                          <div className="text-[11px] font-mono text-ink-3">{p.resi}</div>
                        )}
                        {p.isCod && (
                          <span className="inline-block mt-1">
                            <Badge tone="warning">
                              COD{p.codAmount ? ` ${rupiah(p.codAmount)}` : ""}
                            </Badge>
                          </span>
                        )}
                      </TD>
                      <TD align="right" className="text-ink-2 tabular-nums">
                        {p.itemCount}
                        {/* 6000 gram is what stock moved by; "2 pcs" is what
                            somebody counted off the trolley. Only the second
                            can be checked against the parcel. */}
                        {p.totalPcs ? (
                          <div className="text-[11px] text-ink-3">
                            {p.totalPcs.toLocaleString("id-ID")} pcs
                          </div>
                        ) : null}
                      </TD>
                      <TD align="right" className="text-ink tabular-nums">{rupiah(p.totalCost)}</TD>
                      <TD align="right">
                        {p.receiptUrl ? (
                          <a
                            href={p.receiptUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-brand-ink hover:underline"
                          >
                            <Icon name="image" size={14} /> Lihat
                          </a>
                        ) : (
                          <span className="text-ink-3">—</span>
                        )}
                      </TD>
                    </TR>
                  ))
                )}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      </div>

      {editing && (
        <PurchaseEditor
          purchaseId={editing}
          onClose={() => setEditing(null)}
          onChanged={() => {
            // Both lists move: the purchase list loses or changes a row, and
            // the catalogue's stock figures are what the correction was for.
            void purchases.reload();
            void materials.reload();
          }}
        />
      )}
    </Layout>
  );
}
