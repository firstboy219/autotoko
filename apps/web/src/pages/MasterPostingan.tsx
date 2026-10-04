import { useCallback, useEffect, useRef, useState } from "react";
import { Layout } from "../components/Layout";
import { api } from "../lib/api";
import { Icon } from "../components/Icon";
import { rupiah } from "../lib/fmt";
import { calculatePublishPricing } from "@autotoko/shared";
import { RichText } from "../components/RichText";
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
  publishPrice: number | null;
  hpp: number | null;
  hppCents: number;
  marketplaceFeeRate: number;
  eventRate: number;
  affiliatorRate: number;
  adsRate: number;
  adsFixedCents: number;
  sedekahRate: number;
  resellerRate: number;
}
interface SkuRow {
  id: string;
  combo: Record<string, string>;
  comboKey: string;
  sku: string | null;
  masterProductId: string | null;
  price: string | null;
  marketplacePrice: string | null;
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
  images: string[];
  description: string | null;
  priceMin: number | null;
  priceMax: number | null;
  imageCount: number;
  skuCount: number;
  skuMappedCount: number;
  mappingCount: number;
  sales30d: number;
  revenue30d: number;
  updatedAt: string;
}

interface SalesRow {
  shopId: string;
  shopName: string | null;
  productId: string;
  units30d: number;
  revenue30d: number;
  orders30d: number;
  avgUnitsPerWeek: number;
}
interface SalesResp {
  windowDays: number;
  totalUnits: number;
  totalRevenue: number;
  avgUnitsPerWeek: number;
  rows: SalesRow[];
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
  sold30d?: number;
  revenue30d?: number;
  orders30d?: number;
}
interface ApplyResult {
  total: number;
  ok: number;
  gagal: number;
  dilewati: number;
  hppDiperbarui?: number;
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
    url?: string | null;
    sellerUrl?: string | null;
    verifiedTitle?: string | null;
    verifiedDescription?: string | null;
  }[];
}

function listingUrl(marketplace: string, productId: string | null): string | null {
  if (!productId) return null;
  if (marketplace === "tiktok") return `https://shop.tiktok.com/view/product/${productId}`;
  return null;
}

/** HTML deskripsi marketplace → teks rapi untuk diedit (tanpa tampak kode <>). */
function htmlToText(html: string): string {
  if (!html) return "";
  const t = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  return t.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();
}
function priceLabel(min: number | null, max: number | null): string {
  if (min == null && max == null) return "Harga belum diisi";
  if (min != null && max != null && min !== max) return `${rupiah(min)} – ${rupiah(max)}`;
  return rupiah(min ?? max ?? 0);
}

