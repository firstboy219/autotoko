import { useState } from "react";
import { api } from "../lib/api";
import { useFetch } from "../lib/useFetch";
import { StockMovements } from "./StockMovements";
import { rupiah, dateShort } from "../lib/fmt";
import { Icon } from "./Icon";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  Modal,
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

interface Material {
  id: string;
  name: string;
  unit: string | null;
  currentStock: number;
  unitCost: number;
  unitCostUpdatedAt: string | null;
  minimumThreshold: number;
  usedByProducts: number;
  isLow: boolean;
}
interface Usage {
  products: { id: string; name: string; quantity: number }[];
  packingLines: number;
  purchaseLines: number;
  inUse: boolean;
}

/**
 * The shared material catalogue: rename, reprice, or remove.
 *
 * Editing here reaches every product using the material — that is the point of
 * a catalogue — so the row says how many products that is before anything is
 * changed.
 */
export function MaterialsCatalogCard() {
  const toast = useToast();
  /** "" is every brand, "none" is the ones nobody has assigned. */
  const [brand, setBrand] = useState("");
  const brands = useFetch<{ id: string; name: string }[]>("/shops/categories");
  const list = useFetch<Material[]>(
    brand ? `/materials?brandId=${brand}` : "/materials",
  );
  const [editing, setEditing] = useState<Material | null>(null);
  const [deleting, setDeleting] = useState<Material | null>(null);
  /** The material whose ledger is open, or null. */
  const [movements, setMovements] = useState<Material | null>(null);

  const rows = list.data ?? [];

  return (
    <Card padded={false} className="mb-5">
      <CardHeader
        title="Master Bahan Baku"
        subtitle="Dipakai bersama oleh semua produk. Mengubah harga di sini berlaku untuk semuanya."
        action={
          /* "Tanpa brand" is an option rather than a hidden bucket: a material
             that vanishes from every view until somebody categorises it is a
             filter that has quietly become data loss. */
          <Select
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            className="min-w-[170px]"
          >
            <option value="">Semua brand</option>
            {(brands.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
            <option value="none">Tanpa brand</option>
          </Select>
        }
      />
      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>Bahan</TH>
              <TH className="text-right">Stok</TH>
              <TH className="text-right">Harga Satuan</TH>
              <TH className="text-right">Dipakai</TH>
              <TH className="text-right">Aksi</TH>
            </TR>
          </THead>
          <tbody>
            {list.loading ? (
              <SkeletonRows n={4} cols={5} />
            ) : rows.length === 0 ? (
              <TR>
                <TD colSpan={5}>
                  <EmptyState
                    icon="beaker"
                    title="Belum ada bahan baku"
                    description="Bahan bertambah sendiri saat kamu mencatat pembelian stok atau menambahkannya dari halaman HPP."
                  />
                </TD>
              </TR>
            ) : (
              rows.map((m) => (
                <TR key={m.id}>
                  <TD>
                    <div className="text-ink">{m.name}</div>
                    {m.unit && <div className="text-[11px] text-ink-3">satuan: {m.unit}</div>}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {/* The number is a link to its own explanation. A total
                        nobody can account for is a total nobody argues with. */}
                    <button
                      onClick={() => setMovements(m)}
                      className="underline decoration-dotted underline-offset-2 hover:text-brand-ink"
                      title="Lihat mutasi stok"
                    >
                      {m.currentStock}
                    </button>
                    {m.isLow && (
                      <span className="ml-1.5 inline-block">
                        <Badge tone="warning">menipis</Badge>
                      </span>
                    )}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {rupiah(m.unitCost)}
                    {/* A costing sheet is only as good as the age of the prices
                        in it, and updated_at cannot answer that -- it moves for
                        a rename or a stock count too. */}
                    <div className="text-[10px] text-ink-3 tabular-nums">
                      {m.unitCostUpdatedAt
                        ? `diubah ${dateShort(m.unitCostUpdatedAt)}`
                        : "belum pernah diisi"}
                    </div>
                  </TD>
                  <TD className="text-right tabular-nums text-ink-2">
                    {m.usedByProducts} produk
                  </TD>
                  <TD className="text-right whitespace-nowrap">
                    <Button variant="text" onClick={() => setMovements(m)}>
                      Mutasi
                    </Button>
                    <Button variant="text" onClick={() => setEditing(m)}>
                      Ubah
                    </Button>
                    <Button variant="text" onClick={() => setDeleting(m)}>
                      <Icon name="trash" size={15} />
                    </Button>
                  </TD>
                </TR>
              ))
            )}
          </tbody>
        </Table>
      </TableWrap>

      {movements && (
        <StockMovements
          materialId={movements.id}
          onClose={() => setMovements(null)}
          // The stock column is what a movement changes, so the table behind
          // has to follow or it shows a number the ledger has moved past.
          onChanged={() => list.reload()}
        />
      )}

      {editing && (
        <EditMaterialModal
          material={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            list.reload();
          }}
        />
      )}
      {deleting && (
        <DeleteMaterialModal
          material={deleting}
          others={rows.filter((r) => r.id !== deleting.id)}
          onClose={() => setDeleting(null)}
          onDone={(msg) => {
            setDeleting(null);
            list.reload();
            toast(msg, "success");
          }}
        />
      )}
    </Card>
  );
}

function EditMaterialModal({
  material,
  onClose,
  onDone,
}: {
  material: Material;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(material.name);
  const [unit, setUnit] = useState(material.unit ?? "");
  const [cost, setCost] = useState(String(material.unitCost));
  const [stock, setStock] = useState(String(material.currentStock));
  const [minimum, setMinimum] = useState(String(material.minimumThreshold));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.patch(`/materials/${material.id}`, {
        name: name.trim(),
        unit: unit.trim() || undefined,
        unitCost: Number(cost) || 0,
        currentStock: Number(stock) || 0,
        minimumThreshold: Number(minimum) || 0,
      });
      onDone();
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={`Ubah ${material.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button variant="filled" icon="check" loading={busy} onClick={save} disabled={!name.trim()}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {material.usedByProducts > 0 && (
          <InlineAlert tone="info">
            Bahan ini dipakai {material.usedByProducts} produk. Perubahan harga langsung berlaku
            di HPP semuanya.
          </InlineAlert>
        )}
        <Field label="Nama" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Satuan" hint="kg, gram, pcs…">
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
          </Field>
          <Field
            label="Harga Satuan"
            hint="Ditimpa rata-rata tertimbang saat kamu mencatat pembelian berikutnya."
          >
            <Input
              inputMode="numeric"
              value={cost}
              onChange={(e) => setCost(e.target.value.replace(/[^\d.]/g, ""))}
              className="tabular-nums"
            />
          </Field>
          <Field label="Stok Saat Ini">
            <Input
              inputMode="decimal"
              value={stock}
              onChange={(e) => setStock(e.target.value.replace(/[^\d.]/g, ""))}
              className="tabular-nums"
            />
          </Field>
          <Field label="Batas Minimum" hint="Untuk peringatan stok menipis">
            <Input
              inputMode="decimal"
              value={minimum}
              onChange={(e) => setMinimum(e.target.value.replace(/[^\d.]/g, ""))}
              className="tabular-nums"
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Deleting asks where the work goes, it does not just warn.
 *
 * The foreign key would unlink recipe lines rather than block, leaving them
 * costing from a stale private copy of the price — a silent wrong number
 * instead of a visible error. So the server refuses while the material is in
 * use, and this dialog collects the replacement it demands.
 */
function DeleteMaterialModal({
  material,
  others,
  onClose,
  onDone,
}: {
  material: Material;
  others: Material[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const toast = useToast();
  const usage = useFetch<Usage>(`/materials/${material.id}/usage`);
  const [replaceWith, setReplaceWith] = useState("");
  const [busy, setBusy] = useState(false);

  const inUse = usage.data?.inUse ?? false;

  async function remove() {
    if (inUse && !replaceWith) return;
    setBusy(true);
    try {
      const r = await api.del<{ name: string; moved: { recipes: number; merged: number } }>(
        `/materials/${material.id}${replaceWith ? `?replaceWith=${replaceWith}` : ""}`,
      );
      const moved = r.moved?.recipes ?? 0;
      const merged = r.moved?.merged ?? 0;
      onDone(
        moved || merged
          ? `${material.name} dihapus — ${moved} resep dipindahkan${merged ? `, ${merged} digabung` : ""}.`
          : `${material.name} dihapus.`,
      );
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={`Hapus ${material.name}?`}
      onClose={onClose}
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button
            variant="danger"
            icon="trash"
            loading={busy}
            disabled={usage.loading || (inUse && !replaceWith)}
            onClick={remove}
          >
            Hapus
          </Button>
        </>
      }
    >
      {usage.loading ? (
        <div className="text-sm text-ink-3">Memeriksa pemakaian…</div>
      ) : !inUse ? (
        <p className="text-sm text-ink-2">
          Bahan ini belum dipakai produk mana pun. Aman dihapus.
        </p>
      ) : (
        <div className="space-y-3">
          <InlineAlert tone="warning">
            Dipakai {usage.data!.products.length} produk
            {usage.data!.packingLines > 0 ? " dan ada di daftar bahan packing" : ""}.
          </InlineAlert>

          <div className="text-xs text-ink-2">
            <div className="mb-1">Produk yang memakainya:</div>
            <ul className="list-disc pl-4 space-y-0.5">
              {usage.data!.products.map((p) => (
                <li key={p.id}>
                  {p.name} <span className="text-ink-3">(takaran {p.quantity})</span>
                </li>
              ))}
            </ul>
          </div>

          <Field
            label="Pindahkan ke bahan"
            required
            hint="Resep produk di atas akan langsung memakai bahan ini."
          >
            <Select value={replaceWith} onChange={(e) => setReplaceWith(e.target.value)}>
              <option value="">Pilih bahan pengganti…</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.unit ? ` (${o.unit})` : ""} — {rupiah(o.unitCost)}
                </option>
              ))}
            </Select>
          </Field>

          <p className="text-[11px] text-ink-3 leading-relaxed">
            Kalau sebuah produk sudah memakai bahan pengganti itu, takarannya{" "}
            <strong>dijumlahkan</strong> — supaya total bahan produk tersebut tidak berubah.
            Riwayat pembeliannya ikut dipindahkan.
          </p>
        </div>
      )}
    </Modal>
  );
}
