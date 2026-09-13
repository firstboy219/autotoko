import { useMemo, useState } from "react";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";
import { CategoryChip, type ShopCategory } from "../components/ShopCategories";
import { rupiah } from "../lib/fmt";
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
  Table,
  TableWrap,
  THead,
  TR,
  TH,
  TD,
  SkeletonRows,
  Skeleton,
  EmptyState,
  Modal,
  ConfirmModal,
  InlineAlert,
  useToast,
} from "../components/ui";

import { SaranAi } from "../components/SaranAi";
interface Master {
  id: string;
  sku: string;
  name: string;
  /** Other names this is sold under, one per line. */
  marketplaceAliases: string | null;
  basePrice: string | null;
  status: string;
  postingCount?: number;
  totalStock?: number;
  gmv7d?: string;
  /** Kategori utama — tetap ada karena penyaring lama membacanya. */
  shopCategoryId?: string | null;
  /** Seluruh kategori produk ini; yang pertama adalah yang utama. */
  shopCategoryIds?: string[];
}

interface Posting {
  id: string;
  title: string | null;
  marketplaceItemId: string | null;
  marketplaceSku: string | null;
  price: string | null;
  stock: number | null;
  status: string;
}

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

const MP_BADGE: Record<string, { label: string; tone: Tone }> = {
  tiktok: { label: "TikTok Shop", tone: "neutral" },
  shopee: { label: "Shopee", tone: "warning" },
  tokopedia: { label: "Tokopedia", tone: "success" },
  lazada: { label: "Lazada", tone: "info" },
};

const STATUS_TONE: Record<string, Tone> = {
  active: "success",
  inactive: "neutral",
  draft: "warning",
};

interface ShopGroup { shopId: string; shopName: string | null; marketplace: string; postings: Posting[]; }
interface MasterDetail extends Master { shops: ShopGroup[]; }
interface Shop { id: string; shopName: string | null; marketplace: string; }

interface CatalogItem {
  productId: string;
  title: string | null;
  status: string | null;
  marketplace: string;
  shopName: string | null;
  skuCount: number;
  hargaMin: number | null;
  hargaMax: number | null;
  currency: string;
  stok: number;
  masterId: string | null;
  masterName: string | null;
  via: "map" | "sku" | null;
}
interface Catalog {
  ringkas: { totalProduk: number; terpetakan: number; belum: number; denganHarga: number };
  terpetakan: { masterId: string; masterName: string | null; postings: CatalogItem[] }[];
  belumDipetakan: CatalogItem[];
  masters: { id: string; name: string; sku: string | null }[];
}

/** "Rp 39.300" atau "Rp 39.300 – 49.300" bila antar-varian beda. */
function hargaRange(min: number | null, max: number | null): string {
  if (min == null) return "—";
  if (max == null || max === min) return rupiah(min);
  return `${rupiah(min)} – ${rupiah(max)}`;
}

