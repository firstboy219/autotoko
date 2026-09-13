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
interface MpVarian { skuId: string; nama: string; harga: number | null; stok: number | null; }
interface MpPosting {
  productId: string | null;
  title: string | null;
  shopName: string | null;
  marketplace: string;
  catalogName: string | null;
  varian: MpVarian[];
}
interface MasterDetail extends Master {
  shops: ShopGroup[];
  marketplacePostings?: MpPosting[];
}
interface Shop { id: string; shopName: string | null; marketplace: string; }

interface Varian {
  skuId: string;
  nama: string;
  sellerSku: string | null;
  harga: number | null;
  currency: string;
  stok: number | null;
  masterId: string | null;
  masterName: string | null;
  via: "map" | "sku" | null;
}
interface Postingan {
  productId: string;
  title: string | null;
  status: string | null;
  marketplace: string;
  shopName: string | null;
  varian: Varian[];
}
interface Katalog {
  id: string;
  name: string;
  note: string | null;
  postingan: Postingan[];
}
interface CatalogTree {
  ringkas: {
    katalog: number;
    postingan: number;
    varian: number;
    varianTerpetakan: number;
    postinganTanpaKatalog: number;
  };
  katalog: Katalog[];
  tanpaKatalog: Postingan[];
  masters: { id: string; name: string; sku: string | null }[];
}