function ExpandableDesc({ html }: { html: string }) {
  const [open, setOpen] = useState(false);
  const text = htmlToText(html);
  if (!text) return null;
  return (
    <div className="text-[11px] text-ink-2">
      <div className={open ? "" : "line-clamp-2"}>{text}</div>
      {text.length > 70 && (
        <button className="text-brand-ink hover:underline mt-0.5" onClick={() => setOpen((o) => !o)}>
          {open ? "Tutup" : "Selengkapnya"}
        </button>
      )}
    </div>
  );
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
  const [importing, setImporting] = useState(false);
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
          <>
            <Button variant="outline" icon="download" onClick={() => setImporting(true)}>
              Impor dari Marketplace
            </Button>
            <Button variant="filled" icon="plus" onClick={() => setCreating(true)}>
              Buat Master Postingan
            </Button>
          </>
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
            description="Impor dari listing marketplace yang sudah ada (paling cepat), atau buat manual: susun varian & SKU, petakan ke listing di tiap toko, lalu terapkan sekali untuk semuanya."
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="filled" icon="download" onClick={() => setImporting(true)}>
                  Impor dari Marketplace
                </Button>
                <Button variant="outline" icon="plus" onClick={() => setCreating(true)}>
                  Buat manual
                </Button>
              </div>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((it) => (
            <div
              key={it.id}
              className="rounded-xl border border-line bg-white overflow-hidden flex flex-col hover:shadow-e2 transition"
            >
              <button className="block text-left" onClick={() => setOpenId(it.id)}>
                <div className="aspect-square bg-canvas relative">
                  {it.images?.[0] ? (
                    <img
                      src={it.images[0]}
                      alt={it.name}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-ink-3">
                      <Icon name="image" size={28} />
                    </div>
                  )}
                  <span className="absolute top-1.5 left-1.5">
                    <Badge tone={it.status === "active" ? "success" : "warning"}>{it.status}</Badge>
                  </span>
                </div>
              </button>
              <div className="p-2.5 flex flex-col gap-1 flex-1">
                <button
                  onClick={() => setOpenId(it.id)}
                  className="text-left text-sm font-medium text-ink leading-snug line-clamp-2 hover:text-brand-ink"
                >
                  {it.name}
                </button>
                <div className="text-[15px] font-semibold text-ink">{priceLabel(it.priceMin, it.priceMax)}</div>
                {it.sales30d > 0 ? (
                  <div className="text-[11px] text-ink-2">
                    Terjual 30h: <span className="font-medium text-ink">{it.sales30d}</span> · {rupiah(it.revenue30d)}
                  </div>
                ) : (
                  <div className="text-[11px] text-ink-3">Belum ada penjualan 30h</div>
                )}
                {it.brand && <div className="text-[11px] text-ink-3 truncate">{it.brand}</div>}
                {it.description && <ExpandableDesc html={it.description} />}
                <div className="mt-auto flex flex-wrap gap-1 pt-1.5">
                  <Badge tone="neutral" icon="tag">{it.skuCount} SKU</Badge>
                  <Badge tone={it.skuMappedCount === it.skuCount && it.skuCount > 0 ? "success" : "neutral"}>
                    {it.skuMappedCount}/{it.skuCount} terpeta
                  </Badge>
                  <Badge tone={it.mappingCount > 0 ? "info" : "neutral"} icon="store">
                    {it.mappingCount} toko
                  </Badge>
                </div>
              </div>
            </div>
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

      <ImportModal
        open={importing}
        onClose={() => setImporting(false)}
        onImported={(newId) => {
          setImporting(false);
          void load();
          setOpenId(newId);
        }}
      />
    </Layout>
  );
}

function ImportModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (id: string) => void;
}) {
  const [shops, setShops] = useState<ShopOpt[]>([]);
  const [shopId, setShopId] = useState("");
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [productId, setProductId] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    api.get<ShopOpt[]>("/marketplace-sync/shops").then(setShops).catch(() => {});
  }, [open]);

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

  async function doImport() {
    if (!shopId || !productId) return;
    setBusy(true);
    try {
      const d = await api.post<Detail>("/master-postings/import", { shopId, productId });
      toast("Template dibuat dari listing", "success");
      setShopId("");
      setProductId("");
      onImported(d.id);
    } catch (e) {
      toast((e as Error).message || "Gagal mengimpor", "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Impor dari Marketplace"
      width="max-w-lg"
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            Batal
          </Button>
          <Button variant="filled" icon="download" loading={busy} disabled={!shopId || !productId} onClick={doImport}>
            Impor jadi Master
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-ink-2">
          Pilih listing yang sudah ada — sistem mengambil nama, deskripsi, gambar, dan varian/SKU-nya sebagai template induk.
          SKU yang kodenya cocok dengan master produk AutoToko langsung dipetakan, dan listing ini otomatis jadi salah satu tujuan Terapkan.
        </p>
        <Field label="Toko">
          <SearchSelect
            value={shopId}
            onChange={setShopId}
            placeholder="Pilih toko…"
            options={shops.map((s) => ({ value: s.id, label: `${s.shopName ?? s.id.slice(0, 8)} (${s.marketplace})` }))}
          />
        </Field>
        <Field label="Listing marketplace">
          <SearchSelect
            value={productId}
            onChange={setProductId}
            disabled={!shopId || loading}
            placeholder={loading ? "Memuat…" : "Pilih listing…"}
            options={products.map((p) => ({ value: p.productId, label: `${(p.title ?? "(tanpa judul)").slice(0, 58)} · 30hr: ${p.sold30d ?? 0}x` }))}
          />
        </Field>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ editor */

interface CompareShop {
  shopId: string;
  shop: string | null;
  productId?: string;
  mappingId?: string;
  hasListing: boolean;
  mode?: string;
  error?: string;
  namaSesuai?: boolean;
  liveName?: string;
  deskripsiSesuai?: boolean | null;
  varianLive?: number;
  varianTemplate?: number;
  hargaSesuai?: number;
  hargaBeda?: number;
  hargaTakCocok?: number;
}
interface CompareResp {
  template: { name: string; hasDesc: boolean; varianCount: number };
  shops: CompareShop[];
  missing: { shopId: string; shop: string | null }[];
}

/** Bandingkan listing antar toko vs Master Postingan + harga HPP, lalu samakan. */
function CompareShops({ postingId, onReload }: { postingId: string; onReload: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<CompareResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    try {
      setData(await api.get<CompareResp>(`/master-postings/${postingId}/compare`));
    } catch (e) {
      toast((e as Error).message || "Gagal membandingkan", "danger");
    } finally {
      setLoading(false);
    }
  }
  async function samakanHarga() {
    setBusy("harga");
    try {
      const r = await api.post<{ masters: number; updated: number; gagal: number }>(
        `/master-postings/${postingId}/push-prices`,
        {},
      );
      toast(`Harga HPP: ${r.updated} varian diperbarui${r.gagal ? ` · ${r.gagal} gagal` : ""}`, r.gagal ? "warning" : "success");
      await run();
    } catch (e) {
      toast((e as Error).message || "Gagal samakan harga", "danger");
    } finally {
      setBusy(null);
    }
  }
  async function terapkan(mappingId: string) {
    setBusy(mappingId);
    try {
      const r = await api.post<{ ok: number; gagal: number; dilewati: number }>(
        `/master-postings/${postingId}/mappings/${mappingId}/apply`,
        { withImages: false },
      );
      toast(`Terapkan: ${r.ok} ok · ${r.gagal} gagal · ${r.dilewati} dilewati`, r.gagal ? "warning" : "success");
      await run();
      onReload();
    } catch (e) {
      toast((e as Error).message || "Gagal terapkan", "danger");
    } finally {
      setBusy(null);
    }
  }

  const chip = (label: string, ok: boolean | null | undefined, extra?: string) => (
    <span
      className={`rounded px-1.5 py-0.5 text-[11px] ${
        ok == null ? "bg-canvas text-ink-3" : ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600 font-medium"
      }`}
    >
      {label}
      {extra ? ` ${extra}` : ok == null ? "" : ok ? " ✓" : " beda"}
    </span>
  );

  return (
    <Card className="mt-4" padded={false}>
      <CardHeader
        title="Bandingkan antar toko"
        subtitle="Acuan = Master Postingan (nama/deskripsi/varian) + harga HPP. Lihat toko mana yang beda, lalu samakan."
        action={
          <div className="flex flex-wrap gap-2">
            {data && (
              <Button size="sm" variant="filled" loading={busy === "harga"} onClick={samakanHarga}>
                Samakan harga HPP (semua)
              </Button>
            )}
            <Button size="sm" variant="outline" icon="search" loading={loading} onClick={run}>
              {data ? "Bandingkan ulang" : "Bandingkan"}
            </Button>
          </div>
        }
      />
      {data && (
        <div className="space-y-2 p-5">
          {data.shops.length === 0 && data.missing.length === 0 && (
            <div className="text-sm text-ink-3">Belum ada listing termapping.</div>
          )}
          {data.shops.map((s, i) => {
            const hargaOk = (s.hargaBeda ?? 0) === 0 && (s.hargaTakCocok ?? 0) === 0;
            const perlu =
              !s.error &&
              (s.namaSesuai === false || s.deskripsiSesuai === false || s.varianLive !== s.varianTemplate || !hargaOk);
            return (
              <div key={i} className="flex flex-wrap items-center gap-2 border-b border-line pb-2 last:border-0">
                <span className="min-w-0 flex-1 truncate text-sm text-ink" title={s.shop ?? ""}>
                  {s.shop ?? s.shopId.slice(0, 8)}
                  {s.productId && <span className="ml-1 font-mono text-[10px] text-ink-3">…{s.productId.slice(-5)}</span>}
                </span>
                {s.error ? (
                  <span className="text-xs text-red-600">{s.error}</span>
                ) : (
                  <div className="flex flex-wrap items-center gap-1">
                    {chip("Nama", s.namaSesuai)}
                    {chip("Deskripsi", s.deskripsiSesuai)}
                    {chip("Varian", s.varianLive === s.varianTemplate, `${s.varianLive}/${s.varianTemplate}`)}
                    {chip("Harga", hargaOk, hargaOk ? undefined : `${s.hargaBeda}beda${s.hargaTakCocok ? `/${s.hargaTakCocok}?` : ""}`)}
                    {perlu && s.mappingId ? (
                      <Button size="sm" variant="outline" loading={busy === s.mappingId} onClick={() => terapkan(s.mappingId!)}>
                        Samakan
                      </Button>
                    ) : (
                      !perlu && <span className="text-[11px] text-emerald-700">sudah sama</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {data.missing.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-800">
              Belum ada listing di: <b>{data.missing.map((m) => m.shop).join(", ")}</b>. Membuat listing baru otomatis
              belum didukung (butuh pipeline gambar/kategori TikTok) — buat listing-nya dulu di toko itu lalu Import,
              atau tambah mapping "Posting baru" di bawah.
            </div>
          )}
          <div className="text-[11px] text-ink-3">
            "Samakan" per toko = Terapkan (nama, deskripsi, varian, SKU, harga, stok). "Samakan harga HPP" = kirim harga
            publish HPP ke semua listing. Kolom Harga dibandingkan ke harga publish HPP.
          </div>
        </div>
      )}
    </Card>
  );
}

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
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<null | "all" | string>(null);
  const [withImages, setWithImages] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [delMode, setDelMode] = useState<null | "autotoko" | "marketplace">(null);
  const [deleting, setDeleting] = useState(false);
  const [sales, setSales] = useState<SalesResp | null>(null);

  const reloadMasters = useCallback(async () => {
    await api.get<MasterOpt[]>("/master-postings/master-products").then(setMasters).catch(() => {});
  }, []);

  const refetch = useCallback(async () => {
    const detail = await api.get<Detail>(`/master-postings/${id}`);
    setD(detail);
    setName(detail.name);
    setDescription(detail.description ?? "");
    setBrand(detail.brand ?? "");
    setAutoApply(detail.autoApply);
    setImages(detail.images ?? []);
    setGroups(detail.variantGroups ?? []);
    api.get<SalesResp>(`/master-postings/${id}/sales`).then(setSales).catch(() => {});
  }, [id]);

  useEffect(() => {
    void refetch().catch((e) => toast((e as Error).message || "Gagal memuat", "danger"));
    void reloadMasters();
    void api.get<ShopOpt[]>("/marketplace-sync/shops").then(setShops).catch(() => {});
  }, [refetch, reloadMasters, toast]);

  async function saveInfo() {
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
    } catch (e) {
      toast((e as Error).message || "Gagal menyimpan", "danger");
    } finally {
      setSaving(false);
    }
  }

  function addOrUpdateImage() {
    const u = newImage.trim();
    if (!u) return;
    if (editIndex === null) setImages((a) => [...a, u]);
    else setImages((a) => a.map((x, j) => (j === editIndex ? u : x)));
    setNewImage("");
    setEditIndex(null);
  }

  async function doApply() {
    const target = confirmTarget;
    if (!target) return;
    setApplying(true);
    setConfirmTarget(null);
    try {
      const url =
        target === "all"
          ? `/master-postings/${id}/apply`
          : `/master-postings/${id}/mappings/${target}/apply`;
      const r = await api.post<ApplyResult>(url, { withImages });
      setApplyResult(r);
      await refetch();
      toast(`Terapkan: ${r.ok} berhasil · ${r.gagal} gagal · ${r.dilewati} dilewati`, r.gagal ? "warning" : "success");
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

  const salesByKey = new Map((sales?.rows ?? []).map((r) => [`${r.shopId}:${r.productId}`, r] as const));

  async function doDelete() {
    if (!delMode) return;
    setDeleting(true);
    try {
      if (delMode === "autotoko") {
        await api.del(`/master-postings/${id}`);
        toast("Master posting dihapus dari AutoToko. Listing di marketplace tetap tayang.", "success");
        setDelMode(null);
        onBack();
        return;
      }
      const r = await api.post<{ total: number; ok: number; gagal: number; dilewati: number; catatan?: string }>(
        `/master-postings/${id}/delete-marketplace`,
      );
      if (r.total === 0) toast(r.catatan ?? "Tidak ada listing marketplace untuk dihapus.", "warning");
      else toast(
        `Listing dihapus di marketplace: ${r.ok} berhasil${r.gagal ? `, ${r.gagal} gagal` : ""}${r.dilewati ? `, ${r.dilewati} dilewati` : ""}. Master posting tetap di AutoToko.`,
        r.gagal ? "warning" : "success",
      );
      setDelMode(null);
      await refetch();
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setDeleting(false);
    }
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
            <Button variant="outline" loading={saving} onClick={() => saveInfo()}>
              Simpan
            </Button>
            <label
              className="flex items-center gap-1.5 text-xs text-ink-2 select-none"
              title="Gambar memicu TINJAUAN ULANG (audit) listing di TikTok. Biarkan mati bila cuma mau update nama/deskripsi/harga."
            >
              <input type="checkbox" checked={withImages} onChange={(e) => setWithImages(e.target.checked)} />
              Sertakan gambar
            </label>
            <Button
              variant="filled"
              icon="upload"
              loading={applying}
              onClick={() => setConfirmTarget("all")}
              disabled={d.mappings.length === 0}
            >
              Jalankan Semua Baris
            </Button>
            <Button variant="outline" icon="trash" onClick={() => setDelMode("autotoko")}>
              Hapus di AutoToko
            </Button>
            <Button variant="danger" icon="trash" onClick={() => setDelMode("marketplace")} disabled={d.mappings.filter((m) => m.marketplace === "tiktok" && m.status !== "create").length === 0}>
              Hapus di Marketplace
            </Button>
          </>
        }
      />

      {applyResult && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium text-ink">Bukti Penerapan — cek langsung di tiap toko</div>
            <div className="text-xs text-ink-2">
              {applyResult.ok} berhasil · {applyResult.gagal} gagal · {applyResult.dilewati} distage
            </div>
          </div>
          {!!applyResult.hppDiperbarui && (
            <div className="mt-1 text-xs text-ink-3">
              Harga publish {applyResult.hppDiperbarui} master produk ikut diperbarui di menu HPP &amp; harga jual.
            </div>
          )}
          {applyResult.catatanGambar && <div className="mt-1 text-xs text-ink-3">{applyResult.catatanGambar}</div>}
          {applyResult.catatan && <div className="mt-1 text-xs text-ink-3">{applyResult.catatan}</div>}
          <div className="mt-3 divide-y divide-line">
            {applyResult.hasil.map((h, i) => (
              <div key={i} className="py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={h.status === "ok" ? "success" : h.status === "failed" ? "danger" : "warning"}>
                    {h.status === "ok" ? "Diperbarui" : h.status === "failed" ? "Gagal" : "Distage"}
                  </Badge>
                  <span className="text-sm text-ink">{h.shop ?? h.productId}</span>
                  {h.sellerUrl && (
                    <a
                      href={h.sellerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-brand-ink hover:underline"
                    >
                      Cek di Seller Center <Icon name="externalLink" size={13} />
                    </a>
                  )}
                  {h.url && (
                    <a
                      href={h.url}
                      target="_blank"
                      rel="noreferrer"
                      className={`inline-flex items-center gap-1 text-xs text-ink-3 hover:underline ${h.sellerUrl ? "" : "ml-auto"}`}
                      title="Etalase publik — bisa tertunda karena cache TikTok"
                    >
                      Etalase <Icon name="externalLink" size={12} />
                    </a>
                  )}
                </div>
                {h.verifiedTitle && (
                  <div className="text-xs text-ink-2 mt-1">
                    judul kini di TikTok: <span className="text-ink">“{h.verifiedTitle}”</span>
                  </div>
                )}
                {h.verifiedDescription && (
                  <div className="text-xs text-ink-3 mt-0.5 truncate" title={h.verifiedDescription}>
                    deskripsi kini: {h.verifiedDescription}…
                  </div>
                )}
                {h.applied && h.applied.length > 0 && (
                  <div className="text-xs text-emerald-700 mt-1">Terkirim: {h.applied.join(", ")}</div>
                )}
                {h.pending && h.pending.length > 0 && (
                  <div className="text-xs text-amber-700 mt-0.5">Tertunda/dilewati: {h.pending.join(", ")}</div>
                )}
                {(h.reason || h.error) && <div className="text-xs text-ink-3 mt-1">{h.reason ?? h.error}</div>}
              </div>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-ink-3">
            Judul &amp; deskripsi di atas dibaca langsung dari TikTok setelah update = kondisi sebenarnya. Etalase publik
            (storefront) bisa perlu beberapa menit menyegarkan karena cache TikTok — buka <b>Seller Center</b> untuk
            melihat perubahan seketika.
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Info dasar */}
        <Card>
          <div className="text-sm font-medium text-ink mb-3">Info Dasar</div>
          <div className="space-y-3">
            <Field label="Nama postingan / produk" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Deskripsi" hint="Format dengan toolbar; tampilannya sama seperti di halaman produk marketplace.">
              <RichText value={description} onChange={setDescription} placeholder="Tulis deskripsi produk…" />
              <div className="mt-3">
                <div className="text-[10px] uppercase tracking-wide text-ink-3 mb-1">Pratinjau (tampilan pembeli)</div>
                <div className="rounded-lg border border-line bg-white p-3">
                  {description.trim() ? (
                    <div
                      className="text-sm text-ink leading-relaxed [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-2"
                      dangerouslySetInnerHTML={{ __html: description }}
                    />
                  ) : (
                    <div className="text-sm text-ink-3">—</div>
                  )}
                </div>
              </div>
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
          {images.length === 0 && (
            <div className="text-xs text-ink-3 mb-2">Belum ada gambar. Tambah lewat URL di bawah.</div>
          )}
          <div className="flex flex-wrap gap-2">
            {images.map((url, i) => (
              <div key={i} className="relative w-20 h-20 rounded-lg border border-line overflow-hidden bg-canvas group">
                <img
                  src={url}
                  alt={`gambar ${i + 1}`}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
                <span className="absolute top-0.5 left-0.5 text-[10px] leading-none bg-white/85 text-ink rounded px-1 py-0.5">
                  {i + 1}
                </span>
                <div className="absolute inset-x-0 bottom-0 flex justify-center gap-0.5 bg-white/90 py-0.5 opacity-0 group-hover:opacity-100 transition">
                  <button className="p-0.5 text-ink-2 hover:text-ink disabled:opacity-30" disabled={i === 0} title="Geser kiri" onClick={() => setImages((a) => swap(a, i, i - 1))}>
                    <Icon name="arrowLeft" size={13} />
                  </button>
                  <button className="p-0.5 text-ink-2 hover:text-ink disabled:opacity-30" disabled={i === images.length - 1} title="Geser kanan" onClick={() => setImages((a) => swap(a, i, i + 1))}>
                    <Icon name="arrowRight" size={13} />
                  </button>
                  <button className="p-0.5 text-ink-2 hover:text-ink" title="Ganti URL" onClick={() => { setEditIndex(i); setNewImage(url); }}>
                    <Icon name="pencil" size={13} />
                  </button>
                  <button className="p-0.5 text-red-500 hover:text-red-600" title="Hapus" onClick={() => { setImages((a) => a.filter((_, j) => j !== i)); if (editIndex === i) { setEditIndex(null); setNewImage(""); } }}>
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-2">
            <Input
              value={newImage}
              onChange={(e) => setNewImage(e.target.value)}
              placeholder={editIndex === null ? "https://…/gambar.jpg" : `Ganti URL gambar ke-${editIndex + 1}`}
              onKeyDown={(e) => {
                if (e.key === "Enter") addOrUpdateImage();
              }}
            />
            <Button variant="outline" icon={editIndex === null ? "plus" : "check"} onClick={addOrUpdateImage}>
              {editIndex === null ? "Tambah" : "Simpan"}
            </Button>
            {editIndex !== null && (
              <Button variant="text" onClick={() => { setEditIndex(null); setNewImage(""); }}>
                Batal
              </Button>
            )}
          </div>
          <div className="text-[11px] text-ink-3 mt-2">
            Kelola gambar di sini (tambah/ganti/hapus/urutkan). Propagasi daftar gambar ke marketplace menunggu unggah gambar TikTok (tahap berikutnya); nama &amp; deskripsi sudah diterapkan saat Terapkan.
          </div>
        </Card>
      </div>

      <AtributKategori
        postingId={id}
        categoryId={d.categoryId}
        shopId={d.mappings[0]?.shopId}
        attributes={d.attributes}
        onSaved={refetch}
      />

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
                  <TH align="right">HPP</TH>
                  <TH align="right">Harga produk</TH>
                  <TH align="right">Margin / profit bersih</TH>
                  <TH align="right">Marketplace (publish)</TH>
                  <TH align="right">Stok</TH>
                  <TH></TH>
                </TR>
              </THead>
              <tbody>
                {d.skus.map((s) => (
                  <SkuRowEditor key={s.id} postingId={id} row={s} masters={masters} onSaved={refetch} onMasterPriceSaved={reloadMasters} />
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <CompareShops postingId={id} onReload={refetch} />

      {/* Mapping ke toko */}
      <Card className="mt-4" padded={false}>
        <CardHeader
          title="Listing per Toko (instruksi penerapan)"
          subtitle='Tiap baris punya modenya sendiri: "Update listing" memperbarui listing yang tayang; "Posting baru" distage. Terapkan per toko lewat tombol di barisnya, atau semua sekaligus lewat "Jalankan Semua Baris".'
        />
        <div className="p-5 space-y-3">
          {sales && sales.totalUnits > 0 && (
            <div className="rounded-lg bg-canvas border border-line px-3 py-2 text-xs text-ink-2">
              Penjualan 30 hari (toko termapping): <b className="text-ink">{sales.totalUnits}</b> unit ·{" "}
              {rupiah(sales.totalRevenue)} · rata-rata ~{sales.avgUnitsPerWeek}/minggu
            </div>
          )}
          <MappingAdder postingId={id} shops={shops} onAdded={refetch} />
          {d.mappings.length === 0 ? (
            <div className="text-sm text-ink-2">Belum ada listing termapping.</div>
          ) : (
            <div className="space-y-2">
              {d.mappings.map((m) => (
                <div key={m.id} className="rounded-lg border border-line px-3 py-2">
                  <div className="flex items-center gap-2">
                  <Badge tone="neutral" icon="store">{m.shopName ?? m.shopId.slice(0, 8)}</Badge>
                  <Badge tone={m.status === "create" ? "warning" : "info"}>
                    {m.status === "create" ? "Posting baru" : "Update listing"}
                  </Badge>
                  <span className="text-xs text-ink-2 font-mono">{m.productId || "(akan dibuat)"}</span>
                  {(() => {
                    const sv = salesByKey.get(`${m.shopId}:${m.productId}`);
                    return sv && sv.units30d > 0 ? (
                      <span className="text-[11px] text-ink-2">
                        · {sv.units30d} terjual/30h (~{sv.avgUnitsPerWeek}/mgg)
                      </span>
                    ) : null;
                  })()}
                  {m.lastStatus && <Badge tone={STATUS_TONE[m.lastStatus] ?? "neutral"}>{m.lastStatus}</Badge>}
                  {m.lastMessage && <span className="text-[11px] text-ink-3 truncate max-w-[220px]" title={m.lastMessage}>{m.lastMessage}</span>}
                  <div className="ml-auto flex items-center gap-1.5">
                    {listingUrl(m.marketplace, m.productId) && (
                      <a
                        href={listingUrl(m.marketplace, m.productId)!}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-ink-3 hover:underline"
                        title="Etalase publik — bisa tertunda karena cache TikTok"
                      >
                        Etalase <Icon name="externalLink" size={13} />
                      </a>
                    )}
                    <Button variant="outline" size="sm" icon="upload" loading={applying} onClick={() => setConfirmTarget(m.id)}>
                      Terapkan
                    </Button>
                    <button
                      className="text-red-500 hover:text-red-600"
                      onClick={async () => {
                        await api.del(`/master-postings/${id}/mappings/${m.id}`);
                        await refetch();
                      }}
                      title="Lepas"
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                  </div>
                  {m.status !== "create" && m.productId && (
                    <MappingPromos shopId={m.shopId} productId={m.productId} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <ConfirmModal
        open={confirmTarget !== null}
        onClose={() => setConfirmTarget(null)}
        onConfirm={doApply}
        title={confirmTarget === "all" ? "Jalankan semua baris di tabel?" : "Terapkan ke toko ini?"}
        confirmLabel="Ya, terapkan"
        loading={applying}
        description={(() => {
          if (confirmTarget === "all") {
            const upd = d.mappings.filter((m) => m.status !== "create").length;
            const cre = d.mappings.length - upd;
            return `Menjalankan tiap baris sesuai modenya: ${upd} toko "update" → nama & deskripsi listing yang tayang diperbarui (tindakan nyata di marketplace)${cre ? `; ${cre} toko "posting baru" distage (belum difire).` : "."}`;
          }
          const m = d.mappings.find((x) => x.id === confirmTarget);
          if (m && m.status === "create")
            return `Toko ${m.shopName ?? "ini"} bermode "posting baru" — akan distage; pembuatan listing baru belum difire (menunggu unggah gambar TikTok).`;
          return `Nama & deskripsi listing di ${m?.shopName ?? "toko ini"} akan diperbarui mengikuti master. Tindakan nyata pada listing yang sedang tayang.`;
        })()}
      />

      <ConfirmModal
        open={delMode !== null}
        onClose={() => setDelMode(null)}
        onConfirm={doDelete}
        loading={deleting}
        title={delMode === "autotoko" ? "Hapus master posting di AutoToko?" : "Hapus listing di marketplace?"}
        confirmLabel={delMode === "autotoko" ? "Ya, hapus di AutoToko" : "Ya, hapus di marketplace"}
        description={
          delMode === "autotoko"
            ? "Master posting beserta pemetaan & SKU-nya dihapus dari AutoToko saja. Listing produk di TikTok TETAP TAYANG (tidak disentuh)."
            : `Menghapus ${d.mappings.filter((m) => m.marketplace === "tiktok" && m.status !== "create").length} listing produk di TikTok — tindakan nyata di marketplace & tidak bisa dibatalkan. Master posting di AutoToko TETAP ADA; pemetaan yang listing-nya terhapus dibersihkan.`
        }
      />
    </Layout>
  );
}

interface CatAttr { id: string; name: string; required: boolean; customizable: boolean; multiple: boolean; values: { id: string; name: string }[]; current?: { id?: string; name: string }[]; currentText?: string }

/**
 * Editor atribut produk kategori marketplace (mis. Nomor Ijin Edar/BPOM 101066).
 * Memuat definisi atribut kategori dari TikTok (wajib/pilihan + nilai), diisi
 * dari atribut tersimpan, lalu disimpan ke master posting → ikut dikirim saat
 * Terapkan. Tanpa ini, edit listing kategori tertentu ditolak marketplace.
 */
function AtributKategori({ postingId, categoryId, shopId, attributes, onSaved }: {
  postingId: string; categoryId: number | null; shopId?: string; attributes: Record<string, unknown>; onSaved: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [defs, setDefs] = useState<CatAttr[] | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setDefs(null); setErr(null);
    const q = new URLSearchParams({ postingId });
    if (categoryId) q.set("categoryId", String(categoryId));
    if (shopId) q.set("shopId", shopId);
    api.get<{ categoryId: string; attributes: CatAttr[] }>(`/master-postings/category-attributes?${q.toString()}`)
      .then((r) => {
        setDefs(r.attributes);
        // Prefill: nilai tersimpan posting dulu, kalau kosong pakai `current`
        // (otomatis dari listing yg dipilih sbg master). User tinggal edit.
        const pa = ((attributes?.productAttributes as { id: string; values: { name: string }[] }[]) ?? []);
        const map: Record<string, string> = {};
        for (const a of pa) map[String(a.id)] = (a.values ?? []).map((v) => v.name).join(", ");
        for (const d of r.attributes) {
          if (!map[d.id] && d.currentText) map[d.id] = d.currentText;
        }
        setVals(map);
      })
      .catch((e) => { setDefs([]); setErr((e as Error).message); });
  }, [categoryId, shopId, postingId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!defs) return;
    setBusy(true);
    try {
      const productAttributes: { id: string; name: string; values: { id?: string; name: string }[] }[] = [];
      for (const d of defs) {
        const raw = (vals[d.id] ?? "").trim();
        if (!raw) continue;
        const tokens = d.multiple ? raw.split(",").map((x) => x.trim()).filter(Boolean) : [raw];
        const values = tokens.map((tok) => {
          const hit = d.values.find((v) => v.name.toLowerCase() === tok.toLowerCase());
          return hit ? { id: hit.id, name: hit.name } : { name: tok };
        });
        if (values.length) productAttributes.push({ id: d.id, name: d.name, values });
      }
      await api.patch(`/master-postings/${postingId}`, { attributes: { ...(attributes || {}), productAttributes } });
      toast("Atribut produk disimpan — akan ikut saat Terapkan.", "success");
      await onSaved();
    } catch (e) { toast((e as Error).message, "danger"); } finally { setBusy(false); }
  }

  const sorted = (defs ?? []).slice().sort((a, b) => Number(b.required) - Number(a.required));

  return (
    <Card className="mt-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-medium text-ink">Atribut Produk (Marketplace)</div>
          <div className="text-xs text-ink-2">Field kategori dari marketplace. Yang bertanda <b>wajib</b> harus diisi agar Terapkan tidak ditolak (mis. Nomor Ijin Edar / BPOM).</div>
        </div>
        <Button size="sm" variant="outline" loading={busy} onClick={save} disabled={!defs || defs.length === 0}>Simpan Atribut</Button>
      </div>
      {defs === null ? (
        <div className="text-xs text-ink-3 mt-2">Memuat atribut kategori…</div>
      ) : err ? (
        <InlineAlert tone="warning">{err}</InlineAlert>
      ) : defs.length === 0 ? (
        <div className="text-xs text-ink-3 mt-2">Kategori ini tak punya atribut produk khusus.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 mt-2">
          {sorted.map((d) => (
            <div key={d.id}>
              <label className="block text-[11px] mb-1">
                <span className="text-ink-2">{d.name}</span>
                {d.required && <span className="ml-1 text-red-600 font-medium">wajib</span>}
                {d.multiple && <span className="ml-1 text-ink-3">(boleh &gt;1, pisah koma)</span>}
              </label>
              <input
                list={d.values.length ? `attr-${d.id}` : undefined}
                value={vals[d.id] ?? ""}
                onChange={(e) => setVals((m) => ({ ...m, [d.id]: e.target.value }))}
                placeholder={d.values.length ? "pilih / ketik" : "ketik nilai"}
                className={`w-full rounded-lg border px-3 py-2 text-sm bg-white text-ink focus:outline-none focus:ring-2 focus:ring-brand/40 ${d.required && !(vals[d.id] ?? "").trim() ? "border-red-300" : "border-line"}`}
              />
              {d.values.length > 0 && (
                <datalist id={`attr-${d.id}`}>
                  {d.values.map((v) => <option key={v.id} value={v.name} />)}
                </datalist>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
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

/** Combobox dengan kotak pencarian untuk daftar panjang (search di tiap combolist). */
function SearchSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);
  const needle = q.trim().toLowerCase();
  const filtered = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setQ("");
          setOpen((o) => !o);
        }}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-white px-3 py-2 text-left text-sm text-ink disabled:bg-canvas disabled:text-ink-3"
      >
        <span className={`truncate ${selected ? "" : "text-ink-3"}`}>{selected ? selected.label : placeholder ?? "Pilih…"}</span>
        <Icon name="chevronDown" size={14} className="shrink-0 text-ink-3" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[220px] rounded-lg border border-line bg-white shadow-lg">
          <div className="border-b border-line p-1.5">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari…"
              className="w-full rounded-md border border-line px-2 py-1 text-sm outline-none focus:border-brand"
            />
          </div>
          <div className="max-h-60 overflow-auto py-1">
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-ink-3 hover:bg-canvas"
            >
              {placeholder ?? "— kosongkan —"}
            </button>
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-ink-3">Tak ada yang cocok</div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-canvas ${
                    o.value === value ? "bg-canvas font-medium text-ink" : "text-ink-2"
                  }`}
                >
                  {o.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SkuRowEditor({
  postingId,
  row,
  masters,
  onSaved,
  onMasterPriceSaved,
}: {
  postingId: string;
  row: SkuRow;
  masters: MasterOpt[];
  onSaved: () => Promise<void>;
  onMasterPriceSaved: () => Promise<void>;
}) {
  const [sku, setSku] = useState(row.sku ?? "");
  const [masterId, setMasterId] = useState(row.masterProductId ?? "");
  const [price, setPrice] = useState(row.price ?? "");
  const [stock, setStock] = useState(row.stock == null ? "" : String(row.stock));
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const master = masters.find((m) => m.id === masterId) ?? null;
  const fmtRp = (n: number | null | undefined) =>
    n == null ? "—" : "Rp " + Math.round(n).toLocaleString("id-ID");
  // Simulasi margin/profit bersih LIVE dari "Harga produk" yg sedang diketik,
  // pakai HPP + rate costing master (rumus sama dgn menu HPP via @autotoko/shared).
  const priceNum = Number(price) || 0;
  const sim =
    master && priceNum > 0
      ? calculatePublishPricing({
          publishPriceCents: Math.round(priceNum * 100),
          hppCents: master.hppCents,
          marketplaceFeeRate: master.marketplaceFeeRate,
          eventRate: master.eventRate,
          affiliatorRate: master.affiliatorRate,
          adsRate: master.adsRate,
          adsFixedCents: master.adsFixedCents,
          sedekahRate: master.sedekahRate,
          resellerRate: master.resellerRate,
        })
      : null;

  // Saat master dipetakan: auto-isi "Harga produk" dari harga publish master
  // bila harga masih kosong (biar tak menimpa harga yang sudah diisi manual).
  useEffect(() => {
    if (master && master.publishPrice != null && price.trim() === "") {
      setPrice(String(master.publishPrice));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masterId]);

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
      // Dua-arah: jika dipetakan ke master & harga berubah dari harga publish
      // master, perbarui juga harga publish master produk AutoToko.
      if (masterId && priceNum > 0 && priceNum !== (master?.publishPrice ?? null)) {
        try {
          await api.patch(`/master-postings/master-products/${masterId}/publish-price`, { price: priceNum });
          await onMasterPriceSaved();
        } catch (e) {
          toast((e as Error).message || "Harga SKU tersimpan, tapi gagal sinkron ke master", "danger");
        }
      }
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
        <SearchSelect
          className="max-w-[240px]"
          value={masterId}
          onChange={setMasterId}
          placeholder="— belum dipetakan —"
          options={masters.map((m) => ({ value: m.id, label: `${m.name} (${m.sku})` }))}
        />
      </TD>
      <TD align="right">
        <span className="text-xs tabular-nums text-ink-2">{masterId ? fmtRp(master?.hpp) : "—"}</span>
      </TD>
      <TD align="right">
        <Input className="max-w-[120px] text-right" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" />
      </TD>
      <TD align="right">
        {masterId && sim ? (
          <div className="leading-tight">
            <div
              className={`text-xs font-semibold tabular-nums ${sim.netProfitCents >= 0 ? "text-emerald-600" : "text-red-600"}`}
            >
              {rupiah(sim.netProfitCents / 100)}
            </div>
            <div className={`text-[11px] tabular-nums ${sim.netProfitCents >= 0 ? "text-emerald-600/80" : "text-red-600/80"}`}>
              {(sim.netMarginRate * 100).toFixed(1)}% margin
            </div>
          </div>
        ) : (
          <span className="text-xs text-ink-3">—</span>
        )}
      </TD>
      <TD align="right">
        <span className="text-xs tabular-nums text-ink-3">
          {row.marketplacePrice ? "Rp " + Math.round(Number(row.marketplacePrice)).toLocaleString("id-ID") : "—"}
        </span>
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

interface Promo {
  activityId: string;
  title: string;
  type: string | null;
  status: string | null;
  beginTime: number | null;
  endTime: number | null;
  discount: string | null;
}

function MappingPromos({ shopId, productId }: { shopId: string; productId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [promos, setPromos] = useState<Promo[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    setOpen((o) => !o);
    if (loaded || loading) return;
    setLoading(true);
    try {
      const d = await api.get<{ promotions: Promo[]; error?: string }>(
        `/master-postings/promotions?shopId=${shopId}&productId=${productId}`,
      );
      setPromos(d.promotions || []);
      if (d.error) setErr(d.error);
      setLoaded(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const fmt = (s: number | null) =>
    s ? new Date(s * 1000).toLocaleDateString("id-ID", { day: "2-digit", month: "short" }) : "";

  return (
    <div className="mt-1.5 border-t border-line pt-1.5">
      <button onClick={toggle} className="inline-flex items-center gap-1 text-xs text-brand-ink hover:underline">
        <Icon name="tag" size={13} /> Promosi terkait{loaded ? ` (${promos.length})` : ""}
        <Icon name="chevronDown" size={12} className={open ? "rotate-180" : ""} />
      </button>
      {open && (
        <div className="mt-1.5">
          {loading && <div className="text-xs text-ink-3">Memuat promosi dari TikTok…</div>}
          {err && <div className="text-xs text-red-600">{err}</div>}
          {loaded && !err && promos.length === 0 && (
            <div className="text-xs text-ink-3">Tidak ada promosi yang mengikutkan produk ini.</div>
          )}
          <div className="space-y-1">
            {promos.map((p) => (
              <div key={p.activityId} className="flex flex-wrap items-center gap-1.5 text-xs">
                <Badge tone="info">{p.type ?? "promo"}</Badge>
                <span className="text-ink">{p.title}</span>
                {p.status && <span className="text-ink-3">· {p.status}</span>}
                {(p.beginTime || p.endTime) && (
                  <span className="text-ink-3">
                    · {fmt(p.beginTime)}–{fmt(p.endTime)}
                  </span>
                )}
                {p.discount && <span className="text-ink-2">· diskon {p.discount}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MappingAdder({ postingId, shops, onAdded }: { postingId: string; shops: ShopOpt[]; onAdded: () => Promise<void> }) {
  const [shopId, setShopId] = useState("");
  const [mode, setMode] = useState<"update" | "create">("update");
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [productId, setProductId] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const filtered = search.trim()
    ? products.filter((p) => (p.title ?? "").toLowerCase().includes(search.trim().toLowerCase()))
    : products;

  useEffect(() => {
    if (!shopId || mode === "create") {
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
  }, [shopId, mode, toast]);

  async function add() {
    if (!shopId) return;
    if (mode === "update" && !productId) return;
    setBusy(true);
    try {
      await api.post(
        `/master-postings/${postingId}/mappings`,
        mode === "create" ? { shopId, mode } : { shopId, productId, mode },
      );
      setProductId("");
      await onAdded();
      toast(mode === "create" ? "Toko ditandai: posting baru" : "Listing dipetakan (mode update)", "success");
    } catch (e) {
      toast((e as Error).message || "Gagal memetakan", "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Toko" className="min-w-[160px]">
        <SearchSelect
          value={shopId}
          onChange={setShopId}
          placeholder="Pilih toko…"
          options={shops.map((s) => ({ value: s.id, label: `${s.shopName ?? s.id.slice(0, 8)} (${s.marketplace})` }))}
        />
      </Field>
      <Field label="Mode" className="min-w-[170px]">
        <Select value={mode} onChange={(e) => setMode(e.target.value as "update" | "create")}>
          <option value="update">Update listing yang ada</option>
          <option value="create">Jadikan posting baru</option>
        </Select>
      </Field>
      {mode === "update" && (
        <Field label="Listing marketplace" className="min-w-[260px] flex-1">
          <div className="space-y-1.5">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama listing…"
              disabled={!shopId || loading}
            />
            <Select value={productId} onChange={(e) => setProductId(e.target.value)} disabled={!shopId || loading}>
              <option value="">
                {loading
                  ? "Memuat…"
                  : filtered.length === 0
                    ? search.trim()
                      ? "Tak ada yang cocok"
                      : "Tak ada listing aktif yang belum dipetakan"
                    : `Pilih listing… (${filtered.length})`}
              </option>
              {filtered.map((p) => (
                <option key={p.productId} value={p.productId}>
                  {(p.title ?? "(tanpa judul)").slice(0, 58)} · 30hr: {p.sold30d ?? 0}x · {p.productId}
                </option>
              ))}
            </Select>
            <div className="text-[11px] text-ink-3">
              Hanya listing berstatus aktif &amp; belum menempel ke master lain yang muncul.
            </div>
          </div>
        </Field>
      )}
      <Button variant="outline" icon="link" loading={busy} disabled={!shopId || (mode === "update" && !productId)} onClick={add}>
        Petakan
      </Button>
    </div>
  );
}
