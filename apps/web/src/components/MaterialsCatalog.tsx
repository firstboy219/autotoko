import { useState } from "react";
import { api } from "../lib/api";
import { useFetch } from "../lib/useFetch";
import { MaterialRecipes } from "./MaterialRecipes";
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
  shopCategoryId?: string | null;
  usedByProducts: number;
  usage: {
    days: number;
    orders: number;
    units: number;
    qty: number;
    /** A recipe unit that cannot be converted to the catalogue's was left out. */
    qtyIncomplete: boolean;
    lastUsedAt: string | null;
    /** Counted per parcel rather than per product: dus, label, shrink. */
    fromPacking: boolean;
  };
  isLow: boolean;
}
/**
 * The orders the catalogue can be read in.
 *
 * Sorted here rather than on the server: every key is already in the response,
 * the list is not paginated, and a round trip to reorder 22 rows would be
 * slower than the click that asked for it.
 *
 * Two deliberate absences. There is no "most consumed by quantity", because
 * quantity is measured in the material's own unit and 3.165 ml of aquades
 * against 32 pcs of bottles is not a comparison — the rupiah value is, which
 * is what "nilai keluar" ranks instead. And a price of zero is not the
 * cheapest thing in the warehouse, it is a price nobody has entered, so those
 * rows sink to the bottom of BOTH price orders rather than crowding the top of
 * one of them.
 */
const URUTAN = {
  nama: "Nama (A–Z)",
  sering: "Paling sering terpakai",
  nilai: "Nilai keluar terbesar",
  produk: "Dipakai paling banyak produk",
  murah: "Harga satuan termurah",
  mahal: "Harga satuan termahal",
  stokBanyak: "Stok paling banyak",
  stokSedikit: "Stok paling sedikit",
} as const;

type Urutan = keyof typeof URUTAN;

/** Unpriced rows sort last whichever direction was asked for. */
function bandingHarga(a: Material, b: Material, naik: boolean): number {
  const ka = a.unitCost > 0;
  const kb = b.unitCost > 0;
  if (ka !== kb) return ka ? -1 : 1;
  if (!ka) return a.name.localeCompare(b.name);
  return naik ? a.unitCost - b.unitCost : b.unitCost - a.unitCost;
}

function urutkan(rows: Material[], by: Urutan): Material[] {
  const out = [...rows];
  const nama = (a: Material, b: Material) => a.name.localeCompare(b.name);
  switch (by) {
    case "sering":
      // Orders, not quantity: it is unit-free, so every material is on the
      // same axis. Quantity only breaks ties within one material's own unit.
      return out.sort((a, b) => b.usage.orders - a.usage.orders || b.usage.qty - a.usage.qty || nama(a, b));
    case "nilai":
      return out.sort(
        (a, b) => b.usage.qty * b.unitCost - a.usage.qty * a.unitCost || nama(a, b),
      );
    case "produk":
      return out.sort((a, b) => b.usedByProducts - a.usedByProducts || nama(a, b));
    case "murah":
      return out.sort((a, b) => bandingHarga(a, b, true));
    case "mahal":
      return out.sort((a, b) => bandingHarga(a, b, false));
    case "stokBanyak":
      return out.sort((a, b) => b.currentStock - a.currentStock || nama(a, b));
    case "stokSedikit":
      return out.sort((a, b) => a.currentStock - b.currentStock || nama(a, b));
    default:
      return out.sort(nama);
  }
}

interface Usage {
  products: {
    id: string;
    name: string;
    quantity: number;
    unit: string | null;
    orders: number;
    unitsShipped: number;
  }[];
  usageDays: number;
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
  const [urutan, setUrutan] = useState<Urutan>("nama");
  const brands = useFetch<{ id: string; name: string }[]>("/shops/categories");
  const list = useFetch<Material[]>(
    brand ? `/materials?brandId=${brand}` : "/materials",
  );
  const [editing, setEditing] = useState<Material | null>(null);
  const [deleting, setDeleting] = useState<Material | null>(null);
  /** The material whose ledger is open, or null. */
  const [movements, setMovements] = useState<Material | null>(null);
  /** Which material's recipe list is open. */
  const [resep, setResep] = useState<Material | null>(null);

