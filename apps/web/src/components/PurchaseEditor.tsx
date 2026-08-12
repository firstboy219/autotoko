import { useEffect, useState } from "react";
import { convertUnit, compatibleUnits } from "@autotoko/shared";
import { api } from "../lib/api";
import { useFetch } from "../lib/useFetch";
import { rupiah } from "../lib/fmt";
import { Badge, Button, Field, Input, InlineAlert, Modal, Select } from "./ui";

/**
 * Correcting a recorded parcel.
 *
 * A delivery is reported by somebody holding a box at a bench, in a hurry, from
 * a phone. They will pick the wrong material, mistype a count, or scan the same
 * parcel twice. Until this existed the only correction was editing the stock
 * figure by hand to a number worked out on paper — which is how a shelf and its
 * record stop agreeing, permanently and invisibly.
 */

interface Line {
  id: string;
  materialId: string;
  materialName: string;
  unit: string | null;
  quantity: number;
  qtyPcs: number | null;
  contentPerPcs: number | null;
  enteredContent: number | null;
  enteredUnit: string | null;
  totalCost: number;
}

interface Detail {
  id: string;
  purchasedAt: string;
  supplierName: string | null;
  note: string | null;
  totalCost: number;
  resi: string | null;
  source: string;
  isCod: boolean;
  codAmount: number | null;
  orderPhotoUrl: string | null;
  items: Line[];
}

interface CatalogMaterial {
  id: string;
  name: string;
  unit: string | null;
}

interface Draft {
  materialId: string;
  materialName: string;
  unit: string | null;
  qtyPcs: string;
  content: string;
  contentUnit: string;
  totalCost: string;
}

function toDraft(l: Line): Draft {
  return {
    materialId: l.materialId,
    materialName: l.materialName,
    unit: l.unit,
    qtyPcs: String(l.qtyPcs ?? 1),
    // What was typed, not what it became: somebody who entered "1 kg" should
    // see "1 kg" when they come back to check it, not "1000".
    content: String(l.enteredContent ?? l.contentPerPcs ?? 1),
    contentUnit: l.enteredUnit ?? l.unit ?? "",
    totalCost: l.totalCost ? String(l.totalCost) : "",
  };
}