export function Produk() {
  const [sort, setSort] = useState("nama");
  const [days, setDays] = useState("30");
  const { data, loading, reload } = useFetch<Master[]>("/products");
  /**
   * Order and figures from the costing service rather than recomputed here.
   * Two implementations of a margin is how they start disagreeing.
   */
  const costing = useFetch<
    { productId: string; soldQty?: number; hpp: number; netMarginRate: number | null }[]
  >(`/costing?sort=${sort}&days=${days}`);

  const ordered = (() => {
    const rows = data ?? [];
    if (sort === "nama" || !costing.data?.length) return rows;
    const rank = new Map(costing.data.map((c, i) => [c.productId, i]));
    // Anything costing did not return keeps its place at the end: a product
    // with no costing row is still a product, and hiding it here would hide
    // exactly the ones that need setting up.
    return [...rows].sort(
      (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  })();

  const soldById = new Map((costing.data ?? []).map((c) => [c.productId, c.soldQty ?? 0]));
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (ordered).filter((m) =>
      !needle || `${m.name} ${m.sku}`.toLowerCase().includes(needle),
    );
  }, [data, q, ordered]);

  function closeCreate() {
    setOpen(false);
    setErr(null);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      await api.post("/products", { sku, name, basePrice: price || undefined, status: "active" });
      setOpen(false); setSku(""); setName(""); setPrice(""); reload();
      toast("Master produk ditambahkan", "success");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Layout title="Master Produk">
      <PageHeader
        title="Master Produk"
        subtitle="Satu master produk menaungi seluruh postingan di tiap marketplace."
        actions={
          <Button variant="filled" icon="plus" onClick={() => setOpen(true)}>
            Produk Baru
          </Button>
        }
      />

      <Card padded={false} className="overflow-hidden">
        <CardHeader
          title="Daftar produk"
          subtitle={loading ? undefined : `${filtered.length} produk`}
          action={
            <div className="flex flex-wrap items-center gap-2">
  
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  className="min-w-[190px]"
                >
                  <option value="nama">Urut nama</option>
                  <option value="terlaris">Terlaris (qty terjual)</option>
                  <option value="margin">Margin bersih tertinggi</option>
                  <option value="profit">Profit bersih terbesar</option>
                  <option value="harga_tertinggi">Harga jual tertinggi</option>
                  <option value="harga_terendah">Harga jual terendah</option>
                  <option value="hpp_tertinggi">HPP termahal</option>
                  <option value="hpp_terendah">HPP termurah</option>
                </Select>
                {sort === "terlaris" && (
                  <Select
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                    className="min-w-[130px]"
                  >
                    <option value="30">30 hari</option>
                    <option value="90">3 bulan</option>
                    <option value="180">6 bulan</option>
                    <option value="365">1 tahun</option>
                  </Select>
                )}
              </div>
            <div className="relative w-full sm:w-64">
              <Icon
                name="search"
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none"
              />
              <Input
                className="pl-9"
                placeholder="Cari nama / SKU…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            </div>
          }
        />
        <TableWrap>
          <Table className="min-w-[760px]">
            <THead>
              <tr>
                <TH>Produk / SKU</TH>
                <TH align="right">Postingan</TH>
                <TH align="right">Stok</TH>
                <TH align="right">Harga</TH>
                <TH align="right">GMV 7h</TH>
                <TH align="right">Terjual</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <tbody>
              {loading ? (
                <SkeletonRows n={6} cols={7} />
              ) : !filtered.length ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      icon="package"
                      title={q.trim() ? "Produk tidak ditemukan" : "Belum ada produk"}
                      description={
                        q.trim()
                          ? "Coba kata kunci lain atau hapus pencarian."
                          : "Buat master produk untuk mulai menghubungkan postingan marketplace."
                      }
                      action={
                        q.trim() ? (
                          <Button variant="tonal" icon="close" onClick={() => setQ("")}>
                            Hapus pencarian
                          </Button>
                        ) : (
                          <Button variant="filled" icon="plus" onClick={() => setOpen(true)}>
                            Produk Baru
                          </Button>
                        )
                      }
                    />
                  </td>
                </tr>
              ) : (
                filtered.map((m) => (
                  <TR
                    key={m.id}
                    className="cursor-pointer hover:bg-canvas"
                    onClick={() => setDetailId(m.id)}
                  >
                    <TD>
                      <div className="text-ink font-medium">{m.name}</div>
                      <div className="text-xs font-mono text-ink-3 mt-0.5">SKU: {m.sku}</div>
                    </TD>
                    <TD align="right" className="tabular-nums">{m.postingCount ?? 0}</TD>
                    <TD align="right" className="tabular-nums">{m.totalStock ?? 0}</TD>
                    <TD align="right" className="tabular-nums whitespace-nowrap">{rupiah(m.basePrice)}</TD>
                    <TD align="right" className="tabular-nums whitespace-nowrap">{rupiah(m.gmv7d)}</TD>
                    {/* From packing scans over the chosen window — the same
                        number the HPP page sorts by, from the same service. */}
                    <TD align="right" className="tabular-nums text-ink-2">
                      {soldById.get(m.id) ? soldById.get(m.id)!.toLocaleString("id-ID") : "—"}
                    </TD>
                    <TD>
                      <Badge tone={STATUS_TONE[m.status] ?? "neutral"}>
                        <span className="capitalize">{m.status}</span>
                      </Badge>
                    </TD>
                  </TR>
                ))
              )}
            </tbody>
          </Table>
        </TableWrap>
      </Card>

      <MarketplaceCatalog />

      <Modal open={open} onClose={closeCreate} title="Produk Baru">
        <form onSubmit={create} className="space-y-3.5">
          {err && <InlineAlert tone="danger">{err}</InlineAlert>}
          <Field label="SKU" required hint="Kode unik untuk menautkan postingan marketplace.">
            <Input value={sku} onChange={(e) => setSku(e.target.value)} required />
          </Field>
          <Field label="Nama" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Harga">
            <Input
              placeholder="mis. 75000"
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="text" onClick={closeCreate} disabled={saving}>
              Batal
            </Button>
            <Button type="submit" variant="filled" loading={saving}>
              Simpan
            </Button>
          </div>
        </form>
      </Modal>

      {detailId && (
        <ProductDetail
          id={detailId}
          onClose={() => setDetailId(null)}
          onChanged={reload}
        />
      )}
      <div className="mt-4">
        <SaranAi path="/products/saran" keterangan="Membaca seluruh katalog produk dan membandingkannya dengan tren pasar Indonesia." />
      </div>
    </Layout>
  );
}

