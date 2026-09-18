import { useCallback, useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { api } from "../lib/api";
import { Icon } from "../components/Icon";
import {
  PageHeader,
  Card,
  CardHeader,
  Button,
  Badge,
  Field,
  Input,
  Select,
  Textarea,
  Table,
  TableWrap,
  THead,
  TR,
  TH,
  TD,
  EmptyState,
  Modal,
  ConfirmModal,
  InlineAlert,
  useToast,
} from "../components/ui";

interface Group {
  name: string;
  values: string[];
}
interface MasterOpt {
  id: string;
  sku: string;
  name: string;
}
interface SkuRow {
  id: string;
  combo: Record<string, string>;
  comboKey: string;
  sku: string | null;
  masterProductId: string | null;
  price: string | null;
  stock: number | null;
  imageUrl: string | null;
  master: MasterOpt | null;
}
interface Mapping {
  id: string;
  shopId: string;
  shopName: string | null;
  marketplace: string;
  productId: string;
  status: string;
  lastAppliedAt: string | null;
  lastStatus: string | null;
  lastMessage: string | null;
}
interface Detail {
  id: string;
  name: string;
  description: string | null;
  categoryId: number | null;
  brand: string | null;
  images: string[];
  variantGroups: Group[];
  attributes: Record<string, unknown>;
  autoApply: boolean;
  status: string;
  skus: SkuRow[];
  mappings: Mapping[];
}
interface ListItem {
  id: string;
  name: string;
  brand: string | null;
  status: string;
  imageCount: number;
  skuCount: number;
  skuMappedCount: number;
  mappingCount: number;
  updatedAt: string;
}
interface ShopOpt {
  id: string;
  shopName: string | null;
  marketplace: string;
}
interface ShopProduct {
  productId: string;
  title: string | null;
  status: string | null;
  marketplace: string;
}
interface ApplyResult {
  total: number;
  ok: number;
  gagal: number;
  dilewati: number;
  catatan?: string;
  catatanGambar?: string;
  hasil: {
    productId: string;
    shop: string | null;
    status: string;
    applied?: string[];
    pending?: string[];
    reason?: string;
    error?: string;
  }[];
}

const STATUS_TONE: Record<string, "success" | "neutral" | "warning" | "danger" | "info"> = {
  ok: "success",
  mapped: "info",
  failed: "danger",
  skipped: "warning",
};

export function MasterPostingan() {
  const [items, setItems] = useState<ListItem[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setItems(await api.get<ListItem[]>("/master-postings"));
    } catch (e) {
      toast((e as Error).message || "Gagal memuat", "danger");
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const d = await api.post<Detail>("/master-postings", { name: newName.trim() });
      setCreating(false);
      setNewName("");
      await load();
      setOpenId(d.id);
    } catch (e) {
      toast((e as Error).message || "Gagal membuat", "danger");
    } finally {
      setBusy(false);
    }
  }

  if (openId) {
    return (
      <Editor
        id={openId}
        onBack={() => {
          setOpenId(null);
          void load();
        }}
      />
    );
  }

  return (
    <Layout title="Master Postingan">
      <PageHeader
        title="Master Postingan"
        subtitle="Template listing yang diikuti semua toko. Ubah master → terapkan sekali ke semua listing marketplace yang termapping."
        actions={
          <Button variant="filled" icon="plus" onClick={() => setCreating(true)}>
            Buat Master Postingan
          </Button>
        }
      />

      {items === null ? (
        <Card>
          <div className="text-sm text-ink-2">Memuat…</div>
        </Card>
      ) : items.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon="package"
            title="Belum ada master postingan"
            description="Buat satu template, susun varian & SKU-nya, petakan ke listing di tiap toko, lalu terapkan sekali untuk semuanya."
            action={
              <Button variant="filled" icon="plus" onClick={() => setCreating(true)}>
                Buat Master Postingan
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <Card key={it.id} className="cursor-pointer hover:shadow-e2 transition" >
              <button className="text-left w-full" onClick={() => setOpenId(it.id)}>
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-ink">{it.name}</div>
                  <Badge tone={it.status === "active" ? "success" : "warning"}>{it.status}</Badge>
                </div>
                {it.brand && <div className="text-xs text-ink-2 mt-0.5">{it.brand}</div>}
                <div className="flex flex-wrap gap-1.5 mt-3">
                  <Badge tone="neutral" icon="image">{it.imageCount} gambar</Badge>
                  <Badge tone="neutral" icon="tag">{it.skuCount} SKU</Badge>
                  <Badge tone={it.skuMappedCount === it.skuCount && it.skuCount > 0 ? "success" : "neutral"}>
                    {it.skuMappedCount}/{it.skuCount} terpeta
                  </Badge>
                  <Badge tone={it.mappingCount > 0 ? "info" : "neutral"} icon="store">
                    {it.mappingCount} toko
                  </Badge>
                </div>
              </button>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Buat Master Postingan"
        footer={
          <>
            <Button variant="text" onClick={() => setCreating(false)}>
              Batal
            </Button>
            <Button variant="filled" loading={busy} onClick={create}>
              Buat
            </Button>
          </>
        }
      >
        <Field label="Nama postingan / produk" required>
          <Input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="mis. Celana Jeans Slim Fit"
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
        </Field>
      </Modal>
    </Layout>
  );
}

/* ------------------------------------------------------------------ editor */

function Editor({ id, onBack }: { id: string; onBack: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [masters, setMasters] = useState<MasterOpt[]>([]);
  const [shops, setShops] = useState<ShopOpt[]>([]);
  const toast = useToast();

  // Info dasar (editable)
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [brand, setBrand] = useState("");
  const [autoApply, setAutoApply] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [newImage, setNewImage] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);

  const refetch = useCallback(async () => {
    const detail = await api.get<Detail>(`/master-postings/${id}`);
    setD(detail);
    setName(detail.name);
    setDescription(detail.description ?? "");
    setBrand(detail.brand ?? "");
    setAutoApply(detail.autoApply);
    setImages(detail.images ?? []);
    setGroups(detail.variantGroups ?? []);
  }, [id]);

  useEffect(() => {
    void refetch().catch((e) => toast((e as Error).message || "Gagal memuat", "danger"));
    void api.get<MasterOpt[]>("/master-postings/master-products").then(setMasters).catch(() => {});
    void api.get<ShopOpt[]>("/marketplace-sync/shops").then(setShops).catch(() => {});
  }, [refetch, toast]);

  async function saveInfo(alsoApply: boolean) {
    setSaving(true);
    try {
      await api.patch(`/master-postings/${id}`, {
        name: name.trim(),
        description,
        brand,
        images,
        variantGroups: groups
          .map((g) => ({ name: g.name.trim(), values: g.values.map((v) => v.trim()).filter(Boolean) }))
          .filter((g) => g.name && g.values.length),
        autoApply,
      });
      await refetch();
      toast("Master postingan tersimpan", "success");
      if (alsoApply) await doApply();
    } catch (e) {
      toast((e as Error).message || "Gagal menyimpan", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function doApply() {
    setApplying(true);
    setConfirmApply(false);
    try {
      const r = await api.post<ApplyResult>(`/master-postings/${id}/apply`, {});
      setApplyResult(r);
      await refetch();
      toast(`Terapkan selesai: ${r.ok} berhasil, ${r.gagal} gagal, ${r.dilewati} dilewati`, r.gagal ? "warning" : "success");
    } catch (e) {
      toast((e as Error).message || "Gagal menerapkan", "danger");
    } finally {
      setApplying(false);
    }
  }

  if (!d) {
    return (
      <Layout title="Master Postingan">
        <Button variant="text" icon="arrowLeft" onClick={onBack}>
          Kembali
        </Button>
        <Card className="mt-3">
          <div className="text-sm text-ink-2">Memuat…</div>
        </Card>
      </Layout>
    );
  }

  return (
    <Layout title="Master Postingan">
      <PageHeader
        title={d.name}
        subtitle="Ubah lalu Simpan; tekan Terapkan untuk menyebarkan ke listing marketplace termapping."
        back={
          <Button variant="text" icon="arrowLeft" onClick={onBack} className="mb-2">
            Semua Master Postingan
          </Button>
        }
        actions={
          <>
            <Button variant="outline" loading={saving} onClick={() => saveInfo(false)}>
              Simpan
            </Button>
            <Button
              variant="filled"
              icon="upload"
              loading={applying}
              onClick={() => setConfirmApply(true)}
              disabled={d.mappings.length === 0}
            >
              Terapkan ke semua toko
            </Button>
          </>
        }
      />

      {applyResult && (
        <div className="mb-4">
          <InlineAlert tone={applyResult.gagal ? "warning" : "success"}>
            <div className="font-medium">
              Terapkan: {applyResult.ok} berhasil · {applyResult.gagal} gagal · {applyResult.dilewati} dilewati
            </div>
            {applyResult.catatanGambar && <div className="mt-1 text-xs">{applyResult.catatanGambar}</div>}
            {applyResult.catatan && <div className="mt-1 text-xs">{applyResult.catatan}</div>}
            {applyResult.hasil.some((h) => h.status !== "ok") && (
              <ul className="mt-1 text-xs list-disc pl-4">
                {applyResult.hasil
                  .filter((h) => h.status !== "ok")
                  .map((h, i) => (
                    <li key={i}>
                      {h.shop ?? h.productId}: {h.reason ?? h.error}
                    </li>
                  ))}
              </ul>
            )}
          </InlineAlert>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Info dasar */}
        <Card>
          <div className="text-sm font-medium text-ink mb-3">Info Dasar</div>
          <div className="space-y-3">
            <Field label="Nama postingan / produk" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Deskripsi">
              <Textarea rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Field label="Brand / merek">
              <Input value={brand} onChange={(e) => setBrand(e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" checked={autoApply} onChange={(e) => setAutoApply(e.target.checked)} />
              Terapkan otomatis ke marketplace tiap kali disimpan
            </label>
          </div>
        </Card>

        {/* Gambar */}
        <Card>
          <div className="text-sm font-medium text-ink mb-3">Daftar Gambar</div>
          <div className="space-y-2">
            {images.length === 0 && <div className="text-xs text-ink-3">Belum ada gambar. Tempel URL gambar di bawah.</div>}
            {images.map((url, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-ink-3 w-5">{i + 1}.</span>
                <div className="flex-1 truncate text-xs text-ink-2" title={url}>
                  {url}
                </div>
                <button
                  className="text-ink-3 hover:text-ink disabled:opacity-30"
                  disabled={i === 0}
                  onClick={() => setImages((a) => swap(a, i, i - 1))}
                  title="Naik"
                >
                  <Icon name="chevronDown" size={15} className="rotate-180" />
                </button>
                <button
                  className="text-ink-3 hover:text-ink disabled:opacity-30"
                  disabled={i === images.length - 1}
                  onClick={() => setImages((a) => swap(a, i, i + 1))}
                  title="Turun"
                >
                  <Icon name="chevronDown" size={15} />
                </button>
                <button className="text-red-500 hover:text-red-600" onClick={() => setImages((a) => a.filter((_, j) => j !== i))} title="Hapus">
                  <Icon name="trash" size={15} />
                </button>
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              <Input
                value={newImage}
                onChange={(e) => setNewImage(e.target.value)}
                placeholder="https://…/gambar.jpg"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newImage.trim()) {
                    setImages((a) => [...a, newImage.trim()]);
                    setNewImage("");
                  }
                }}
              />
              <Button
                variant="outline"
                icon="plus"
                onClick={() => {
                  if (newImage.trim()) {
                    setImages((a) => [...a, newImage.trim()]);
                    setNewImage("");
                  }
                }}
              >
                Tambah
              </Button>
            </div>
            <div className="text-[11px] text-ink-3">
              Propagasi gambar ke marketplace menunggu endpoint unggah gambar TikTok (tahap berikutnya). Nama & deskripsi sudah diterapkan sekarang.
            </div>
          </div>
        </Card>
      </div>

      {/* Grup varian */}
      <Card className="mt-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-medium text-ink">Grup Varian</div>
            <div className="text-xs text-ink-2">Mis. Warna: Biru, Merah · Size: M, L. Kombinasinya membentuk SKU unik otomatis (Simpan untuk memperbaruinya).</div>
          </div>
          <Button variant="outline" icon="plus" size="sm" onClick={() => setGroups((g) => [...g, { name: "", values: [] }])}>
            Tambah grup
          </Button>
        </div>
        {groups.length === 0 ? (
          <div className="text-xs text-ink-3">Tanpa grup varian = 1 SKU tunggal.</div>
        ) : (
          <div className="space-y-3">
            {groups.map((g, gi) => (
              <div key={gi} className="rounded-lg border border-line p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Input
                    className="max-w-[200px]"
                    value={g.name}
                    placeholder="Nama grup (mis. Warna)"
                    onChange={(e) => setGroups((arr) => arr.map((x, i) => (i === gi ? { ...x, name: e.target.value } : x)))}
                  />
                  <button className="text-red-500 hover:text-red-600 ml-auto" onClick={() => setGroups((arr) => arr.filter((_, i) => i !== gi))} title="Hapus grup">
                    <Icon name="trash" size={16} />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {g.values.map((v, vi) => (
                    <span key={vi} className="inline-flex items-center gap-1 rounded-full bg-canvas border border-line px-2 py-0.5 text-xs">
                      {v}
                      <button
                        className="text-ink-3 hover:text-red-500"
                        onClick={() => setGroups((arr) => arr.map((x, i) => (i === gi ? { ...x, values: x.values.filter((_, j) => j !== vi) } : x)))}
                      >
                        <Icon name="close" size={12} />
                      </button>
                    </span>
                  ))}
                  <ValueAdder onAdd={(val) => setGroups((arr) => arr.map((x, i) => (i === gi ? { ...x, values: [...x.values, val] } : x)))} />
                </div>
              </div>
            ))}
            <div className="text-[11px] text-ink-3">Klik Simpan untuk membangun ulang tabel SKU dari kombinasi varian. SKU/pemetaan lama dipertahankan.</div>
          </div>
        )}
      </Card>

      {/* SKU terbentuk */}
      <Card className="mt-4" padded={false}>
        <CardHeader title="SKU (kombinasi varian)" subtitle="Isi kode SKU & petakan tiap kombinasi ke master produk AutoToko." />
        {d.skus.length === 0 ? (
          <div className="p-5 text-sm text-ink-2">Belum ada SKU. Simpan grup varian dulu.</div>
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Kombinasi</TH>
                  <TH>Kode SKU</TH>
                  <TH>Master Produk AutoToko</TH>
                  <TH align="right">Harga</TH>
                  <TH align="right">Stok</TH>
                  <TH></TH>
                </TR>
              </THead>
              <tbody>
                {d.skus.map((s) => (
                  <SkuRowEditor key={s.id} postingId={id} row={s} masters={masters} onSaved={refetch} />
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>

      {/* Mapping ke toko */}
      <Card className="mt-4" padded={false}>
        <CardHeader
          title="Listing Marketplace Termapping"
          subtitle="Listing di tiap toko yang akan mengikuti master ini saat Terapkan."
        />
        <div className="p-5 space-y-3">
          <MappingAdder postingId={id} shops={shops} onAdded={refetch} />
          {d.mappings.length === 0 ? (
            <div className="text-sm text-ink-2">Belum ada listing termapping.</div>
          ) : (
            <div className="space-y-2">
              {d.mappings.map((m) => (
                <div key={m.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
                  <Badge tone="neutral" icon="store">{m.shopName ?? m.shopId.slice(0, 8)}</Badge>
                  <span className="text-xs text-ink-2 font-mono">{m.productId}</span>
                  {m.lastStatus && <Badge tone={STATUS_TONE[m.lastStatus] ?? "neutral"}>{m.lastStatus}</Badge>}
                  {m.lastMessage && <span className="text-[11px] text-ink-3 truncate max-w-[280px]" title={m.lastMessage}>{m.lastMessage}</span>}
                  <button
                    className="text-red-500 hover:text-red-600 ml-auto"
                    onClick={async () => {
                      await api.del(`/master-postings/${id}/mappings/${m.id}`);
                      await refetch();
                    }}
                    title="Lepas"
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <ConfirmModal
        open={confirmApply}
        onClose={() => setConfirmApply(false)}
        onConfirm={doApply}
        title="Terapkan ke semua toko?"
        confirmLabel="Ya, terapkan"
        loading={applying}
        description={`Ini menulis ke marketplace: nama & deskripsi listing di ${d.mappings.length} toko akan diperbarui mengikuti master ini. Tindakan nyata pada listing yang sedang tayang.`}
      />
    </Layout>
  );
}

function swap<T>(a: T[], i: number, j: number): T[] {
  const b = a.slice();
  [b[i], b[j]] = [b[j]!, b[i]!];
  return b;
}

function ValueAdder({ onAdd }: { onAdd: (v: string) => void }) {
  const [v, setV] = useState("");
  return (
    <input
      className="text-xs px-2 py-1 rounded-full border border-dashed border-line bg-white w-28 focus:outline-none focus:border-brand"
      value={v}
      placeholder="+ nilai"
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && v.trim()) {
          onAdd(v.trim());
          setV("");
        }
      }}
      onBlur={() => {
        if (v.trim()) {
          onAdd(v.trim());
          setV("");
        }
      }}
    />
  );
}

function SkuRowEditor({
  postingId,
  row,
  masters,
  onSaved,
}: {
  postingId: string;
  row: SkuRow;
  masters: MasterOpt[];
  onSaved: () => Promise<void>;
}) {
  const [sku, setSku] = useState(row.sku ?? "");
  const [masterId, setMasterId] = useState(row.masterProductId ?? "");
  const [price, setPrice] = useState(row.price ?? "");
  const [stock, setStock] = useState(row.stock == null ? "" : String(row.stock));
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const dirty =
    sku !== (row.sku ?? "") ||
    masterId !== (row.masterProductId ?? "") ||
    price !== (row.price ?? "") ||
    stock !== (row.stock == null ? "" : String(row.stock));

  const comboLabel = Object.entries(row.combo)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");

  async function save() {
    setBusy(true);
    try {
      await api.patch(`/master-postings/${postingId}/skus/${row.id}`, {
        sku,
        masterProductId: masterId || null,
        price: price || undefined,
        stock: stock === "" ? undefined : Number(stock),
      });
      await onSaved();
      toast("SKU tersimpan", "success");
    } catch (e) {
      toast((e as Error).message || "Gagal simpan SKU", "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <TR>
      <TD>{comboLabel || "(tunggal)"}</TD>
      <TD>
        <Input className="max-w-[140px]" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="abc123" />
      </TD>
      <TD>
        <Select className="max-w-[240px]" value={masterId} onChange={(e) => setMasterId(e.target.value)}>
          <option value="">— belum dipetakan —</option>
          {masters.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.sku})
            </option>
          ))}
        </Select>
      </TD>
      <TD align="right">
        <Input className="max-w-[110px] text-right" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" />
      </TD>
      <TD align="right">
        <Input className="max-w-[80px] text-right" value={stock} onChange={(e) => setStock(e.target.value)} placeholder="0" />
      </TD>
      <TD>
        <Button variant={dirty ? "filled" : "outline"} size="sm" icon="check" loading={busy} disabled={!dirty} onClick={save}>
          Simpan
        </Button>
      </TD>
    </TR>
  );
}

function MappingAdder({ postingId, shops, onAdded }: { postingId: string; shops: ShopOpt[]; onAdded: () => Promise<void> }) {
  const [shopId, setShopId] = useState("");
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [productId, setProductId] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!shopId) {
      setProducts([]);
      setProductId("");
      return;
    }
    setLoading(true);
    api
      .get<ShopProduct[]>(`/master-postings/shop-products?shopId=${shopId}`)
      .then(setProducts)
      .catch((e) => toast((e as Error).message || "Gagal memuat produk toko", "danger"))
      .finally(() => setLoading(false));
  }, [shopId, toast]);

  async function add() {
    if (!shopId || !productId) return;
    setBusy(true);
    try {
      await api.post(`/master-postings/${postingId}/mappings`, { shopId, productId });
      setProductId("");
      await onAdded();
      toast("Listing dipetakan", "success");
    } catch (e) {
      toast((e as Error).message || "Gagal memetakan", "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Toko" className="min-w-[180px]">
        <Select value={shopId} onChange={(e) => setShopId(e.target.value)}>
          <option value="">Pilih toko…</option>
          {shops.map((s) => (
            <option key={s.id} value={s.id}>
              {s.shopName ?? s.id.slice(0, 8)} ({s.marketplace})
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Listing marketplace" className="min-w-[260px] flex-1">
        <Select value={productId} onChange={(e) => setProductId(e.target.value)} disabled={!shopId || loading}>
          <option value="">{loading ? "Memuat…" : "Pilih listing…"}</option>
          {products.map((p) => (
            <option key={p.productId} value={p.productId}>
              {(p.title ?? "(tanpa judul)").slice(0, 70)} · {p.productId}
            </option>
          ))}
        </Select>
      </Field>
      <Button variant="outline" icon="link" loading={busy} disabled={!shopId || !productId} onClick={add}>
        Petakan
      </Button>
    </div>
  );
}