export function PurchaseEditor({
  purchaseId,
  onClose,
  onChanged,
}: {
  purchaseId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [supplier, setSupplier] = useState("");
  const [purchasedAt, setPurchasedAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** The order screenshot: what was ordered and for how much. */
  const [orderPhoto, setOrderPhoto] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  /** What the reading found, shown before it is trusted. */
  const [readNote, setReadNote] = useState<string | null>(null);
  /** The whole catalogue, so a line can be pointed somewhere else entirely. */
  const catalog = useFetch<CatalogMaterial[]>("/materials");

  useEffect(() => {
    let alive = true;
    api
      .get<Detail>(`/materials/purchases/${purchaseId}`)
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        setDrafts(d.items.map(toDraft));
        setSupplier(d.supplierName ?? "");
        setPurchasedAt(d.purchasedAt);
        setOrderPhoto(d.orderPhotoUrl ?? null);
      })
      .catch((e) => alive && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [purchaseId]);

  function patch(i: number, next: Partial<Draft>) {
    setDrafts((ds) => ds.map((d, n) => (n === i ? { ...d, ...next } : d)));
  }

  /**
   * Repoint a line at a different material.
   *
   * The unit travels with it: glycerine is held in gram and jojoba oil in ml,
   * so keeping the old unit would leave the line converting into something the
   * new material is not measured in. The entered amount is kept — the packer
   * counted that off the box and it is still true.
   */
  function repoint(i: number, materialId: string) {
    const m = (catalog.data ?? []).find((x) => x.id === materialId);
    if (!m) return;
    patch(i, {
      materialId: m.id,
      materialName: m.name,
      unit: m.unit,
      contentUnit: m.unit ?? "",
    });
  }

  /** A line the parcel held that nobody recorded. */
  function addLine() {
    const m = (catalog.data ?? [])[0];
    if (!m) return;
    setDrafts((ds) => [
      ...ds,
      {
        materialId: m.id,
        materialName: m.name,
        unit: m.unit,
        qtyPcs: "1",
        content: "1",
        contentUnit: m.unit ?? "",
        totalCost: "",
      },
    ]);
  }

  /** What a line will actually put on the shelf, in the catalogue's unit. */
  function resolved(d: Draft): number | null {
    const pcs = Number(d.qtyPcs);
    if (!Number.isFinite(pcs) || pcs <= 0) return null;
    const content = Number(d.content);
    const per = convertUnit(
      Number.isFinite(content) && content > 0 ? content : 1,
      d.contentUnit || d.unit,
      d.unit,
    );
    return per === null ? null : pcs * per;
  }

  /**
   * Attach an order screenshot, and let it fill what it can.
   *
   * The same endpoint the phone uses: it stores first and reads second, so a
   * screenshot the reader makes nothing of is still kept as the evidence of
   * what was ordered and what it cost. Nothing it reads is applied silently —
   * the prices it touches are the ones the HPP is built from.
   */
  async function attachPhoto(file: File) {
    setReading(true);
    setErr(null);
    setReadNote(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onerror = () => reject(new Error("Gambar tidak terbaca."));
        r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
        r.readAsDataURL(file);
      });
      const res = await api.post<{
        url: string;
        items?: {
          quantity?: number;
          totalCost?: number;
          matchedMaterialId?: string | null;
          matchedMaterialName?: string | null;
        }[];
      }>("/materials/purchases/scan-order", { photoBase64: base64 });
      setOrderPhoto(res.url);

      const read = res.items ?? [];
      let filled = 0;
      setDrafts((ds) =>
        ds.map((d) => {
          const hit = read.find((r) => r.matchedMaterialId === d.materialId);
          if (!hit) return d;
          filled++;
          return {
            ...d,
            qtyPcs: hit.quantity && hit.quantity > 0 ? String(hit.quantity) : d.qtyPcs,
            totalCost:
              hit.totalCost && hit.totalCost > 0 ? String(hit.totalCost) : d.totalCost,
          };
        }),
      );
      setReadNote(
        filled
          ? `Foto tersimpan. ${filled} baris terisi dari bacaan — periksa sebelum simpan.`
          : "Foto tersimpan, tapi jumlah dan nominal tidak terbaca — isi manual.",
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
    }
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api.patch(`/materials/purchases/${purchaseId}`, {
        purchasedAt,
        supplierName: supplier,
        orderPhotoUrl: orderPhoto ?? "",
        items: drafts.map((d) => ({
          materialId: d.materialId,
          qtyPcs: Number(d.qtyPcs) || 1,
          contentPerPcs: Number(d.content) || 1,
          contentUnit: d.contentUnit || undefined,
          totalCost: d.totalCost ? Number(d.totalCost) : undefined,
        })),
      });
      onChanged();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function remove() {
    // Spelled out, because it is not only a row disappearing: the shelf moves.
    const ok = window.confirm(
      "Hapus pembelian ini?\n\n" +
        "Stok bahan baku yang ditambahkan pembelian ini akan dikurangi kembali, " +
        "dan harga rata-rata dihitung ulang dari pembelian yang tersisa.",
    );
    if (!ok) return;
    setBusy(true);
    try {
      await api.del(`/materials/purchases/${purchaseId}`);
      onChanged();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Ubah pembelian"
      width="max-w-3xl"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="danger" onClick={remove} disabled={busy || !detail}>
            Hapus pembelian
          </Button>
          <div className="flex gap-2">
            <Button variant="text" onClick={onClose} disabled={busy}>
              Batal
            </Button>
            <Button variant="filled" onClick={save} loading={busy} disabled={!detail}>
              Simpan
            </Button>
          </div>
        </div>
      }
    >
      {!detail ? (
        <div className="py-6 text-center text-sm text-ink-3">
          {err ?? "Memuat…"}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {detail.resi && (
              <span className="font-mono text-[11px] text-ink-3">{detail.resi}</span>
            )}
            {detail.source === "delivery_scan" && <Badge tone="info">Dari scan APK</Badge>}
            {detail.isCod && (
              <Badge tone="warning">
                COD{detail.codAmount ? ` ${rupiah(detail.codAmount)}` : ""}
              </Badge>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tanggal">
              <Input
                type="date"
                value={purchasedAt}
                onChange={(e) => setPurchasedAt(e.target.value)}
              />
            </Field>
            <Field label="Pemasok">
              <Input
                value={supplier}
                placeholder="—"
                onChange={(e) => setSupplier(e.target.value)}
              />
            </Field>
          </div>

          {/* Kept next to the lines it explains: a waybill photo says what
              arrived, this says what was ordered and for how much — which is
              where the price the HPP needs actually lives. */}
          <div className="rounded-lg border border-line p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-ink-2">Foto pesanan</div>
              <label className="cursor-pointer text-xs text-brand hover:underline">
                {reading ? "Membaca…" : orderPhoto ? "Ganti foto" : "Unggah foto"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={reading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void attachPhoto(f);
                  }}
                />
              </label>
            </div>
            {orderPhoto ? (
              <div className="flex items-start gap-3">
                <a href={orderPhoto} target="_blank" rel="noreferrer">
                  <img
                    src={orderPhoto}
                    alt="Foto pesanan"
                    className="h-24 w-24 rounded border border-line object-cover"
                  />
                </a>
                <div className="flex-1 text-xs text-ink-3">
                  <div>Klik gambar untuk melihat ukuran penuh.</div>
                  <button
                    type="button"
                    className="mt-1 text-danger hover:underline"
                    onClick={() => {
                      setOrderPhoto(null);
                      setReadNote(null);
                    }}
                  >
                    Lepas foto
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-xs text-ink-3">
                Belum ada. Unggah screenshot detail pesanan dari marketplace —
                jumlah dan nominalnya akan dibaca otomatis.
              </div>
            )}
            {readNote && <div className="mt-2 text-xs text-ink-2">{readNote}</div>}
          </div>

          <div className="space-y-3">
            {drafts.map((d, i) => {
              const qty = resolved(d);
              const units = compatibleUnits(d.unit);
              return (
                <div key={i} className="rounded-lg border border-line p-3">
                  <div className="mb-2 flex items-end justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <label className="mb-1 block text-xs text-ink-3">Bahan baku</label>
                      {/* The mapping itself, editable. A phone offers five
                          near-identical names and the wrong one gets tapped;
                          without this the only fix was deleting the parcel. */}
                      <Select
                        value={d.materialId}
                        onChange={(e) => repoint(i, e.target.value)}
                      >
                        {(catalog.data ?? []).map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                            {m.unit ? ` (${m.unit})` : ""}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Button
                      variant="text"
                      size="sm"
                      onClick={() => setDrafts((ds) => ds.filter((_, n) => n !== i))}
                    >
                      Hapus baris
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Field label="Jumlah pcs">
                      <Input
                        value={d.qtyPcs}
                        inputMode="decimal"
                        onChange={(e) => patch(i, { qtyPcs: e.target.value })}
                      />
                    </Field>
                    <Field label="Isi per pcs">
                      <Input
                        value={d.content}
                        inputMode="decimal"
                        onChange={(e) => patch(i, { content: e.target.value })}
                      />
                    </Field>
                    <Field label="Satuan">
                      <Select
                        value={d.contentUnit}
                        onChange={(e) => patch(i, { contentUnit: e.target.value })}
                      >
                        {units.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Total harga">
                      <Input
                        value={d.totalCost}
                        inputMode="numeric"
                        placeholder="—"
                        onChange={(e) => patch(i, { totalCost: e.target.value })}
                      />
                    </Field>
                  </div>

                  {/* The conversion before it is committed rather than after.
                      An invisible thousandfold error is the kind that survives
                      all the way to a stocktake. */}
                  <div className="mt-2 text-xs">
                    {qty === null ? (
                      <span className="text-danger">
                        Satuan “{d.contentUnit}” tidak bisa diubah ke “{d.unit ?? "—"}”.
                      </span>
                    ) : (
                      <span className="text-ink-2">
                        = <strong>{qty.toLocaleString("id-ID")} {d.unit ?? ""}</strong> masuk ke stok
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            <Button variant="outline" size="sm" onClick={addLine} disabled={!catalog.data?.length}>
              + Tambah bahan
            </Button>

            {!drafts.length && (
              <div className="rounded-lg border border-dashed border-line p-4 text-center text-sm text-ink-3">
                Semua baris dihapus. Menyimpan akan mengosongkan pembelian ini dan
                mengembalikan seluruh stoknya.
              </div>
            )}
          </div>

          {err && <InlineAlert tone="danger">{err}</InlineAlert>}
        </div>
      )}
    </Modal>
  );
}
