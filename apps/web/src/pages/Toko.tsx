import { useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";
import { dateShort } from "../lib/fmt";
import { Icon } from "../components/Icon";
import {
  CategoryChip,
  ManageCategoriesModal,
  type ShopCategory,
} from "../components/ShopCategories";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmModal,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  useToast,
} from "../components/ui";

type Marketplace = "tiktok" | "shopee";

interface Shop {
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  id: string;
  marketplace: string;
  shopId: string;
  shopName: string | null;
  /** Seller's own label; wins over shopName when set. */
  displayName: string | null;
  sellerRegion: string | null;
  shopStatus: string;
  accessTokenExpireAt: string | null;
  connectedAt: string | null;
}

const DAY = 86400_000;
const MP_LABEL: Record<string, string> = { tiktok: "TikTok Shop", shopee: "Shopee" };

/** Days until expiry; null if unknown. */
function daysToExpiry(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((new Date(iso).getTime() - Date.now()) / DAY);
}

const shopLabel = (s: Shop) => s.displayName ?? s.shopName ?? s.shopId;

export function Toko() {
  const toast = useToast();
  const { data, loading, reload } = useFetch<Shop[]>("/shops");
  const categories = useFetch<ShopCategory[]>("/shops/categories");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [managingCategories, setManagingCategories] = useState(false);

  function reloadAll() {
    reload();
    categories.reload();
  }

  // Grouped for display, but only when nothing is filtered: once the owner has
  // narrowed to one category, headings for it would be noise.
  const visibleShops = (data ?? []).filter((s) =>
    !categoryFilter
      ? true
      : categoryFilter === "none"
        ? !s.categoryId
        : s.categoryId === categoryFilter,
  );

  const grouped = (() => {
    const buckets = new Map<string, { name: string; color: string | null; shops: Shop[] }>();
    for (const s of visibleShops) {
      const key = s.categoryId ?? "__none__";
      if (!buckets.has(key)) {
        buckets.set(key, {
          name: s.categoryName ?? "Tanpa Kategori",
          color: s.categoryColor ?? null,
          shops: [],
        });
      }
      buckets.get(key)!.shops.push(s);
    }
    // Ungrouped last: it is a leftover pile, not a group anyone chose.
    return [...buckets.entries()].sort((a, b) => {
      if (a[0] === "__none__") return 1;
      if (b[0] === "__none__") return -1;
      return a[1].name.localeCompare(b[1].name);
    });
  })();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [editing, setEditing] = useState<Shop | null>(null);
  const [removing, setRemoving] = useState<Shop | null>(null);

  async function connect(mp: Marketplace, placeholderId?: string) {
    setBusy(placeholderId ?? mp);
    setErr(null);
    try {
      const path = `/shops/connect/${mp}${placeholderId ? `?placeholderId=${placeholderId}` : ""}`;
      const { authUrl } = await api.get<{ authUrl: string }>(path);
      window.location.href = authUrl;
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  }

  async function refresh(id: string) {
    setBusy(id);
    setErr(null);
    try {
      await api.post(`/shops/${id}/refresh`);
      toast("Token diperbarui", "success");
      reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function doRemove() {
    if (!removing) return;
    setBusy(removing.id);
    setErr(null);
    try {
      await api.del(`/shops/${removing.id}`);
      toast(removing.connectedAt ? "Koneksi toko diputus" : "Toko dihapus", "success");
      reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
      setRemoving(null);
    }
  }

  return (
    <Layout title="Toko Saya">
      <PageHeader
        title="Toko Saya"
        subtitle="Hubungkan toko marketplace, atau siapkan toko manual dulu sebelum dihubungkan."
        actions={
          <>
            <Button
              variant="outline"
              icon="plus"
              disabled={busy !== null}
              onClick={() => connect("shopee")}
            >
              Shopee
            </Button>
            <Button
              variant="outline"
              icon="plus"
              disabled={busy !== null}
              onClick={() => connect("tiktok")}
            >
              TikTok
            </Button>
            <Button
              variant="filled"
              icon="store"
              disabled={busy !== null}
              onClick={() => setShowManual((v) => !v)}
            >
              Tambah Toko Manual
            </Button>
          </>
        }
      />

      <p className="text-xs text-ink-3 mb-4">
        Dengan menghubungkan toko, kamu menyetujui{" "}
        <Link to="/terms" className="underline">
          Ketentuan Layanan
        </Link>{" "}
        &{" "}
        <Link to="/privacy" className="underline">
          Kebijakan Privasi
        </Link>
        .
      </p>

      {showManual && (
        <div className="mb-4">
          <ManualShopForm
            onDone={() => {
              setShowManual(false);
              reload();
            }}
            onCancel={() => setShowManual(false)}
          />
        </div>
      )}

      {err && (
        <div className="mb-4">
          <InlineAlert tone="danger">{err}</InlineAlert>
        </div>
      )}

      {!loading && !!data?.length && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-52"
          >
            <option value="">Semua kategori</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.shopCount})
              </option>
            ))}
            <option value="none">Tanpa kategori</option>
          </Select>
          <Button variant="outline" onClick={() => setManagingCategories(true)}>
            <Icon name="tag" className="w-3.5 h-3.5" />
            Kelola Kategori
          </Button>
          {categoryFilter && (
            <span className="text-xs text-ink-2">
              {visibleShops.length} dari {data.length} toko
            </span>
          )}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Skeleton className="h-36 rounded-lg" />
          <Skeleton className="h-36 rounded-lg" />
        </div>
      ) : !data?.length ? (
        <Card padded={false}>
          <EmptyState
            icon="store"
            title="Belum ada toko"
            description="Hubungkan toko marketplace lewat OAuth, atau tambahkan toko manual dulu untuk disiapkan mapping-nya."
            action={
              <Button variant="filled" icon="store" onClick={() => setShowManual(true)}>
                Tambah Toko Manual
              </Button>
            }
          />
        </Card>
      ) : (
        grouped.map(([key, group]) => (
        <div key={key} className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <CategoryChip name={group.name} color={group.color} />
            <span className="text-xs text-ink-2">{group.shops.length} toko</span>
          </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {group.shops.map((s) => {
            const isPlaceholder = !s.connectedAt;
            const dte = daysToExpiry(s.accessTokenExpireAt);
            const expiring = dte !== null && dte < 7;
            return (
              <div
                key={s.id}
                className={`bg-white rounded-lg border p-4 ${
                  isPlaceholder ? "border-mn-amber border-dashed" : "border-line"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink truncate">{shopLabel(s)}</div>
                    <div className="text-xs text-ink-3 mt-0.5">
                      {MP_LABEL[s.marketplace] ?? s.marketplace}
                      {s.sellerRegion ? ` · ${s.sellerRegion}` : ""}
                    </div>
                    {/* Show the marketplace's own name when the seller has
                        renamed it, so the two can still be reconciled. */}
                    {s.displayName && s.shopName && s.displayName !== s.shopName && (
                      <div className="text-xs text-ink-3 mt-0.5 truncate">
                        nama marketplace: {s.shopName}
                      </div>
                    )}
                  </div>
                  {isPlaceholder ? (
                    <Badge tone="warning">Belum Terhubung</Badge>
                  ) : (
                    <Badge tone={s.shopStatus === "active" ? "success" : "warning"}>
                      {s.shopStatus === "active" ? "Terhubung" : s.shopStatus}
                    </Badge>
                  )}
                </div>

                {isPlaceholder ? (
                  <div className="text-xs text-ink-2 mt-3">
                    Dibuat manual — hubungkan ke akun {MP_LABEL[s.marketplace] ?? s.marketplace}{" "}
                    yang asli kapan saja.
                  </div>
                ) : (
                  <div className="mt-3 space-y-1">
                    <div className="text-xs text-ink-2">
                      Terhubung: {dateShort(s.connectedAt)}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-ink-2">
                      <span>Token expire: {dateShort(s.accessTokenExpireAt)}</span>
                      {dte !== null && (
                        <Badge tone={expiring ? "danger" : "neutral"}>
                          {dte < 0 ? "kedaluwarsa" : `${dte} hari`}
                        </Badge>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 mt-4">
                  {isPlaceholder ? (
                    <Button
                      size="sm"
                      variant="filled"
                      icon="link"
                      disabled={busy !== null}
                      loading={busy === s.id}
                      onClick={() => connect(s.marketplace as Marketplace, s.id)}
                    >
                      Hubungkan Sekarang
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      icon="refresh"
                      disabled={busy !== null}
                      loading={busy === s.id}
                      onClick={() => refresh(s.id)}
                    >
                      Refresh Token
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    icon="pencil"
                    disabled={busy !== null}
                    onClick={() => setEditing(s)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    icon="trash"
                    disabled={busy !== null}
                    onClick={() => setRemoving(s)}
                  >
                    {isPlaceholder ? "Hapus" : "Putus Koneksi"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        </div>
        ))
      )}

      {editing && (
        <EditShopModal
          shop={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}

      <ConfirmModal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={doRemove}
        loading={busy !== null && busy === removing?.id}
        title={removing?.connectedAt ? "Putuskan koneksi toko?" : "Hapus toko manual?"}
        confirmLabel={removing?.connectedAt ? "Putus Koneksi" : "Hapus"}
        description={
          removing
            ? removing.connectedAt
              ? `Koneksi "${shopLabel(removing)}" akan diputus. Order lama tetap tersimpan.`
              : `Toko manual "${shopLabel(removing)}" akan dihapus.`
            : ""
        }
      />
    </Layout>
  );
}

/* --------------------------------------------------------------- edit */

function EditShopModal({
  shop,
  onClose,
  onSaved,
}: {
  shop: Shop;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const isPlaceholder = !shop.connectedAt;
  const [name, setName] = useState(shop.displayName ?? shop.shopName ?? "");
  const [categoryId, setCategoryId] = useState<string>(shop.categoryId ?? "");
  // Fetched here rather than passed in, so a category created moments ago in
  // the manage dialog is already in this list.
  const cats = useFetch<ShopCategory[]>("/shops/categories");
  const [marketplace, setMarketplace] = useState<Marketplace>(shop.marketplace as Marketplace);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      // Category has its own endpoint: the shop PATCH is about marketplace
      // identity, and folding a grouping label into it would let one
      // validation failure reject both.
      if ((shop.categoryId ?? "") !== categoryId) {
        await api.patch(`/shops/${shop.id}/category`, { categoryId: categoryId || null });
      }
      await api.patch(`/shops/${shop.id}`, {
        displayName: name.trim(),
        ...(isPlaceholder ? { marketplace } : {}),
      });
      toast("Toko diperbarui", "success");
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit Toko"
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button variant="filled" icon="check" loading={busy} onClick={save}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field
          label="Nama Tampilan"
          hint={
            shop.shopName
              ? `Kosongkan untuk memakai nama dari marketplace ("${shop.shopName}").`
              : "Nama yang tampil di seluruh aplikasi."
          }
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>

        <Field label="Kategori" hint="Untuk mengelompokkan toko di halaman ini.">
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Tanpa kategori</option>
            {(cats.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Marketplace"
          hint={
            isPlaceholder
              ? "Masih bisa diubah karena toko ini belum terhubung."
              : "Terkunci — sudah terikat dengan koneksi OAuth toko ini."
          }
        >
          <Select
            value={marketplace}
            disabled={!isPlaceholder}
            onChange={(e) => setMarketplace(e.target.value as Marketplace)}
          >
            <option value="tiktok">TikTok Shop</option>
            <option value="shopee">Shopee</option>
          </Select>
        </Field>

        <div className="rounded-lg bg-canvas border border-line px-3.5 py-2.5">
          <div className="text-xs text-ink-3">ID Toko di Marketplace</div>
          <div className="text-xs font-mono text-ink mt-0.5 break-all">{shop.shopId}</div>
        </div>

        {err && <InlineAlert tone="danger">{err}</InlineAlert>}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------- manual create */

function ManualShopForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [marketplace, setMarketplace] = useState<Marketplace>("tiktok");
  const [shopName, setShopName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post("/shops/manual", { marketplace, shopName });
      toast("Toko manual ditambahkan", "success");
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card padded={false}>
      <CardHeader
        title="Tambah Toko Manual"
        subtitle="Untuk toko yang belum resmi terhubung ke marketplace, tapi ingin disiapkan lebih dulu (misal untuk mapping sub-seller)."
        action={
          <Button variant="text" size="sm" onClick={onCancel}>
            Tutup
          </Button>
        }
      />
      <form onSubmit={submit} className="p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Marketplace" required>
            <Select
              value={marketplace}
              onChange={(e) => setMarketplace(e.target.value as Marketplace)}
            >
              <option value="tiktok">TikTok Shop</option>
              <option value="shopee">Shopee</option>
            </Select>
          </Field>
          <Field label="Nama Toko" required>
            <Input
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              required
              placeholder="Nama toko"
            />
          </Field>
        </div>
        {err && (
          <div className="mt-3">
            <InlineAlert tone="danger">{err}</InlineAlert>
          </div>
        )}
        <div className="mt-4">
          <Button variant="filled" icon="plus" loading={busy} disabled={!shopName.trim()}>
            Tambah
          </Button>
        </div>
      </form>
    </Card>
  );
}