/** Rentang harga API sebuah postingan: "Rp 39.300" atau "Rp 39.300 – 49.300". */
function hargaPostingan(vs: Varian[]): string {
  const h = vs.map((v) => v.harga).filter((n): n is number => n != null && n > 0);
  if (!h.length) return "—";
  const min = Math.min(...h);
  const max = Math.max(...h);
  return min === max ? rupiah(min) : `${rupiah(min)} – ${rupiah(max)}`;
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
        active ? "border-brand text-ink" : "border-transparent text-ink-3 hover:text-ink-2"
      }`}
    >
      {children}
    </button>
  );
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
  const [tab, setTab] = useState<"produk" | "katalog">("produk");

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

      <div className="flex gap-1 border-b border-line mb-4">
        <TabBtn active={tab === "produk"} onClick={() => setTab("produk")}>Produk</TabBtn>
        <TabBtn active={tab === "katalog"} onClick={() => setTab("katalog")}>Katalog Marketplace</TabBtn>
      </div>

      {tab === "produk" && (
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
                <TH align="right">Postingan<div className="text-[10px] font-normal text-ink-3">marketplace</div></TH>
                <TH align="right">Stok<div className="text-[10px] font-normal text-ink-3">marketplace</div></TH>
                <TH align="right">Harga Master</TH>
                <TH align="right">Terjual</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <tbody>
              {loading ? (
                <SkeletonRows n={6} cols={6} />
              ) : !filtered.length ? (
                <tr>
                  <td colSpan={6}>
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
      )}

      {tab === "katalog" && <MarketplaceCatalog />}

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
  const { data, loading, reload } = useFetch<CatalogTree>("/products/catalog-tree");
  const [q, setQ] = useState("");
  const [onlyUnmapped, setOnlyUnmapped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  async function aksi(fn: () => Promise<unknown>, sukses: string) {
    setBusy(true);
    try {
      await fn();
      if (sukses) toast(sukses, "success");
      reload();
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Card className="mt-4"><Skeleton className="h-40 w-full" /></Card>;
  if (!data || data.ringkas.postingan === 0) return null;
  const r = data.ringkas;

  function ringkas(posts: Postingan[]) {
    const shops = Array.from(new Set(posts.map((p) => p.shopName).filter((x): x is string => !!x)));
    const vs = posts.flatMap((p) => p.varian);
    const mapped = vs.filter((v) => v.masterId).length;
    const prices = vs.map((v) => v.harga).filter((n): n is number => n != null && n > 0);
    return {
      shops, total: vs.length, mapped,
      min: prices.length ? Math.min(...prices) : null,
      max: prices.length ? Math.max(...prices) : null,
    };
  }
  const hargaTeks = (min: number | null, max: number | null) =>
    min == null ? "—" : min === max ? rupiah(min) : `${rupiah(min)} – ${rupiah(max)}`;
  const punyaUnmapped = (posts: Postingan[]) => posts.some((p) => p.varian.some((v) => !v.masterId));

  const masterSelect = (v: Varian) => (
    <Select
      value={v.masterId ?? ""}
      disabled={busy}
      onChange={(e) =>
        aksi(
          () => api.post("/products/variants/link", { skuId: v.skuId, masterId: e.target.value || null }),
          e.target.value ? "Varian ditautkan ke master" : "Tautan dilepas",
        )
      }
      className="min-w-[170px]"
    >
      <option value="">— belum dipetakan —</option>
      {(data.masters ?? []).map((m) => (
        <option key={m.id} value={m.id}>{m.name}{m.sku ? ` (${m.sku})` : ""}</option>
      ))}
    </Select>
  );

  const needle = q.trim().toLowerCase();
  const cats = data.katalog
    .filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.postingan.some((p) => (p.title ?? "").toLowerCase().includes(needle)))
    .filter((c) => !onlyUnmapped || punyaUnmapped(c.postingan));
  const orphans = (data.tanpaKatalog ?? [])
    .filter((p) => !needle || (p.title ?? "").toLowerCase().includes(needle))
    .filter((p) => !onlyUnmapped || punyaUnmapped([p]));

  // Satu kartu untuk katalog maupun postingan lepas (kunci "orphan:<id>").
  const kartu = (key: string, name: string, posts: Postingan[]) => {
    const g = ringkas(posts);
    const pct = g.total ? Math.round((g.mapped / g.total) * 100) : 0;
    const status =
      g.mapped >= g.total && g.total > 0 ? <Badge tone="success">✓ lengkap</Badge>
      : g.mapped > 0 ? <Badge tone="warning">{g.mapped}/{g.total} dipetakan</Badge>
      : <Badge tone="neutral">belum dipetakan</Badge>;
    return (
      <button
        key={key}
        type="button"
        onClick={() => setOpenId(key)}
        className="text-left bg-white border border-line rounded-xl p-4 flex flex-col gap-3 hover:border-brand transition"
      >
        <div className="font-medium text-ink leading-snug line-clamp-2" title={name}>{name}</div>
        <div className="flex flex-wrap gap-1.5">
          {g.shops.map((sh) => (
            <span key={sh} className="text-[11px] text-ink-2 bg-canvas border border-line rounded-full px-2 py-0.5">{sh}</span>
          ))}
        </div>
        <div className="flex gap-4 text-xs text-ink-2">
          <span><b className="text-ink">{posts.length}</b> postingan</span>
          <span><b className="text-ink">{g.total}</b> varian</span>
        </div>
        <div className="text-sm font-medium text-ink tabular-nums">{hargaTeks(g.min, g.max)}</div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-line overflow-hidden">
            <div className="h-full bg-brand rounded-full" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[11px] text-ink-2 tabular-nums whitespace-nowrap">{g.mapped}/{g.total}</span>
        </div>
        <div className="flex items-center justify-between border-t border-line pt-2.5 mt-auto">
          {status}
          <span className="text-sm text-brand-ink">Kelola →</span>
        </div>
      </button>
    );
  };

  const openCat = openId && !openId.startsWith("orphan:") ? data.katalog.find((c) => c.id === openId) : null;
  const openOrphan = openId && openId.startsWith("orphan:")
    ? (data.tanpaKatalog ?? []).find((p) => `orphan:${p.productId}` === openId) ?? null
    : null;
  const detailPosts: Postingan[] = openCat ? openCat.postingan : openOrphan ? [openOrphan] : [];
  const detailG = ringkas(detailPosts);

  return (
    <>
      <Card padded={false} className="mt-4 overflow-hidden">
        <CardHeader
          title="Katalog Marketplace"
          subtitle={`${r.katalog} katalog · ${r.postingan} postingan · ${r.varian} varian`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="tonal" icon="refresh" loading={busy}
                onClick={() => aksi(() => api.post("/products/catalogs/regroup", {}), "Postingan dikelompokkan ulang")}>
                Kelompokkan otomatis
              </Button>
              <Button size="sm" variant="outline" icon="plus" disabled={busy}
                onClick={() => {
                  const name = window.prompt("Nama katalog baru:");
                  if (name && name.trim()) aksi(() => api.post("/products/catalogs", { name: name.trim() }), "Katalog dibuat");
                }}>
                Katalog baru
              </Button>
            </div>
          }
        />

        <div className="px-4 pt-3">
          <div className="flex items-center justify-between text-xs text-ink-2 mb-1">
            <span>Pemetaan varian ke master</span>
            <span className="tabular-nums">{r.varianTerpetakan} / {r.varian}</span>
          </div>
          <div className="h-1.5 rounded-full bg-line overflow-hidden">
            <div className="h-full bg-brand" style={{ width: `${r.varian ? Math.round((r.varianTerpetakan / r.varian) * 100) : 0}%` }} />
          </div>
        </div>

        <div className="px-4 py-3 flex flex-wrap items-center gap-3">
          <div className="relative sm:w-72">
            <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
            <Input className="pl-9" placeholder="Cari katalog / postingan…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-ink-2 cursor-pointer">
            <input type="checkbox" checked={onlyUnmapped} onChange={(e) => setOnlyUnmapped(e.target.checked)} />
            Hanya yang belum dipetakan
          </label>
        </div>

        <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {cats.map((c) => kartu(c.id, c.name, c.postingan))}
        </div>
        {cats.length === 0 && <p className="px-4 pb-4 text-sm text-ink-3">Tidak ada katalog yang cocok.</p>}

        {orphans.length > 0 && (
          <>
            <div className="px-4 pt-1 pb-1 text-xs font-semibold uppercase tracking-wide text-amber-700">
              Belum berkatalog ({orphans.length})
            </div>
            <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {orphans.map((p) => kartu(`orphan:${p.productId}`, p.title ?? "(tanpa judul)", [p]))}
            </div>
          </>
        )}

        <p className="px-4 py-3 text-[11px] text-ink-3 border-t border-line">
          Katalog mengelompokkan postingan produk yang sama lintas toko (dari kemiripan judul; bisa diubah manual).
          Klik sebuah kartu untuk memetakan varian di dalamnya ke master produk — pemetaan ini juga mengisi nama
          produk di menu Audit Pesanan.
        </p>
      </Card>

      {(openCat || openOrphan) && (
        <Modal open onClose={() => setOpenId(null)} title="Kelola Katalog" width="max-w-2xl">
          <div className="max-h-[72vh] overflow-y-auto -mx-1 px-1">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <div className="text-lg font-medium text-ink truncate">{openCat ? openCat.name : openOrphan?.title ?? "(tanpa judul)"}</div>
                <div className="text-xs text-ink-3 mt-0.5">
                  {detailPosts.length} postingan · {detailG.mapped}/{detailG.total} varian dipetakan
                  {!openCat && " · belum berkatalog"}
                </div>
              </div>
              {openCat && (
                <div className="flex gap-1.5 shrink-0">
                  <Button size="sm" variant="outline" icon="pencil"
                    onClick={() => {
                      const name = window.prompt("Ubah nama katalog:", openCat.name);
                      if (name && name.trim() && name.trim() !== openCat.name)
                        aksi(() => api.patch(`/products/catalogs/${openCat.id}`, { name: name.trim() }), "Nama katalog diubah");
                    }}>
                    Ubah nama
                  </Button>
                  <Button size="sm" variant="danger" icon="trash"
                    onClick={() => {
                      if (window.confirm(`Hapus katalog "${openCat.name}"? Postingan di dalamnya tidak terhapus, hanya lepas dari katalog.`)) {
                        aksi(() => api.del(`/products/catalogs/${openCat.id}`), "Katalog dihapus");
                        setOpenId(null);
                      }
                    }}>
                    Hapus
                  </Button>
                </div>
              )}
            </div>

            {detailPosts.map((p) => (
              <div key={p.productId} className="border border-line rounded-lg mb-3 overflow-hidden">
                <div className="flex items-center gap-2 px-3.5 py-2 bg-canvas border-b border-line">
                  <span className="text-xs font-medium text-ink">{p.shopName ?? "-"}</span>
                  <span className="text-xs text-ink-2 flex-1 truncate">{p.title ?? "-"}</span>
                </div>
                <div className="flex items-center gap-2 px-3.5 py-2 text-xs border-b border-line">
                  <span className="text-ink-3 whitespace-nowrap">Masuk katalog:</span>
                  <Select
                    value={openCat?.id ?? ""}
                    disabled={busy}
                    onChange={(e) =>
                      aksi(() => api.patch(`/products/postings/${p.productId}/catalog`, { catalogId: e.target.value || null }), "Postingan dipindah")
                    }
                    className="min-w-[180px]"
                  >
                    <option value="">— tanpa katalog —</option>
                    {data.katalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </div>
                {p.varian.map((v) => (
                  <div key={v.skuId} className="flex items-center gap-3 px-3.5 py-2 border-t border-line">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-ink truncate">{v.nama}</div>
                      <div className="text-[11px] text-ink-2 tabular-nums">
                        {v.harga != null ? rupiah(v.harga) : "—"} · stok {v.stok ?? 0}
                      </div>
                    </div>
                    {masterSelect(v)}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

function ProductDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data, loading, reload } = useFetch<MasterDetail>(`/products/${id}`);
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // edit form state
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [status, setStatus] = useState("active");
  const [aliases, setAliases] = useState("");
  const [catIds, setCatIds] = useState<string[]>([]);
  const kategori = useFetch<ShopCategory[]>("/shops/categories");

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

              <div className="text-sm font-medium text-ink mb-2.5">Terjual di Marketplace</div>
              {!data.marketplacePostings?.length ? (
                <EmptyState
                  icon="store"
                  title="Belum ada varian marketplace yang dipetakan"
                  description="Petakan varian ke produk ini lewat tab Katalog Marketplace."
                  className="py-8"
                />
              ) : (
                data.marketplacePostings.map((p, i) => {
                  const badge = MP_BADGE[p.marketplace] ?? { label: p.marketplace, tone: "neutral" as Tone };
                  return (
                    <div key={p.productId ?? String(i)} className="mb-4">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs font-medium text-ink-2">{p.shopName ?? "-"}</span>
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                        {p.catalogName && <span className="text-[10px] text-ink-3">· {p.catalogName}</span>}
                      </div>
                      {p.title && <div className="text-xs text-ink-2 truncate mb-1">{p.title}</div>}
                      <div className="border border-line rounded-lg divide-y divide-line">
                        {p.varian.map((v) => (
                          <div key={v.skuId} className="flex items-center justify-between gap-3 px-3.5 py-2 text-sm">
                            <span className="text-ink truncate">{v.nama}</span>
                            <span className="text-ink-2 tabular-nums whitespace-nowrap">
                              {v.harga != null ? rupiah(v.harga) : "—"} · stok {v.stok ?? 0}
                            </span>
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