function MarketplaceCatalog() {
  const toast = useToast();
  const { data, loading, reload } = useFetch<Catalog>("/products/marketplace-catalog");
  const [pick, setPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [lihatSemua, setLihatSemua] = useState(false);

  async function tautkan(productId: string, masterId: string | null) {
    setBusy(productId);
    try {
      await api.post("/products/marketplace-catalog/link", { productId, masterId });
      toast(masterId ? "Ditautkan ke master produk" : "Tautan dilepas", "success");
      reload();
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Card className="mt-4"><Skeleton className="h-24 w-full" /></Card>;
  if (!data || data.ringkas.totalProduk === 0) {
    // Belum ada produk API sama sekali -- diamkan, jangan tampilkan kartu kosong
    // yang membingungkan. Sinkronisasi mengisinya; lihat menu Toko Saya.
    return null;
  }

  const r = data.ringkas;
  const belum = data.belumDipetakan;
  const tampil = lihatSemua ? belum : belum.slice(0, 15);

  return (
    <Card padded={false} className="mt-4 overflow-hidden">
      <CardHeader
        title="Produk dari Marketplace"
        subtitle={
          `${r.totalProduk} produk API · ${r.terpetakan} sudah jadi postingan master · `
          + `${r.belum} belum dipetakan · ${r.denganHarga} punya harga`
        }
      />

      {/* Sudah terpetakan: postingan API yang menempel ke master, dengan harga. */}
      {data.terpetakan.length > 0 && (
        <div className="border-b border-line">
          <div className="px-5 py-2 text-xs font-medium text-ink-2">
            Sudah jadi postingan master ({data.terpetakan.length} master)
          </div>
          <TableWrap>
            <Table className="min-w-[720px]">
              <THead>
                <tr>
                  <TH>Master</TH>
                  <TH>Postingan (dari API)</TH>
                  <TH>Toko</TH>
                  <TH align="right">Harga API</TH>
                  <TH />
                </tr>
              </THead>
              <tbody>
                {data.terpetakan.flatMap((g) =>
                  g.postings.map((p, i) => (
                    <TR key={p.productId}>
                      <TD className="text-ink font-medium">
                        {i === 0 ? g.masterName ?? "-" : ""}
                      </TD>
                      <TD>
                        <div className="text-ink-2 text-xs">{p.title ?? "-"}</div>
                        <div className="text-[10px] text-ink-3">
                          {p.via === "sku" ? "cocok SKU" : "dipetakan manual"} · {p.skuCount} varian
                        </div>
                      </TD>
                      <TD className="text-xs text-ink-2">{p.shopName ?? "-"}</TD>
                      <TD align="right" className="tabular-nums whitespace-nowrap">
                        {hargaRange(p.hargaMin, p.hargaMax)}
                      </TD>
                      <TD align="right">
                        <Button
                          size="sm"
                          variant="text"
                          loading={busy === p.productId}
                          onClick={() => tautkan(p.productId, null)}
                        >
                          Lepas
                        </Button>
                      </TD>
                    </TR>
                  )),
                )}
              </tbody>
            </Table>
          </TableWrap>
        </div>
      )}

      {/* Belum dipetakan: tarik ke master via dropdown SKU/nama. */}
      <div className="px-5 py-2 text-xs font-medium text-ink-2">
        Belum dipetakan ({belum.length})
      </div>
      {belum.length === 0 ? (
        <div className="px-5 pb-4 text-xs text-ink-3">
          Semua produk marketplace sudah menempel ke master.
        </div>
      ) : (
        <TableWrap>
          <Table className="min-w-[760px]">
            <THead>
              <tr>
                <TH>Produk (dari API)</TH>
                <TH>Toko</TH>
                <TH align="right">Harga API</TH>
                <TH>Status</TH>
                <TH>Tautkan ke master</TH>
              </tr>
            </THead>
            <tbody>
              {tampil.map((p) => (
                <TR key={p.productId}>
                  <TD>
                    <div className="text-ink">{p.title ?? "-"}</div>
                    <div className="text-[10px] text-ink-3">{p.skuCount} varian</div>
                  </TD>
                  <TD className="text-xs text-ink-2">{p.shopName ?? "-"}</TD>
                  <TD align="right" className="tabular-nums whitespace-nowrap">
                    {hargaRange(p.hargaMin, p.hargaMax)}
                  </TD>
                  <TD>
                    <Badge tone={p.status === "ACTIVATE" ? "success" : "neutral"}>
                      <span className="lowercase">{p.status ?? "-"}</span>
                    </Badge>
                  </TD>
                  <TD>
                    <div className="flex items-center gap-1.5">
                      <Select
                        value={pick[p.productId] ?? ""}
                        onChange={(e) => setPick((s) => ({ ...s, [p.productId]: e.target.value }))}
                        className="min-w-[170px]"
                      >
                        <option value="">— pilih master —</option>
                        {data.masters.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}{m.sku ? ` (${m.sku})` : ""}
                          </option>
                        ))}
                      </Select>
                      <Button
                        size="sm"
                        variant="filled"
                        disabled={!pick[p.productId]}
                        loading={busy === p.productId}
                        onClick={() => tautkan(p.productId, pick[p.productId] ?? null)}
                      >
                        Tautkan
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
      {belum.length > tampil.length && (
        <div className="px-5 py-3 border-t border-line">
          <Button variant="text" onClick={() => setLihatSemua(true)}>
            Tampilkan semua {belum.length}
          </Button>
        </div>
      )}
      <p className="px-5 py-3 text-[11px] text-ink-3 border-t border-line">
        Data ini dari sinkronisasi API marketplace. Produk menempel otomatis ke
        master bila seller SKU-nya sama; toko ini jarang mengisi seller SKU, jadi
        sebagian besar perlu ditautkan sekali di sini. Menautkan juga mengisi nama
        produk di menu Audit Pesanan.
      </p>
    </Card>
  );
}

function ProductDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data, loading, reload } = useFetch<MasterDetail>(`/products/${id}`);
  const shops = useFetch<Shop[]>("/shops");
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [delPosting, setDelPosting] = useState<Posting | null>(null);

  // edit form state
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [status, setStatus] = useState("active");
  const [aliases, setAliases] = useState("");
  const [catIds, setCatIds] = useState<string[]>([]);
  const kategori = useFetch<ShopCategory[]>("/shops/categories");

  // add-posting form state
  const [showAdd, setShowAdd] = useState(false);
  const [pShop, setPShop] = useState("");
  const [pTitle, setPTitle] = useState("");
  const [pItemId, setPItemId] = useState("");
  const [pPrice, setPPrice] = useState("");
  const [pStock, setPStock] = useState("");

  function startEdit() {
    if (!data) return;
    setName(data.name); setPrice(data.basePrice ?? ""); setStatus(data.status);
    setAliases(data.marketplaceAliases ?? "");
    setCatIds(data.shopCategoryIds ?? []);
    setEditing(true);
  }

  /**
   * Urutan yang dipilih ADALAH urutan yang disimpan.
   *
   * Yang pertama menjadi kategori utama, dan kolom lama shopCategoryId ikut
   * diisi dengannya supaya penyaring yang sudah ada tetap menemukan produk
   * ini. Karena itu ini daftar berurut, bukan sekumpulan centang tanpa urutan:
   * kalau urutannya tidak terlihat, "yang utama" jadi hasil kebetulan.
   */
  function toggleCat(catId: string) {
    setCatIds((v) => (v.includes(catId) ? v.filter((x) => x !== catId) : [...v, catId]));
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await api.patch(`/products/${id}`, {
        name,
        basePrice: price || undefined,
        status,
        marketplaceAliases: aliases,
        shopCategoryIds: catIds,
      });
      setEditing(false); reload(); onChanged();
      toast("Produk diperbarui", "success");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function removeMaster() {
    setBusy(true); setErr(null);
    try {
      await api.del(`/products/${id}`);
      toast("Master produk dihapus", "success");
      onChanged(); onClose();
    } catch (e) { setErr((e as Error).message); setBusy(false); setConfirmDelete(false); }
  }

  async function addPosting(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await api.post(`/products/${id}/postings`, {
        shopId: pShop,
        marketplaceItemId: pItemId,
        marketplaceSku: data?.sku,
        title: pTitle || undefined,
        price: pPrice || undefined,
        stock: pStock ? Number(pStock) : undefined,
        status: "active",
      });
      setShowAdd(false); setPShop(""); setPTitle(""); setPItemId(""); setPPrice(""); setPStock("");
      reload(); onChanged();
      toast("Postingan ditambahkan", "success");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function removePosting(postingId: string) {
    setBusy(true); setErr(null);
    try {
      await api.del(`/products/postings/${postingId}`);
      toast("Postingan dihapus", "success");
      reload(); onChanged();
    }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); setDelPosting(null); }
  }

  return (
    <>
      <Modal open onClose={onClose} title="Detail Produk" width="max-w-2xl">
        <div className="max-h-[70vh] overflow-y-auto -mx-1 px-1">
          {err && (
            <div className="mb-4">
              <InlineAlert tone="danger">{err}</InlineAlert>
            </div>
          )}

          {loading || !data ? (
            <div className="space-y-3 py-2">
              <Skeleton className="h-6 w-56" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <>
              {!editing ? (
                <div className="mb-5">
                  <div className="text-lg font-medium text-ink">{data.name}</div>
                  <div className="text-xs font-mono text-ink-3 mt-0.5">SKU: {data.sku}</div>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mt-2.5 text-sm text-ink-2">
                    <span>
                      Harga <span className="text-ink font-medium tabular-nums">{rupiah(data.basePrice)}</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      Status
                      <Badge tone={STATUS_TONE[data.status] ?? "neutral"}>
                        <span className="capitalize">{data.status}</span>
                      </Badge>
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3.5">
                    <Button size="sm" variant="outline" icon="pencil" onClick={startEdit}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      icon="trash"
                      disabled={busy}
                      onClick={() => setConfirmDelete(true)}
                    >
                      Hapus
                    </Button>
                  </div>
                </div>
              ) : (
                <form onSubmit={saveEdit} className="mb-5 rounded-lg border border-line p-4 space-y-3.5">
                  <Field label="Nama" required>
                    <Input value={name} onChange={(e) => setName(e.target.value)} required />
                  </Field>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <Field label="Harga">
                      <Input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
                    </Field>
                    <Field label="Status">
                      <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                        <option value="active">active</option>
                        <option value="inactive">inactive</option>
                        <option value="draft">draft</option>
                      </Select>
                    </Field>
                  </div>
                  <Field
                    label="Kategori"
                    hint="Boleh lebih dari satu. Yang pertama dipilih menjadi kategori utama, dan itulah yang dipakai penyaring serta laporan per kategori."
                  >
                    <div className="flex flex-wrap gap-2">
                      {(kategori.data ?? []).map((c) => {
                        const urut = catIds.indexOf(c.id);
                        const dipilih = urut >= 0;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => toggleCat(c.id)}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                              dipilih
                                ? "border-transparent text-white"
                                : "border-line bg-white text-ink-2 hover:bg-canvas"
                            }`}
                            style={dipilih ? { backgroundColor: c.color ?? "#0E6E55" } : undefined}
                          >
                            {dipilih && (
                              <span className="rounded-full bg-white/25 px-1.5 text-[10px]">
                                {urut === 0 ? "utama" : urut + 1}
                              </span>
                            )}
                            {c.name}
                          </button>
                        );
                      })}
                      {(kategori.data ?? []).length === 0 && (
                        <span className="text-xs text-ink-3">
                          Belum ada kategori. Buat dulu di halaman Toko Saya.
                        </span>
                      )}
                    </div>
                  </Field>

                  <Field
                    label="Nama di Marketplace (alias)"
                    hint="Satu nama per baris. Dipakai aplikasi scan untuk mengenali produk ini dari judul iklan yang tercetak di resi — judul iklan jarang sama dengan nama master."
                  >
                    <textarea
                      value={aliases}
                      onChange={(e) => setAliases(e.target.value)}
                      rows={3}
                      placeholder={"Renature Cool Mint Mouthspray\nMouthspray Cool Mint 100ml"}
                      className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-3"
                    />
                  </Field>
                  <div className="flex gap-2">
                    <Button type="submit" variant="filled" size="sm" loading={busy}>
                      Simpan
                    </Button>
                    <Button type="button" variant="text" size="sm" onClick={() => setEditing(false)}>
                      Batal
                    </Button>
                  </div>
                </form>
              )}

              <div className="flex items-center justify-between gap-2 mb-2.5">
                <div className="text-sm font-medium text-ink">Postingan per Toko</div>
                <Button
                  size="sm"
                  variant="text"
                  icon={showAdd ? "close" : "plus"}
                  onClick={() => setShowAdd(!showAdd)}
                >
                  {showAdd ? "Tutup" : "Tambah postingan"}
                </Button>
              </div>

              {showAdd && (
                <form onSubmit={addPosting} className="mb-4 rounded-lg border border-line p-4 space-y-3.5">
                  <Field label="Toko" required>
                    <Select value={pShop} onChange={(e) => setPShop(e.target.value)} required>
                      <option value="">Pilih toko…</option>
                      {(shops.data ?? []).map((s) => (
                        <option key={s.id} value={s.id}>{s.shopName ?? s.id} ({s.marketplace})</option>
                      ))}
                    </Select>
                  </Field>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <Field label="Marketplace item ID" required>
                      <Input value={pItemId} onChange={(e) => setPItemId(e.target.value)} required />
                    </Field>
                    <Field label="Judul postingan">
                      <Input value={pTitle} onChange={(e) => setPTitle(e.target.value)} />
                    </Field>
                    <Field label="Harga">
                      <Input inputMode="numeric" value={pPrice} onChange={(e) => setPPrice(e.target.value)} />
                    </Field>
                    <Field label="Stok">
                      <Input
                        inputMode="numeric"
                        value={pStock}
                        onChange={(e) => setPStock(e.target.value.replace(/\D/g, ""))}
                      />
                    </Field>
                  </div>
                  <div className="text-xs text-ink-3">
                    SKU postingan otomatis = <span className="font-mono text-ink-2">{data.sku}</span> (untuk linking).
                  </div>
                  <Button type="submit" variant="filled" size="sm" icon="plus" loading={busy}>
                    Tambah
                  </Button>
                </form>
              )}

              {!data.shops.length ? (
                <EmptyState
                  icon="store"
                  title="Belum ada postingan terhubung"
                  description="Tambahkan postingan agar stok dan harga tersinkron per marketplace."
                  className="py-8"
                />
              ) : (
                data.shops.map((sg) => {
                  const badge = MP_BADGE[sg.marketplace] ?? { label: sg.marketplace, tone: "neutral" as Tone };
                  return (
                    <div key={sg.shopId} className="mb-4">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs font-medium text-ink-2">{sg.shopName ?? sg.shopId}</span>
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                      </div>
                      <div className="border border-line rounded-lg divide-y divide-line">
                        {sg.postings.map((p) => (
                          <div key={p.id} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
                            <div className="min-w-0">
                              <div className="text-sm text-ink truncate">
                                {p.title ?? p.marketplaceSku ?? p.id}
                              </div>
                              {p.marketplaceItemId && (
                                <div className="text-xs font-mono text-ink-3 mt-0.5">
                                  Product ID: {p.marketplaceItemId}
                                </div>
                              )}
                              <div className="text-xs text-ink-2 mt-0.5 tabular-nums">
                                {rupiah(p.price)} · stok {p.stock ?? 0} · {p.status}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="text"
                              icon="trash"
                              className="text-red-600 hover:bg-red-50 shrink-0"
                              aria-label="Hapus postingan"
                              onClick={() => setDelPosting(p)}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}

              <MasterBom masterId={id} masterName={data.name} />
            </>
          )}
        </div>
      </Modal>

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={removeMaster}
        title="Hapus master produk"
        description="Master produk ini beserta semua postingannya akan dihapus. Tindakan ini tidak bisa dibatalkan."
        loading={busy}
      />

      <ConfirmModal
        open={delPosting != null}
        onClose={() => setDelPosting(null)}
        onConfirm={() => delPosting && removePosting(delPosting.id)}
        title="Hapus postingan"
        description={
          <>
            Hapus postingan{" "}
            <b>{delPosting?.title ?? delPosting?.marketplaceSku ?? delPosting?.id}</b>?
          </>
        }
        loading={busy}
      />
    </>
  );
}

interface BomLite {
  id: string;
  masterProductId: string;
  materialName: string;
  quantity: string;
  unit: string | null;
  currentStock: string;
  minimumThreshold: string;
  lowStock: boolean;
}

/** BOM materials linked to this master product (read + quick add). */
function MasterBom({ masterId, masterName }: { masterId: string; masterName: string }) {
  const { data, reload } = useFetch<BomLite[]>("/bom");
  const toast = useToast();
  const linked = (data ?? []).filter((b) => b.masterProductId === masterId);
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await api.post("/bom", { masterProductId: masterId, materialName: name, quantity: qty, unit: unit || undefined });
      setShow(false); setName(""); setQty(""); reload();
      toast("Bahan baku ditambahkan", "success");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="mt-5 pt-4 border-t border-line">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="text-sm font-medium text-ink">Bahan Baku (BOM)</div>
        <Button
          size="sm"
          variant="text"
          icon={show ? "close" : "plus"}
          onClick={() => setShow(!show)}
        >
          {show ? "Tutup" : "Tambah bahan"}
        </Button>
      </div>

      {show && (
        <form onSubmit={add} className="mb-3 rounded-lg border border-line p-4 space-y-3.5">
          {err && <InlineAlert tone="danger">{err}</InlineAlert>}
          <Field label="Nama bahan" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Field label="Qty/produk" required>
              <Input placeholder="mis. 2" value={qty} onChange={(e) => setQty(e.target.value)} required />
            </Field>
            <Field label="Satuan">
              <Input placeholder="pcs/gram/m" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </Field>
          </div>
          <Button type="submit" variant="filled" size="sm" icon="plus" loading={busy}>
            Tambah ke {masterName}
          </Button>
        </form>
      )}

      {!linked.length ? (
        <div className="text-xs text-ink-2 py-2">
          Belum ada bahan baku. Tambahkan agar stok auto-deduct saat order masuk.
        </div>
      ) : (
        <div className="border border-line rounded-lg divide-y divide-line">
          {linked.map((b) => (
            <div
              key={b.id}
              className={`flex items-center justify-between gap-3 px-3.5 py-2.5 ${b.lowStock ? "bg-red-50/60" : ""}`}
            >
              <div className="min-w-0 text-sm text-ink truncate">
                {b.materialName}{" "}
                <span className="text-xs text-ink-3">{b.quantity}{b.unit}/produk</span>
              </div>
              <div className="text-xs text-ink-2 whitespace-nowrap tabular-nums">
                stok{" "}
                <span className={b.lowStock ? "text-red-600 font-medium" : "text-ink font-medium"}>
                  {b.currentStock}
                </span>{" "}
                / min {b.minimumThreshold}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