  const rows = urutkan(list.data ?? [], urutan);

  return (
    <Card padded={false} className="mb-5">
      <CardHeader
        title="Master Bahan Baku"
        subtitle="Dipakai bersama oleh semua produk. Mengubah harga di sini berlaku untuk semuanya."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={urutan}
              onChange={(e) => setUrutan(e.target.value as Urutan)}
              className="min-w-[210px]"
              aria-label="Urutkan bahan baku"
            >
              {(Object.keys(URUTAN) as Urutan[]).map((k) => (
                <option key={k} value={k}>
                  {URUTAN[k]}
                </option>
              ))}
            </Select>

            {/* "Tanpa brand" is an option rather than a hidden bucket: a
                material that vanishes from every view until somebody
                categorises it is a filter that has quietly become data loss. */}
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
          </div>
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
              <TH className="text-right">Terpakai</TH>
              <TH className="text-right">Aksi</TH>
            </TR>
          </THead>
          <tbody>
            {list.loading ? (
              <SkeletonRows n={4} cols={6} />
            ) : rows.length === 0 ? (
              <TR>
                <TD colSpan={6}>
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
                    {/* The number opens its own explanation. "Six products" is
                        not actionable until you know which six, and which of
                        them is the one actually emptying the shelf. */}
                    {m.usedByProducts > 0 ? (
                      <button
                        onClick={() => setResep(m)}
                        className="underline decoration-dotted underline-offset-2 hover:text-brand-ink"
                        title="Lihat produk yang memakai bahan ini"
                      >
                        {m.usedByProducts} produk
                      </button>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </TD>
                  {/* How often it actually left the shelf, not how many recipes
                      mention it. A material in nine recipes that nobody ships
                      and one in a single product that ships daily read the same
                      in the column to the left, and they are opposite problems. */}
                  <TD className="text-right tabular-nums">
                    {m.usage.orders > 0 ? (
                      <>
                        <div className="text-ink">{m.usage.orders} order</div>
                        <div className="text-[10px] text-ink-3">
                          {Math.round(m.usage.qty * 100) / 100} {m.unit ?? ""}
                          {m.usage.qtyIncomplete && " +"}
                          {/* The figure the "nilai keluar" order ranks on, shown
                              only in that order so the column stays readable. */}
                          {urutan === "nilai" && m.unitCost > 0 && (
                            <> · {rupiah(Math.round(m.usage.qty * m.unitCost))}</>
                          )}
                          {m.usage.fromPacking && " · tiap paket"}
                        </div>
                      </>
                    ) : (
                      <span className="text-ink-3">belum terpakai</span>
                    )}
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

      {/* The column needs three sentences of explanation and they belong
          here, not in a tooltip nobody opens. */}
      <div className="mt-2 px-1 text-[11px] text-ink-3">
        <strong>Terpakai</strong> dihitung dari scan resi packing{" "}
        {rows[0]?.usage.days ?? 30} hari terakhir: berapa order memuat produk yang
        memakai bahan ini, dan berapa banyak yang keluar menurut resep. Bahan packing
        (dus, label, shrink) ditandai <em>tiap paket</em> karena menempel di setiap
        resi, bukan di resep — stoknya ikut dipotong otomatis saat scan, satu kali
        per resi berapapun isinya.
        Tanda <strong>+</strong> berarti ada baris resep bersatuan yang tidak bisa
        dikonversi ke satuan master, jadi jumlahnya kurang dari sebenarnya.
      </div>

      {resep && <MaterialRecipes material={resep} onClose={() => setResep(null)} />}

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
  const [brandId, setBrandId] = useState(material.shopCategoryId ?? "");
  const brands = useFetch<{ id: string; name: string }[]>("/shops/categories");
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
        // "" means the seller chose "tanpa brand", which is a decision and
        // clears the field; undefined would leave whatever was there.
        shopCategoryId: brandId || null,
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
        <Field
          label="Brand / kategori bisnis"
          hint="Menentukan di daftar brand mana bahan ini muncul."
        >
          <Select value={brandId} onChange={(e) => setBrandId(e.target.value)}>
            <option value="">— tanpa brand —</option>
            {(brands.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
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
