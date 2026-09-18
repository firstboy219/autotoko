import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { useRealtime } from "../lib/realtime";
import { api } from "../lib/api";
import { rupiah, dateShort } from "../lib/fmt";
import { FLOW, SIDE, ALL_FS, FS_LABEL } from "../lib/orderStatus";
import { Icon, type IconName } from "../components/Icon";
import {
  PageHeader,
  Card,
  Button,
  Badge,
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

interface OrderItem {
  /** Bentuk sebenarnya yang tersimpan di orders.items (peta-tiktok.ts). */
  name?: string;
  skuName?: string;
  skuId?: string;
  /** Nama master produk AutoToko hasil mapping varian (dari backend). */
  masterName?: string | null;
  sellerSku?: string;
  qty?: number;
  salePrice?: number;
  subtotal?: number;
  /** Thumbnail varian dari marketplace, bila tersedia. */
  skuImage?: string | null;
  /** Nama field lama (kompatibilitas mundur / baris manual). */
  item_id?: string;
  product_name?: string;
  seller_sku?: string;
  quantity?: number;
  sale_price?: string;
}

interface Order {
  id: string;
  marketplace: string;
  marketplaceOrderId: string;
  status: string | null;
  fulfillmentStatus: string;
  buyerName: string | null;
  totalAmount: string | null;
  platformFee: string | null;
  feeDeducted: boolean;
  items: OrderItem[] | null;
  createdAt: string;
  /**
   * "api" dari marketplace, "manual" dari scan resi di aplikasi.
   *
   * Yang manual tidak punya nominal: scan mencatat bahwa paket dikirim, bukan
   * berapa harganya.
   */
  sumber?: "api" | "manual";
  trackingNumber?: string | null;
  /** Nama toko (label seller bila ada, jika tidak nama marketplace). */
  shopName?: string | null;
  /** Order API ini sudah dicocokkan dengan scan resi gudang. */
  terscan?: boolean;
  scanned?: boolean;
  shippingCourier?: string | null;
  createdAtMarketplace?: string | null;
  isCod?: boolean;
  shipDeadlineMs?: number | null;
  priorityLevel?: number | null;
  /** Estimasi pencairan marketplace dari detail order (backend). */
  estPencairan?: string | null;
  priceDetail?: Record<string, unknown> | null;
  trackingLast?: Array<Record<string, unknown>> | null;
  /** URL PDF AWB/resi yang sudah di-cache ke server (backend). */
  awbUrl?: string | null;
}

type BatchRow = { orderId: string; ok: boolean; orderNo: string | null; error?: string };
type BatchResp = { total: number; ok: number; ditahan: number; labelsPdf?: string | null; packingListPdf?: string | null; hasil: BatchRow[] };

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

const MP_LABEL: Record<string, string> = {
  tiktok: "TikTok Shop",
  shopee: "Shopee",
  tokopedia: "Tokopedia",
  lazada: "Lazada",
};

const MP_TONE: Record<string, Tone> = {
  tiktok: "neutral",
  shopee: "warning",
  tokopedia: "success",
  lazada: "info",
};

// Alur & label status: satu sumber di ../lib/orderStatus (dulu disalin di sini).
const FS_TONE: Record<string, Tone> = {
  masuk: "neutral", approved: "info", produksi: "brand", packing: "brand",
  siap_kirim: "warning", dikirim: "info", selesai: "success",
  retur: "warning", dibatalkan: "danger",
};

// Label ramah status MARKETPLACE mentah (orders.status) — beda dari status proses internal.
const MP_STATUS_LABEL: Record<string, string> = {
  UNPAID: "Belum Bayar", ON_HOLD: "Ditahan", AWAITING_SHIPMENT: "Menunggu Diproses",
  AWAITING_COLLECTION: "Menunggu Pickup", PARTIALLY_SHIPPING: "Sebagian Dikirim",
  IN_TRANSIT: "Dalam Pengiriman", DELIVERED: "Terkirim", COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan", CANCELED: "Dibatalkan",
};

const PAGE_SIZE = 15;

type ViewMode = "tabel" | "kanban";

const VIEWS: { mode: ViewMode; label: string; icon: IconName }[] = [
  { mode: "tabel", label: "Tabel", icon: "fileText" },
  { mode: "kanban", label: "Kanban", icon: "dashboard" },
];

/** Nama produk pertama pada satu pesanan (bentuk baru atau lama). */
function firstItemName(o: Order): string | null {
  const it = o.items?.[0];
  return it ? (it.masterName ?? it.name ?? it.product_name ?? it.skuName ?? it.sellerSku ?? it.seller_sku ?? null) : null;
}

// Aging & tenggat (poin 2 & 3). createdAtMarketplace lebih akurat dari createdAt.
function orderCreatedMs(o: Order): number {
  const t = Date.parse(o.createdAtMarketplace || o.createdAt || "");
  return Number.isFinite(t) ? t : 0;
}
function fmtAge(age: number): string {
  if (age <= 0) return "\u2013";
  const h = Math.floor(age / 3600000);
  if (h < 1) return "baru";
  if (h < 24) return `${h} jam`;
  return `${Math.floor(h / 24)} hari`;
}
function agingText(createdMs: number): string {
  if (!createdMs) return "";
  const age = Date.now() - createdMs;
  return age < 0 ? "" : fmtAge(age);
}
function startTodayJakMs(): number {
  const JAK = 7 * 3600000;
  return Math.floor((Date.now() + JAK) / 86400000) * 86400000 - JAK;
}

/** URL thumbnail unik dari item pesanan (varian marketplace). */
function itemThumbs(o: Order): { src: string; name: string }[] {
  const out: { src: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const it of o.items ?? []) {
    const src = it.skuImage;
    if (!src || seen.has(src)) continue;
    seen.add(src);
    out.push({ src, name: it.name ?? it.product_name ?? it.skuName ?? "" });
  }
  return out;
}

/**
 * Tumpukan thumbnail produk untuk satu pesanan.
 *
 * Kartu order lebih mudah dikenali lewat rupa produknya daripada deretan
 * nomor. Bila satu pesanan berisi beberapa produk, thumbnail ditumpuk
 * bertindih dengan penanda "+N" -- rapat tapi tetap terbaca. Gambar yang
 * gagal dimuat menyembunyikan dirinya agar tidak meninggalkan kotak kosong,
 * dan pesanan tanpa gambar (mis. scan manual) memakai placeholder keranjang.
 */
function ProductThumbs({ order, size = 40, max = 3 }: { order: Order; size?: number; max?: number }) {
  const thumbs = itemThumbs(order);
  const overlap = -Math.round(size * 0.34);
  if (!thumbs.length) {
    return (
      <div
        className="shrink-0 grid place-items-center rounded-xl bg-canvas text-ink-3 ring-1 ring-line"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <Icon name="cart" size={Math.round(size * 0.5)} />
      </div>
    );
  }
  const shown = thumbs.slice(0, max);
  const extra = thumbs.length - shown.length;
  return (
    <div className="shrink-0 flex items-center" style={{ height: size }}>
      {shown.map((t, i) => (
        <img
          key={t.src}
          src={t.src}
          alt={t.name}
          title={t.name}
          loading="lazy"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
          className="rounded-xl object-cover bg-canvas ring-1 ring-line shadow-e1"
          style={{ width: size, height: size, marginLeft: i === 0 ? 0 : overlap, zIndex: shown.length - i }}
        />
      ))}
      {extra > 0 && (
        <span
          className="grid place-items-center rounded-xl bg-ink/85 text-white text-xs font-semibold ring-1 ring-white/40"
          style={{ width: size, height: size, marginLeft: overlap }}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}

export function Orders() {
  // Default fokus ke order aktif: ~99% arsip (selesai/batal) disembunyikan.
  const [aktifSaja, setAktifSaja] = useState(true);
  const { data, loading, reload } = useFetch<Order[]>(aktifSaja ? "/orders?active=1" : "/orders");
  const { data: ringkas, reload: reloadRingkas } =
    useFetch<{ perStatus: Record<string, number>; manual: number }>("/orders/board-summary");
  const toast = useToast();
  useRealtime(useCallback(() => { reload(); reloadRingkas(); }, [reload, reloadRingkas]));
  // Label status internal bisa di-rename dari Admin CMS -> hidrasi FS_LABEL saat
  // muat supaya tabel/badge memakai nama terbaru (bukan default statis).
  const [, setLabelVer] = useState(0);
  useEffect(() => {
    api.get<{ label?: Record<string, string> }>("/orders/status-meta")
      .then((m) => { if (m?.label) { Object.assign(FS_LABEL, m.label); setLabelVer((v) => v + 1); } })
      .catch(() => { /* pakai default */ });
  }, []);
  const [view, setView] = useState<ViewMode>("tabel");
  const [q, setQ] = useState("");
  const [mp, setMp] = useState("");
  const [fs, setFs] = useState("");
  const [src, setSrc] = useState<"" | "api" | "manual">("");
  const [statFilter, setStatFilter] = useState<"" | "kirim_hari_ini" | "urgent">("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Order | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [otomasiOpen, setOtomasiOpen] = useState(false);

  const all = data ?? [];

  // Kartu ringkas (poin 2) + order nilai tertinggi (poin 3.2), dihitung dari list.
  const stats = useMemo(() => {
    const now = Date.now(); const endToday = startTodayJakMs() + 86400000;
    let shipToday = 0, urgent = 0, oldest = 0, newest = 0; let any = false;
    for (const o of all) {
      const st = o.fulfillmentStatus;
      if (st === "dikirim" || st === "selesai" || st === "dibatalkan") continue;
      const dl = o.shipDeadlineMs ?? 0;
      if (dl > 0 && dl < endToday) shipToday++;
      if (dl > 0 && dl < now + 3 * 3600000) urgent++;
      const cm = orderCreatedMs(o);
      if (cm > 0) { const age = now - cm; if (!any) { oldest = age; newest = age; any = true; } else { oldest = Math.max(oldest, age); newest = Math.min(newest, age); } }
    }
    return { shipToday, urgent, oldest, newest, any };
  }, [all]);
  const maxValueId = useMemo(() => {
    let mv = -1, id = "";
    for (const o of all) {
      const st = o.fulfillmentStatus;
      if (st === "dikirim" || st === "selesai" || st === "dibatalkan") continue;
      const v = o.totalAmount != null ? Number(o.totalAmount) : -1;
      if (v > mv) { mv = v; id = o.id; }
    }
    return id;
  }, [all]);
  const marketplaces = useMemo(() => [...new Set(all.map((o) => o.marketplace))], [all]);

  // Shared search + marketplace + source filter for both views. The
  // fulfillment-status dropdown only applies to the table view.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((o) => {
      if (mp && o.marketplace !== mp) return false;
      if (src && (o.sumber ?? "api") !== src) return false;
      if (view === "tabel" && fs && o.fulfillmentStatus !== fs) return false;
      if (statFilter) {
        const st = o.fulfillmentStatus;
        const aktif = st !== "dikirim" && st !== "selesai" && st !== "dibatalkan";
        const dl = o.shipDeadlineMs ?? 0;
        const endToday = startTodayJakMs() + 86400000;
        if (statFilter === "kirim_hari_ini" && !(aktif && dl > 0 && dl < endToday)) return false;
        if (statFilter === "urgent" && !(aktif && dl > 0 && dl < Date.now() + 3 * 3600000)) return false;
      }
      if (needle) {
        const hay = `${o.marketplaceOrderId} ${o.buyerName ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [all, q, mp, fs, src, view, statFilter]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const rows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const hasFilters = Boolean(q.trim() || mp || fs || src);

  // Keep the live modal order in sync with reloaded data so the board reflects moves.
  const liveSelected = selected && (all.find((o) => o.id === selected.id) ?? selected);

  // Hanya order API (bukan scan manual) yang statusnya bisa diubah massal.
  const pageApiIds = rows.filter((o) => (o.sumber ?? "api") === "api").map((o) => o.id);
  const semuaTerpilih = pageApiIds.length > 0 && pageApiIds.every((id) => sel.has(id));
  const toggleSel = (id: string) =>
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleSemua = () =>
    setSel((s) => {
      const n = new Set(s);
      if (semuaTerpilih) pageApiIds.forEach((id) => n.delete(id));
      else pageApiIds.forEach((id) => n.add(id));
      return n;
    });

  async function moveStatus(order: Order, status: string) {
    try {
      await api.patch<Order>(`/orders/${order.id}/status`, { status });
      toast(`Order dipindah ke ${FS_LABEL[status] ?? status}`, "success");
      reload(); reloadRingkas();
    } catch (e) {
      toast((e as Error).message, "danger");
    }
  }

  async function bulkStatus(status: string) {
    const ids = [...sel];
    if (!ids.length) return;
    setBulkBusy(true);
    try {
      const r = await api.patch<{ updated: number }>("/orders/status/bulk", { ids, status });
      toast(`${r.updated} order → ${FS_LABEL[status] ?? status}`, "success");
      setSel(new Set());
      reload(); reloadRingkas();
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setBulkBusy(false);
    }
  }

  const [batchOpen, setBatchOpen] = useState(false);
  const [jemputOpen, setJemputOpen] = useState(false);
  const [batchesOpen, setBatchesOpen] = useState(false);
  const [petaOpen, setPetaOpen] = useState(false);

  return (
    <Layout title="Orders">
      <PageHeader
        title="Orders"
        subtitle="Pantau dan proses pesanan dari semua marketplace."
        actions={
          <>
            <div className="inline-flex items-center rounded-full border border-line bg-white p-0.5">
              {VIEWS.map((v) => (
                <button
                  key={v.mode}
                  onClick={() => setView(v.mode)}
                  aria-pressed={view === v.mode}
                  className={`inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-sm font-medium transition ${
                    view === v.mode
                      ? "bg-brand/15 text-brand-ink"
                      : "text-ink-2 hover:text-ink hover:bg-canvas"
                  }`}
                >
                  <Icon name={v.icon} size={15} />
                  {v.label}
                </button>
              ))}
            </div>
            <Button variant="filled" icon="package" onClick={() => setBatchOpen(true)}>
              Mulai Batch Packing
            </Button>
            <Button variant="outline" onClick={() => setJemputOpen(true)}>
              Jadwalkan Jemput
            </Button>
            <Button variant="outline" icon="fileText" onClick={() => setBatchesOpen(true)}>
              Daftar Batch
            </Button>
            <Button variant="outline" onClick={() => setOtomasiOpen(true)}>
              Otomasi Order
            </Button>
            <Button variant="outline" icon="activity" onClick={() => setPetaOpen(true)}>
              Pemetaan Status
            </Button>
            <Button variant="outline" icon="refresh" loading={loading} onClick={() => reload()}>
              Segarkan
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <button type="button"
          onClick={() => { setStatFilter(statFilter === "kirim_hari_ini" ? "" : "kirim_hari_ini"); setAktifSaja(true); setView("tabel"); setPage(0); }}
          className={`rounded-lg border px-3 py-2 text-left transition ${statFilter === "kirim_hari_ini" ? "border-brand bg-brand/10" : "border-line bg-white hover:bg-canvas"}`}>
          <div className="text-xl font-bold tabular-nums text-ink">{stats.shipToday}</div>
          <div className="text-xs text-ink-2">Kirim hari ini</div>
        </button>
        <button type="button"
          onClick={() => { setStatFilter(statFilter === "urgent" ? "" : "urgent"); setAktifSaja(true); setView("tabel"); setPage(0); }}
          className={`rounded-lg border px-3 py-2 text-left transition ${statFilter === "urgent" ? "border-brand bg-brand/10" : "border-line bg-white hover:bg-canvas"}`}>
          <div className="text-xl font-bold tabular-nums" style={{ color: "#B3261E" }}>{stats.urgent}</div>
          <div className="text-xs text-ink-2">Urgent (\u22643 jam / lewat)</div>
        </button>
        <div className="rounded-lg border border-line bg-white px-3 py-2">
          <div className="text-xl font-bold tabular-nums text-ink">{stats.any ? fmtAge(stats.oldest) : "\u2013"}</div>
          <div className="text-xs text-ink-2">Order terlama</div>
        </div>
        <div className="rounded-lg border border-line bg-white px-3 py-2">
          <div className="text-xl font-bold tabular-nums text-ink">{stats.any ? fmtAge(stats.newest) : "\u2013"}</div>
          <div className="text-xs text-ink-2">Order terbaru</div>
        </div>
      </div>

      {ringkas && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {([
            ["masuk", "Menunggu Disetujui"],
            ["approved", "Menunggu Dicetak"],
            ["packing", "Menunggu Dipacking"],
            ["siap_kirim", "Menunggu Dipickup"],
            ["dikirim", "Dalam Pengiriman"],
          ] as const).map(([s, label]) => {
            const n = ringkas.perStatus[s] ?? 0;
            const on = fs === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => { setFs(on ? "" : s); setAktifSaja(true); setView("tabel"); setPage(0); }}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition ${
                  on ? "border-brand bg-brand/10 text-brand-ink" : "border-line bg-white text-ink-2 hover:text-ink"
                }`}
              >
                {label}
                <span className="font-semibold tabular-nums text-ink">{n}</span>
              </button>
            );
          })}
          <span className="ml-auto self-center text-xs text-ink-3 tabular-nums">
            Selesai {ringkas.perStatus["selesai"] ?? 0} · Batal {ringkas.perStatus["dibatalkan"] ?? 0} · Scan manual {ringkas.manual}
          </span>
        </div>
      )}

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[200px]">
            <Icon
              name="search"
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none"
            />
            <Input
              className="pl-9"
              placeholder="Cari order ID / pembeli…"
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(0); }}
            />
          </div>
          <Select
            className="w-auto min-w-[170px]"
            value={mp}
            onChange={(e) => { setMp(e.target.value); setPage(0); }}
          >
            <option value="">Semua marketplace</option>
            {marketplaces.map((m) => (
              <option key={m} value={m}>{MP_LABEL[m] ?? m}</option>
            ))}
          </Select>
          <Select
            className="w-auto min-w-[150px]"
            value={src}
            onChange={(e) => { setSrc(e.target.value as "" | "api" | "manual"); setPage(0); }}
          >
            <option value="">Semua sumber</option>
            <option value="api">API marketplace</option>
            <option value="manual">Scan manual</option>
          </Select>
          {view === "tabel" && (
            <Select
              className="w-auto min-w-[150px]"
              value={fs}
              onChange={(e) => { setFs(e.target.value); setPage(0); }}
            >
              <option value="">Semua status</option>
              {ALL_FS.map((s) => <option key={s} value={s}>{FS_LABEL[s]}</option>)}
            </Select>
          )}
          <button
            type="button"
            aria-pressed={aktifSaja}
            onClick={() => { setAktifSaja((v) => !v); setPage(0); }}
            title="Sembunyikan order selesai/dibatalkan & scan manual"
            className={`text-sm font-medium px-3 py-1.5 rounded-lg border inline-flex items-center gap-1.5 transition ${
              aktifSaja ? "bg-brand/10 text-brand-ink border-brand" : "bg-white text-ink-2 border-line hover:text-ink"
            }`}
          >
            <span className={`w-2 h-2 rounded-full border border-current ${aktifSaja ? "bg-current" : ""}`} />
            Aktif saja
          </button>
          {hasFilters && (
            <Button
              variant="text"
              icon="close"
              onClick={() => { setQ(""); setMp(""); setFs(""); setPage(0); }}
            >
              Reset
            </Button>
          )}
        </div>
      </Card>

      {view === "kanban" ? (
        <KanbanBoard
          orders={filtered}
          loading={loading}
          onSelect={setSelected}
          onMove={moveStatus}
        />
      ) : (
        <>
        {sel.size > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand bg-brand/5 px-3 py-2">
            <span className="text-sm font-medium text-ink">{sel.size} order dipilih</span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" icon="check" loading={bulkBusy} onClick={() => bulkStatus("approved")}>
                Setujui
              </Button>
              <Button size="sm" variant="tonal" loading={bulkBusy} onClick={() => bulkStatus("packing")}>
                Set Packing
              </Button>
              <Select
                className="w-auto min-w-[150px]"
                value=""
                disabled={bulkBusy}
                onChange={(e) => { if (e.target.value) void bulkStatus(e.target.value); }}
              >
                <option value="">Ubah ke status…</option>
                {ALL_FS.map((s) => <option key={s} value={s}>{FS_LABEL[s]}</option>)}
              </Select>
              <Button size="sm" variant="text" onClick={() => setSel(new Set())}>Batal</Button>
            </div>
          </div>
        )}
        <Card padded={false} className="overflow-hidden">
          <TableWrap>
            <Table className="min-w-[980px]">
              <THead>
                <tr>
                  <TH>
                    <input
                      type="checkbox"
                      aria-label="Pilih semua order di halaman"
                      checked={semuaTerpilih}
                      onChange={toggleSemua}
                      disabled={pageApiIds.length === 0}
                      className="w-4 h-4 accent-brand align-middle"
                    />
                  </TH>
                  <TH>Order</TH>
                  <TH>Sumber</TH>
                  <TH>Marketplace</TH>
                  <TH>Toko</TH>
                  <TH>Status Proses</TH>
                  <TH>Status MP</TH>
                  <TH>Scan</TH>
                  <TH>Pembeli</TH>
                  <TH>Nomor Resi</TH>
                  <TH align="right">Total</TH>
                  <TH align="right">Est. Pencairan</TH>
                  <TH align="right">Fee</TH>
                  <TH align="right">Waktu</TH>
                </tr>
              </THead>
              <tbody>
                {loading ? (
                  <SkeletonRows n={8} cols={14} />
                ) : !rows.length ? (
                  <tr>
                    <td colSpan={14}>
                      <EmptyState
                        icon="cart"
                        title={hasFilters ? "Tidak ada order yang cocok" : "Belum ada order"}
                        description={
                          hasFilters
                            ? "Coba ubah kata kunci atau reset filter."
                            : "Order masuk otomatis via webhook marketplace."
                        }
                        action={
                          hasFilters ? (
                            <Button
                              variant="tonal"
                              icon="close"
                              onClick={() => { setQ(""); setMp(""); setFs(""); setPage(0); }}
                            >
                              Reset filter
                            </Button>
                          ) : undefined
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  rows.map((o) => (
                    <TR
                      key={o.id}
                      className="cursor-pointer hover:bg-canvas"
                      style={(() => {
                        const dl = o.shipDeadlineMs ?? 0; const now = Date.now(); const endToday = startTodayJakMs() + 86400000;
                        const st = o.fulfillmentStatus; const aktif = st !== "dikirim" && st !== "selesai" && st !== "dibatalkan";
                        if (aktif && dl > 0 && dl < now) return { boxShadow: "inset 3px 0 0 #B3261E" };
                        if (aktif && dl > 0 && dl < endToday) return { boxShadow: "inset 3px 0 0 #B36A00" };
                        return undefined;
                      })()}
                      onClick={() => setSelected(o)}
                    >
                      <TD onClick={(e) => e.stopPropagation()}>
                        {(o.sumber ?? "api") === "api" ? (
                          <input
                            type="checkbox"
                            aria-label={`Pilih order ${o.marketplaceOrderId}`}
                            checked={sel.has(o.id)}
                            onChange={() => toggleSel(o.id)}
                            className="w-4 h-4 accent-brand align-middle"
                          />
                        ) : null}
                      </TD>
                      <TD>
                        <div className="flex items-center gap-2.5">
                          <ProductThumbs order={o} size={40} />
                          <div className="min-w-0">
                            <div className="font-mono text-xs text-ink truncate">
                              {o.marketplaceOrderId || o.trackingNumber || "-"}
                            </div>
                            {firstItemName(o) && (
                              <div className="text-xs text-ink-3 truncate max-w-[220px]">
                                {firstItemName(o)}
                                {(o.items?.length ?? 0) > 1 ? ` +${(o.items?.length ?? 0) - 1} lainnya` : ""}
                              </div>
                            )}
                            {(o.sumber ?? "api") === "api" && (
                              <div className="flex flex-wrap items-center gap-1 mt-1">
                                {(() => {
                                  const dl = o.shipDeadlineMs ?? 0; const now = Date.now(); const endToday = startTodayJakMs() + 86400000;
                                  if (dl > 0 && dl < now) return <Badge tone="danger">lewat tenggat</Badge>;
                                  if (dl > 0 && dl < endToday) return <Badge tone="warning">kirim duluan</Badge>;
                                  return null;
                                })()}
                                {o.isCod && <Badge tone="warning">COD</Badge>}
                                {o.id === maxValueId && <Badge tone="info">nilai tertinggi</Badge>}
                                {o.shippingCourier && <span className="text-[11px] text-ink-3">{o.shippingCourier}</span>}
                                {orderCreatedMs(o) > 0 && (() => { const days = (Date.now() - orderCreatedMs(o)) / 86400000; return <Badge tone={days >= 3 ? "danger" : days >= 1 ? "warning" : "neutral"}>umur {agingText(orderCreatedMs(o))}</Badge>; })()}
                              </div>
                            )}
                          </div>
                        </div>
                      </TD>
                      <TD>
                        <Badge tone={o.sumber === "manual" ? "warning" : "info"}>
                          {o.sumber === "manual" ? "Scan manual" : "API"}
                        </Badge>
                      </TD>
                      <TD>
                        <Badge tone={MP_TONE[o.marketplace] ?? "neutral"}>
                          {MP_LABEL[o.marketplace] ?? o.marketplace}
                        </Badge>
                      </TD>
                      <TD className="text-ink-2">{o.shopName ?? "-"}</TD>
                      <TD>
                        <Badge tone={FS_TONE[o.fulfillmentStatus] ?? "neutral"}>
                          {FS_LABEL[o.fulfillmentStatus] ?? o.fulfillmentStatus}
                        </Badge>
                      </TD>
                      <TD>
                        {o.status ? (
                          <span className="text-xs text-ink-2 whitespace-nowrap">{MP_STATUS_LABEL[o.status] ?? o.status}</span>
                        ) : <span className="text-ink-3 text-xs">—</span>}
                      </TD>
                      <TD>
                        {(o.sumber ?? "api") === "manual" ? (
                          <span className="text-ink-3 text-xs">—</span>
                        ) : o.terscan ? (
                          <Badge tone="success">Discan</Badge>
                        ) : (
                          <span className="text-xs text-ink-3">Belum</span>
                        )}
                      </TD>
                      <TD>{o.buyerName ?? "-"}</TD>
                      <TD>
                        {o.trackingNumber ? (
                          <span className="font-mono text-xs text-ink whitespace-nowrap" title="Nomor resi / AWB">{o.trackingNumber}</span>
                        ) : (
                          <span className="text-ink-3 text-xs">—</span>
                        )}
                      </TD>
                      <TD align="right" className="tabular-nums whitespace-nowrap">
                        {o.totalAmount == null ? (
                          // Bukan "Rp 0". Nol berarti terjual nol rupiah;
                          // yang benar di sini adalah "belum diketahui".
                          <span className="text-ink-3" title="Scan resi tidak mencatat nominal">
                            —
                          </span>
                        ) : (
                          rupiah(o.totalAmount)
                        )}
                      </TD>
                      <TD align="right" className="tabular-nums whitespace-nowrap">
                        {o.estPencairan == null ? (
                          <span className="text-ink-3">—</span>
                        ) : (
                          <span className="text-emerald-700" title="Estimasi NET: harga setelah diskon − estimasi komisi (atur % di Otomasi Order). Komisi asli TikTok tak tersedia di API order.">≈ {rupiah(o.estPencairan)}</span>
                        )}
                      </TD>
                      <TD align="right" className="tabular-nums whitespace-nowrap">
                        {o.platformFee == null ? (
                          <span className="text-ink-3">—</span>
                        ) : o.feeDeducted ? (
                          rupiah(o.platformFee)
                        ) : (
                          <span className="text-xs text-amber-600">pending</span>
                        )}
                      </TD>
                      <TD align="right" className="text-ink-2 text-xs whitespace-nowrap">
                        {dateShort(o.createdAt)}
                      </TD>
                    </TR>
                  ))
                )}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
        </>
      )}

      {view === "tabel" && filtered.length > PAGE_SIZE && (
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
          <div className="text-xs text-ink-2 tabular-nums">
            {filtered.length} order · hal {safePage + 1}/{pages}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              icon="chevronLeft"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
            >
              Sebelumnya
            </Button>
            <Button
              size="sm"
              variant="outline"
              iconRight="chevronRight"
              disabled={safePage >= pages - 1}
              onClick={() => setPage(safePage + 1)}
            >
              Berikutnya
            </Button>
          </div>
        </div>
      )}

      {liveSelected && (
        <OrderDetail
          order={liveSelected}
          onClose={() => setSelected(null)}
          onChanged={(updated) => { setSelected(updated); reload(); reloadRingkas(); }}
        />
      )}

      {otomasiOpen && <OtomasiOrderModal onClose={() => setOtomasiOpen(false)} />}
      {batchesOpen && <BatchesModal onClose={() => setBatchesOpen(false)} onChanged={() => { reload(); reloadRingkas(); }} />}
      {petaOpen && <PemetaanStatusModal onClose={() => setPetaOpen(false)} />}
      {batchOpen && (
        <BatchPackingModal
          onClose={() => setBatchOpen(false)}
          onDone={() => { reload(); reloadRingkas(); }}
        />
      )}
      {jemputOpen && (
        <JadwalJemputModal
          onClose={() => setJemputOpen(false)}
          onDone={() => { reload(); reloadRingkas(); }}
        />
      )}
    </Layout>
  );
}


type Slot = { startTime: number; endTime: number; tersedia: boolean };
type SlotResp = { orderId: string; packageId: string; bisaJemput: boolean; bisaDropOff: boolean; dropOffUrl: string | null; slots: Slot[] };
const INSTANT_KEYS = ["instant", "sameday", "same day", "same-day", "gojek", "gosend", "grab", "grabexpress", "grab express", "gokilat", "borzo", "lalamove", "spx instant", "spx sameday"];
const isSameday = (o: Order) => { const c = (o.shippingCourier ?? "").toLowerCase(); return INSTANT_KEYS.some((k) => c.includes(k)); };
const fmtSlot = (s: Slot) => {
  const a = new Date(s.startTime * 1000), b = new Date(s.endTime * 1000);
  const d = a.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const e = b.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  return `${d} \u2013 ${e}`;
};

function JadwalJemputModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data, loading } = useFetch<Order[]>("/orders?active=1");
  const kandidat = (data ?? []).filter((o) => (o.sumber ?? "api") === "api" && o.fulfillmentStatus !== "dikirim" && isSameday(o));
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [slotState, setSlotState] = useState<SlotResp | null>(null);
  const [pickedIdx, setPickedIdx] = useState<number | null>(null);
  const [loadingSlot, setLoadingSlot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hasil, setHasil] = useState<{ ok: number; gagal: number } | null>(null);

  const selArr = kandidat.filter((o) => sel.has(o.id));
  const toggle = (id: string) => setSel((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function muatSlot() {
    if (!selArr.length) { toast("Pilih order dulu", "warning"); return; }
    setLoadingSlot(true); setSlotState(null); setPickedIdx(null);
    try {
      const r = await api.get<SlotResp>(`/marketplace-sync/orders/${selArr[0]!.id}/slot-jemput`);
      setSlotState(r);
      if (!r.bisaJemput) toast("Order ini tak mendukung jemput (pickup). Pakai Batch Packing biasa (drop-off).", "warning");
    } catch (e) { toast((e as Error).message, "danger"); }
    finally { setLoadingSlot(false); }
  }

  async function proses() {
    if (pickedIdx == null || !slotState) return;
    const slot = slotState.slots[pickedIdx]!;
    if (!window.confirm(`Jadwalkan jemput ${selArr.length} order pada ${fmtSlot(slot)}, lalu RTS + buat resi. Tindakan nyata \u2014 lanjutkan?`)) return;
    setBusy(true);
    try {
      const r = await api.post<BatchResp>("/marketplace-sync/orders/batch-packing", {
        orderIds: selArr.map((o) => o.id),
        pickupSlot: { startTime: slot.startTime, endTime: slot.endTime },
      });
      if (r.labelsPdf) unduhBase64Pdf(r.labelsPdf, "resi-jemput.pdf");
      if (r.packingListPdf) unduhBase64Pdf(r.packingListPdf, "packing-list.pdf");
      const gagal = r.hasil.filter((h) => !h.ok).length;
      setHasil({ ok: r.ok, gagal });
      toast(`Jemput terjadwal: ${r.ok} order diproses${gagal ? `, ${gagal} gagal` : ""}.`, gagal ? "warning" : "success");
      onDone();
    } catch (e) { toast((e as Error).message, "danger"); }
    finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title="Jadwalkan Jemput (Sameday/Instant)" width="max-w-2xl">
      {hasil ? (
        <div className="space-y-3">
          <InlineAlert tone={hasil.gagal ? "warning" : "success"}>Selesai: {hasil.ok} order dijadwalkan jemput &amp; diproses{hasil.gagal ? `, ${hasil.gagal} gagal` : ""}. PDF resi terunduh.</InlineAlert>
          <div className="flex justify-end"><Button variant="filled" onClick={onClose}>Tutup</Button></div>
        </div>
      ) : loading ? (
        <Skeleton className="h-40 w-full" />
      ) : kandidat.length === 0 ? (
        <EmptyState icon="cart" title="Tidak ada order sameday/instant" description="Order kurir instant/sameday (gosend, grab, dll.) muncul di sini untuk dijadwalkan jemput." />
      ) : (
        <div className="space-y-3">
          <div className="text-sm text-ink-2">{kandidat.length} order sameday/instant \u00b7 {selArr.length} dipilih</div>
          <div className="max-h-[36vh] overflow-y-auto border border-line rounded-lg divide-y divide-line">
            {kandidat.map((o) => (
              <label key={o.id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer">
                <input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} className="w-4 h-4 accent-brand" />
                <ProductThumbs order={o} size={34} max={2} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink truncate"><span className="font-mono text-xs">{o.marketplaceOrderId}</span> \u00b7 {o.buyerName ?? "-"}</div>
                  <div className="text-[11px] text-ink-3 truncate">{o.shippingCourier ?? "-"} \u00b7 {FS_LABEL[o.fulfillmentStatus] ?? o.fulfillmentStatus}</div>
                </div>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" loading={loadingSlot} disabled={!selArr.length} onClick={muatSlot}>Muat jadwal jemput</Button>
            {slotState && <span className="text-[11px] text-ink-3">{slotState.bisaJemput ? `${slotState.slots.length} slot tersedia` : "tak mendukung jemput"}</span>}
          </div>
          {slotState && slotState.slots.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[24vh] overflow-y-auto">
              {slotState.slots.map((sl, i) => (
                <label key={i} className={`flex items-center gap-2 rounded border px-2 py-1.5 text-xs cursor-pointer ${pickedIdx === i ? "border-brand bg-brand/5" : "border-line"} ${sl.tersedia ? "" : "opacity-40"}`}>
                  <input type="radio" name="slotjemput" disabled={!sl.tersedia} checked={pickedIdx === i} onChange={() => setPickedIdx(i)} className="accent-brand" />
                  {fmtSlot(sl)}
                </label>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="text" onClick={onClose} disabled={busy}>Batal</Button>
            <Button variant="filled" icon="package" loading={busy} disabled={pickedIdx == null} onClick={proses}>Jadwalkan &amp; Proses {selArr.length} order \u2192</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function BatchPackingModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data, loading } = useFetch<Order[]>("/orders?active=1");
  const kandidat = (data ?? []).filter((o) => (o.sumber ?? "api") === "api" && o.fulfillmentStatus !== "dikirim");
  const [taken, setTaken] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [hasil, setHasil] = useState<{ total: number; ok: number; ditahan: number; gagal: number } | null>(null);

  const toggleTakeout = (id: string) =>
    setTaken((m) => { const n = new Map(m); if (n.has(id)) n.delete(id); else n.set(id, ""); return n; });
  const setReason = (id: string, r: string) =>
    setTaken((m) => { const n = new Map(m); if (n.has(id)) n.set(id, r); return n; });

  const includedIds = kandidat.filter((o) => !taken.has(o.id)).map((o) => o.id);

  async function proses() {
    if (!includedIds.length) { toast("Tidak ada order untuk diproses", "warning"); return; }
    if (
      !window.confirm(
        `Proses ${includedIds.length} order: RTS (kirim) ke marketplace, buat AWB, unduh PDF packing list + resi. ` +
          `${taken.size} order di-takeout (ditahan). Tindakan nyata — lanjutkan?`,
      )
    )
      return;
    setBusy(true);
    try {
      const takeouts = [...taken.entries()].map(([orderId, reason]) => ({ orderId, reason }));
      const r = await api.post<BatchResp>(
        "/marketplace-sync/orders/batch-packing",
        { orderIds: includedIds, takeouts, handoverMethod: "DROP_OFF" },
      );
      if (r.labelsPdf) unduhBase64Pdf(r.labelsPdf, "resi-batch.pdf");
      if (r.packingListPdf) unduhBase64Pdf(r.packingListPdf, "packing-list.pdf");
      const gagal = r.hasil.filter((h) => !h.ok).length;
      setHasil({ total: r.total, ok: r.ok, ditahan: r.ditahan, gagal });
      toast(`Batch: ${r.ok} diproses, ${r.ditahan} ditahan${gagal ? `, ${gagal} gagal` : ""}. PDF diunduh.`, gagal ? "warning" : "success");
      onDone();
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Mulai Batch Packing" width="max-w-2xl">
      {hasil ? (
        <div className="space-y-3">
          <InlineAlert tone={hasil.gagal ? "warning" : "success"}>
            Selesai: {hasil.ok} order diproses → Packing, {hasil.ditahan} ditahan
            {hasil.gagal ? `, ${hasil.gagal} gagal` : ""}. PDF packing list &amp; resi sudah terunduh.
          </InlineAlert>
          <div className="flex justify-end"><Button variant="filled" onClick={onClose}>Tutup</Button></div>
        </div>
      ) : loading ? (
        <Skeleton className="h-40 w-full" />
      ) : kandidat.length === 0 ? (
        <EmptyState icon="cart" title="Tidak ada order untuk dikirim" description="Semua order aktif sudah diproses atau belum ada yang perlu dikirim." />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-2">{kandidat.length} order perlu dikirim</span>
            <span className="font-medium text-ink tabular-nums">{includedIds.length} akan diproses · {taken.size} di-takeout</span>
          </div>
          <div className="max-h-[52vh] overflow-y-auto border border-line rounded-lg divide-y divide-line">
            {kandidat.map((o) => {
              const out = taken.has(o.id);
              return (
                <div key={o.id} className={`px-3 py-2.5 ${out ? "bg-canvas" : ""}`}>
                  <div className="flex items-center gap-3">
                    <div className={out ? "opacity-50" : ""}>
                      <ProductThumbs order={o} size={38} max={2} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm truncate ${out ? "text-ink-3 line-through" : "text-ink"}`}>
                        <span className="font-mono text-xs">{o.marketplaceOrderId}</span> · {o.buyerName ?? "-"}
                      </div>
                      <div className="text-[11px] text-ink-3 truncate">
                        {firstItemName(o) ? `${firstItemName(o)} · ` : ""}{o.items?.length ?? 0} item · {FS_LABEL[o.fulfillmentStatus] ?? o.fulfillmentStatus}
                      </div>
                    </div>
                    <Button size="sm" variant={out ? "tonal" : "outline"} onClick={() => toggleTakeout(o.id)}>
                      {out ? "Batalkan" : "Take out"}
                    </Button>
                  </div>
                  {out && (
                    <Input
                      className="mt-2"
                      placeholder="Alasan takeout (mis. stok habis, alamat bermasalah)…"
                      value={taken.get(o.id) ?? ""}
                      onChange={(e) => setReason(o.id, e.target.value)}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="text" onClick={onClose} disabled={busy}>Batal</Button>
            <Button variant="filled" icon="package" loading={busy} disabled={!includedIds.length} onClick={proses}>
              Proses {includedIds.length} order →
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

interface StatusMeta {
  label: Record<string, string>;
  marketplaceMap: Record<string, string>;
  mpLabel: Record<string, string>;
}
/** Read-only: pemetaan status marketplace -> internal (diatur di Admin CMS). */
function PemetaanStatusModal({ onClose }: { onClose: () => void }) {
  const { data } = useFetch<StatusMeta>("/orders/status-meta");
  const map = data?.marketplaceMap ?? {};
  const mpLabel = data?.mpLabel ?? {};
  const fsLabel = data?.label ?? {};
  return (
    <Modal open onClose={onClose} title="Pemetaan Status" width="max-w-lg">
      <p className="text-sm text-ink-2 mb-3">
        Status marketplace → tahap internal AutoToko. Diatur oleh admin (read-only di sini).
      </p>
      <div className="rounded-lg border border-line divide-y divide-line text-sm">
        {Object.entries(map).map(([mp, internal]) => (
          <div key={mp} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="font-mono text-xs text-ink-2">{mp}<span className="text-ink-3"> · {mpLabel[mp] ?? ""}</span></span>
            <Badge tone="neutral">{fsLabel[internal] ?? internal}</Badge>
          </div>
        ))}
      </div>
      <div className="flex justify-end mt-4"><Button variant="text" onClick={onClose}>Tutup</Button></div>
    </Modal>
  );
}

type BatchItem = { id: string; note: string | null; status: string; orderCount: number; createdAt: string; handoverMethod: string | null };
type BatchOrder = { id: string; marketplaceOrderId: string | null; shippingCourier: string | null; fulfillmentStatus: string; buyerName: string | null; totalAmount: string | null };
type BatchDetail = BatchItem & { orders: BatchOrder[] };

/** Daftar & edit/cancel batch packing (poin 1). Selaras dgn menu "Daftar Batch" di APK. */
function BatchesModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [list, setList] = useState<BatchItem[] | null>(null);
  const [sel, setSel] = useState<BatchDetail | null>(null);
  const [note, setNote] = useState("");
  const [remove, setRemove] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const loadList = useCallback(() => {
    api.get<BatchItem[]>("/marketplace-sync/batches").then(setList).catch((e) => toast((e as Error).message, "danger"));
  }, [toast]);
  useEffect(() => { loadList(); }, [loadList]);

  const openDetail = async (id: string) => {
    try { const d = await api.get<BatchDetail>(`/marketplace-sync/batches/${id}`); setSel(d); setNote(d.note ?? ""); setRemove(new Set()); }
    catch (e) { toast((e as Error).message, "danger"); }
  };
  const save = async () => {
    if (!sel) return; setBusy(true);
    try {
      await api.patch(`/marketplace-sync/batches/${sel.id}`, { note, removeOrderIds: [...remove] });
      toast("Batch diperbarui", "success"); setSel(null); loadList(); onChanged();
    } catch (e) { toast((e as Error).message, "danger"); } finally { setBusy(false); }
  };
  const doCancel = async () => {
    if (!sel) return; setBusy(true);
    try {
      await api.post(`/marketplace-sync/batches/${sel.id}/cancel`, {});
      toast("Batch dibatalkan", "success"); setConfirmCancel(false); setSel(null); loadList(); onChanged();
    } catch (e) { toast((e as Error).message, "danger"); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={sel ? "Edit Batch" : "Daftar Batch"} width="max-w-lg">
      {!sel ? (
        <div className="space-y-2">
          {list === null ? (
            <Skeleton className="h-24 w-full" />
          ) : list.length === 0 ? (
            <EmptyState icon="package" title="Belum ada batch" description="Batch muncul di sini setelah Anda menjalankan Batch Packing." />
          ) : (
            list.map((b) => (
              <button key={b.id} type="button" onClick={() => openDetail(b.id)}
                className="w-full text-left rounded-lg border border-line bg-white px-3 py-2.5 hover:bg-canvas transition">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink flex-1 truncate">{b.note ?? "(tanpa catatan)"}</span>
                  <Badge tone={b.status === "cancelled" ? "danger" : "success"}>{b.status === "cancelled" ? "Dibatalkan" : "Aktif"}</Badge>
                </div>
                <div className="text-xs text-ink-2 mt-0.5">{b.orderCount} order · {dateShort(b.createdAt)}</div>
              </button>
            ))
          )}
          <div className="flex justify-end pt-2"><Button variant="text" onClick={onClose}>Tutup</Button></div>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-ink-2">Catatan / nama batch</label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={255} />
          </div>
          <div className="text-xs text-ink-2">Anggota ({sel.orders.length}) — centang untuk dilepas dari batch:</div>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {sel.orders.length === 0 ? (
              <div className="text-sm text-ink-3">Tidak ada order pada batch ini.</div>
            ) : sel.orders.map((o) => {
              const checked = remove.has(o.id);
              return (
                <label key={o.id} className="flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 accent-brand" checked={checked}
                    onChange={() => setRemove((r) => { const n = new Set(r); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); return n; })} />
                  <span className="flex-1 min-w-0">
                    <span className="font-mono text-xs text-ink">{o.marketplaceOrderId ?? "-"}</span>
                    <span className="text-xs text-ink-3"> · {o.shippingCourier ?? "-"} · {FS_LABEL[o.fulfillmentStatus] ?? o.fulfillmentStatus}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button variant="danger" onClick={() => setConfirmCancel(true)} disabled={busy}>Batalkan batch</Button>
            <div className="ml-auto flex gap-2">
              <Button variant="text" onClick={() => setSel(null)} disabled={busy}>Kembali</Button>
              <Button variant="filled" onClick={save} loading={busy}>Simpan</Button>
            </div>
          </div>
        </div>
      )}
      {confirmCancel && (
        <ConfirmModal
          open
          title="Batalkan batch ini?"
          description="Semua order dilepas dari batch & batch ditandai dibatalkan. Ini TIDAK menarik balik pengiriman (RTS) yang sudah terjadi di marketplace."
          confirmLabel="Ya, batalkan"
          onConfirm={doCancel}
          onClose={() => setConfirmCancel(false)}
        />
      )}
    </Modal>
  );
}

function OtomasiOrderModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { data, loading } = useFetch<{ autoSiapKirim: boolean; instantCouriers: string[]; docType?: string; docSize?: string; estCommissionRate?: number }>("/orders/settings");
  const [auto, setAuto] = useState(false);
  const [instant, setInstant] = useState("");
  const [saving, setSaving] = useState(false);
  const [siap, setSiap] = useState(false);
  const [docType, setDocType] = useState("SHIPPING_LABEL_AND_PACKING_SLIP");
  const [docSize, setDocSize] = useState("A6");
  const [komisi, setKomisi] = useState("8");
  useEffect(() => {
    if (data && !siap) {
      setAuto(data.autoSiapKirim);
      setInstant((data.instantCouriers ?? []).join(", "));
      setDocType(data.docType ?? "SHIPPING_LABEL_AND_PACKING_SLIP");
      setDocSize(data.docSize ?? "A6");
      setKomisi(String((data.estCommissionRate ?? 0.08) * 100));
      setSiap(true);
    }
  }, [data, siap]);

  async function simpan() {
    setSaving(true);
    try {
      await api.patch("/orders/settings", {
        autoSiapKirim: auto,
        instantCouriers: instant.split(",").map((s) => s.trim()).filter(Boolean),
        docType,
        docSize,
        estCommissionRate: (Number(komisi) || 0) / 100,
      });
      toast("Pengaturan otomasi order disimpan", "success");
      onClose();
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Otomasi Order" width="max-w-lg">
      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
              className="w-4 h-4 accent-brand mt-0.5 shrink-0"
            />
            <span>
              <span className="text-sm font-medium text-ink">Otomatis setujui / proses order baru</span>
              <span className="block text-xs text-ink-2 mt-0.5">
                Saat sinkronisasi, order baru (<b>Menunggu Disetujui</b>) langsung dinaikkan ke <b>Menunggu Dicetak</b>
                — jadi tim tinggal cetak resi tanpa menyetujui satu per satu. Kecuali kurir instant/sameday di bawah.
                Hanya-maju: tahap yang sudah lebih jauh atau selesai tidak ditarik mundur. Jika dimatikan, order baru
                menunggu disetujui manual.
              </span>
            </span>
          </label>

          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Kecualikan kurir (instant / sameday)</label>
            <Input
              value={instant}
              onChange={(e) => setInstant(e.target.value)}
              placeholder="instant, sameday, same day"
            />
            <p className="text-xs text-ink-3 mt-1">
              Pisahkan dengan koma. Order yang nama kurirnya mengandung salah satu kata ini TIDAK diauto-setujui
              (butuh keputusan manual cepat).
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Dokumen resi</label>
              <select value={docType} onChange={(e) => setDocType(e.target.value)} className="w-full rounded border border-line px-2 py-1.5 text-sm">
                <option value="SHIPPING_LABEL_AND_PACKING_SLIP">Resi + Packing Slip (ada daftar produk)</option>
                <option value="SHIPPING_LABEL">Resi saja</option>
                <option value="PACKING_SLIP">Packing Slip saja</option>
              </select>
              <p className="text-xs text-ink-3 mt-1">Berlaku untuk semua cetak/unduh resi (batch, per-order, auto-unduh).</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Ukuran</label>
              <select value={docSize} onChange={(e) => setDocSize(e.target.value)} className="w-full rounded border border-line px-2 py-1.5 text-sm">
                <option value="A6">A6 (default)</option>
                <option value="A5">A5</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Estimasi komisi TikTok (%)</label>
            <Input
              value={komisi}
              onChange={(e) => setKomisi(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="8"
              className="tabular-nums"
            />
            <p className="text-xs text-ink-3 mt-1">
              Dipakai untuk kolom <b>Est. Pencairan (net)</b> di menu order: harga setelah diskon dikurangi estimasi
              komisi + biaya afiliasi/marketplace. Komisi asli TikTok tak tersedia di API order, jadi sesuaikan sendiri
              (mis. 8). 0 = tidak potong komisi.
            </p>
          </div>

          <InlineAlert tone="warning">
            Auto proses ini hanya menyetujui order di sisi <b>internal</b> AutoToko (Menunggu Disetujui → Menunggu
            Dicetak); status di marketplace tidak berubah. Untuk benar-benar meng-update marketplace (RTS &amp; AWB),
            pakai tombol “Kirim ke marketplace” di detail order — sengaja manual + konfirmasi karena memicu pengiriman
            nyata.
          </InlineAlert>

          <div className="flex justify-end gap-2">
            <Button variant="text" onClick={onClose} disabled={saving}>Batal</Button>
            <Button variant="filled" loading={saving} onClick={simpan}>Simpan</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// --- Batch Packing PDF helpers (pdf-lib, di browser) ---
function unduhBlob(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Unduh PDF dari base64 (label & packing list kini dibuat backend agar
// kualitas/ketajaman label terjaga).
function unduhBase64Pdf(b64: string, name: string) {
  unduhBlob(b64ToBytes(b64), name);
}

// Kanban: one column per FLOW status, with the two SIDE states appended at the end.
const KANBAN_COLUMNS = [...FLOW, ...SIDE];

function KanbanBoard({
  orders,
  loading,
  onSelect,
  onMove,
}: {
  orders: Order[];
  loading: boolean;
  onSelect: (o: Order) => void;
  onMove: (o: Order, status: string) => void | Promise<void>;
}) {
  const byStatus = useMemo(() => {
    const map: Record<string, Order[]> = {};
    for (const s of KANBAN_COLUMNS) map[s] = [];
    for (const o of orders) (map[o.fulfillmentStatus] ??= []).push(o);
    return map;
  }, [orders]);

  if (loading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-3">
        {KANBAN_COLUMNS.map((s) => (
          <div key={s} className="shrink-0 w-64 bg-white rounded-lg border border-line">
            <div className="px-3 py-2.5 border-b border-line">
              <Skeleton className="h-4 w-20" />
            </div>
            <div className="p-2 flex flex-col gap-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!orders.length) {
    return (
      <Card padded={false}>
        <EmptyState
          icon="cart"
          title="Tidak ada order untuk ditampilkan"
          description="Order yang cocok dengan filter akan muncul sebagai kartu di papan ini."
        />
      </Card>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {KANBAN_COLUMNS.map((s) => {
        const items = byStatus[s] ?? [];
        return (
          <div key={s} className="shrink-0 w-64 bg-white rounded-lg border border-line flex flex-col">
            <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-line">
              <Badge tone={FS_TONE[s] ?? "neutral"}>{FS_LABEL[s] ?? s}</Badge>
              <span className="text-xs font-medium text-ink-3 tabular-nums">{items.length}</span>
            </div>
            <div className="p-2 flex flex-col gap-2 min-h-[64px]">
              {items.length === 0 ? (
                <div className="text-xs text-ink-3 text-center py-4">Kosong</div>
              ) : (
                items.map((o) => <KanbanCard key={o.id} order={o} onSelect={onSelect} onMove={onMove} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard({
  order,
  onSelect,
  onMove,
}: {
  order: Order;
  onSelect: (o: Order) => void;
  onMove: (o: Order, status: string) => void | Promise<void>;
}) {
  const idx = FLOW.indexOf(order.fulfillmentStatus as (typeof FLOW)[number]);
  const prev = idx > 0 ? FLOW[idx - 1] : null;
  const next = idx >= 0 && idx < FLOW.length - 1 ? FLOW[idx + 1] : null;

  const move = (status: string) => async (e: MouseEvent) => {
    e.stopPropagation();
    await onMove(order, status);
  };

  return (
    <div
      className="bg-white rounded-lg border border-line p-3 cursor-pointer transition hover:border-brand hover:shadow-e1"
      onClick={() => onSelect(order)}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <Badge tone={MP_TONE[order.marketplace] ?? "neutral"}>
          {MP_LABEL[order.marketplace] ?? order.marketplace}
        </Badge>
        <span className="font-mono text-xs text-ink-3 truncate">{order.marketplaceOrderId}</span>
      </div>
      <div className="flex items-center gap-2.5 mb-1.5">
        <ProductThumbs order={order} size={44} />
        <div className="min-w-0 flex-1">
          <div className="text-xs text-ink-2 truncate">{firstItemName(order) ?? "-"}</div>
          {(order.items?.length ?? 0) > 1 && (
            <div className="text-xs text-ink-3">+{(order.items?.length ?? 0) - 1} produk lain</div>
          )}
        </div>
      </div>
      <div className="text-sm text-ink truncate">{order.buyerName ?? "-"}</div>
      <div className="flex items-center justify-between gap-2 mt-1.5">
        <span className="text-sm font-medium text-ink tabular-nums">{rupiah(order.totalAmount)}</span>
        <span className="text-xs text-ink-3 whitespace-nowrap">{dateShort(order.createdAt)}</span>
      </div>
      {(prev || next) && (
        <div className="flex gap-1.5 mt-2.5">
          {prev ? (
            <button
              onClick={move(prev)}
              title={`Kembali ke ${FS_LABEL[prev]}`}
              aria-label={`Kembali ke ${FS_LABEL[prev]}`}
              className="flex-1 inline-flex items-center justify-center h-7 rounded-full border border-line text-ink-2 transition hover:bg-canvas hover:text-ink"
            >
              <Icon name="chevronLeft" size={15} />
            </button>
          ) : <span className="flex-1" />}
          {next ? (
            <button
              onClick={move(next)}
              title={`Lanjut ke ${FS_LABEL[next]}`}
              aria-label={`Lanjut ke ${FS_LABEL[next]}`}
              className="flex-1 inline-flex items-center justify-center h-7 rounded-full border border-line text-brand-ink transition hover:bg-brand/10"
            >
              <Icon name="chevronRight" size={15} />
            </button>
          ) : <span className="flex-1" />}
        </div>
      )}
    </div>
  );
}

function OrderDetail({ order, onClose, onChanged }: { order: Order; onClose: () => void; onChanged: (o: Order) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmStatus, setConfirmStatus] = useState<string | null>(null);
  const toast = useToast();
  const [tt, setTt] = useState<{ priceDetail?: unknown; tracking?: unknown } | null>(null);
  const [ttBusy, setTtBusy] = useState(false);
  async function refreshTiktok() {
    setTtBusy(true); setErr(null);
    try {
      const r = await api.post<{ ok: boolean; priceDetail?: unknown; tracking?: unknown }>(
        `/orders/${order.id}/refresh-tiktok`,
      );
      setTt({ priceDetail: r.priceDetail, tracking: r.tracking });
      toast("Data TikTok (price detail & tracking) diperbarui", "success");
    } catch (e) { setErr((e as Error).message); }
    finally { setTtBusy(false); }
  }
  useEffect(() => {
    if (order.marketplace === "tiktok" && !order.priceDetail && !tt) void refreshTiktok();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function chatBuyer() {
    setBusy(true); setErr(null);
    try {
      await api.post(`/chat/from-order/${order.id}`);
      toast("Percakapan dibuka — menuju menu Chat…", "success");
      window.location.href = "/chat";
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  const idx = FLOW.indexOf(order.fulfillmentStatus as (typeof FLOW)[number]);
  const next = idx >= 0 && idx < FLOW.length - 1 ? FLOW[idx + 1] : null;

  async function apply(status: string) {
    setBusy(true); setErr(null);
    try {
      const updated = await api.patch<Order>(`/orders/${order.id}/status`, { status });
      toast(`Status order diubah ke ${FS_LABEL[status] ?? status}`, "success");
      onChanged(updated);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      setConfirmStatus(null);
    }
  }

  async function cetakAwb() {
    setBusy(true); setErr(null);
    try {
      const r = await api.get<{ hasil: { docUrl: string | null; trackingNumber: string | null; error?: string }[] }>(
        `/marketplace-sync/orders/${order.id}/label`,
      );
      const ada = r.hasil.filter((h) => h.docUrl);
      if (!ada.length) {
        const e = r.hasil.find((h) => h.error)?.error;
        toast(e ? `Label belum tersedia: ${e}` : "Label belum tersedia — order mungkin belum di-RTS.", "warning");
        return;
      }
      ada.forEach((h) => window.open(h.docUrl!, "_blank", "noopener"));
      const resi = ada[0]?.trackingNumber;
      toast(`Label AWB dibuka (${ada.length} paket)${resi ? ` · resi ${resi}` : ""}`, "success");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function kirimMarketplace() {
    if (
      !window.confirm(
        `Kirim order ${order.marketplaceOrderId} ke marketplace (RTS)?\n\n` +
          `Ini mengatur pengiriman di seller center: status jadi "menunggu kurir", AWB dibuat, dan bisa memicu ` +
          `penjemputan kurir. Tindakan nyata dan sulit dibatalkan. Lanjutkan?`,
      )
    )
      return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ ok: boolean; hasil: { ok: boolean; error?: string }[] }>(
        `/marketplace-sync/orders/${order.id}/ship`, {},
      );
      if (r.ok) {
        toast("Diproses ke marketplace (RTS). Status → Menunggu Dicetak.", "success");
        onChanged({ ...order, fulfillmentStatus: "approved" });
      } else {
        const e = r.hasil.find((h) => !h.ok)?.error;
        toast(`Gagal RTS: ${e ?? "tidak diketahui"}`, "danger");
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function setStatus(status: string) {
    // Irreversible-feeling transitions get an explicit confirmation.
    if (status === "dibatalkan" || status === "retur") {
      setConfirmStatus(status);
      return;
    }
    void apply(status);
  }

  const rowsMeta: [string, React.ReactNode][] = [
    ["Platform", MP_LABEL[order.marketplace] ?? order.marketplace],
    ["Toko", order.shopName ?? "-"],
    ["Status marketplace", order.status ?? "-"],
    ["Pembeli", order.buyerName ?? "-"],
    ["Total", <span className="tabular-nums">{rupiah(order.totalAmount)}</span>],
    [
      "Est. pencairan (net)",
      order.estPencairan != null ? (
        <span className="tabular-nums text-emerald-700">≈ {rupiah(order.estPencairan)}</span>
      ) : (
        "-"
      ),
    ],
    [
      "Fee platform",
      order.feeDeducted ? <span className="tabular-nums">{rupiah(order.platformFee)}</span> : "pending",
    ],
    ["Waktu", dateShort(order.createdAt)],
  ];

  return (
    <>
      <Modal open onClose={onClose} title="Detail Order" width="max-w-lg">
        <div className="flex items-center justify-between gap-2 mb-4">
          <span className="font-mono text-xs text-ink-2">{order.marketplaceOrderId}</span>
          <Badge tone={FS_TONE[order.fulfillmentStatus] ?? "neutral"}>
            {FS_LABEL[order.fulfillmentStatus] ?? order.fulfillmentStatus}
          </Badge>
        </div>

        {err && (
          <div className="mb-4">
            <InlineAlert tone="danger">{err}</InlineAlert>
          </div>
        )}

        <dl className="text-sm divide-y divide-line border-y border-line mb-4">
          {rowsMeta.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2.5">
              <dt className="text-ink-2">{k}</dt>
              <dd className="text-ink font-medium text-right">{v}</dd>
            </div>
          ))}
        </dl>

        {order.marketplace === "tiktok" && (
          <div className="rounded-lg border border-line mb-4">
            <div className="px-3.5 py-2.5 border-b border-line flex items-center justify-between">
              <span className="text-xs font-medium text-ink-2">Rincian TikTok (price detail &amp; tracking)</span>
              <Button size="sm" variant="outline" icon="refresh" loading={ttBusy} onClick={refreshTiktok}>
                Refresh
              </Button>
            </div>
            <div className="p-3.5 text-xs space-y-2">
              {(() => {
                const pd = (tt?.priceDetail ?? order.priceDetail) as Record<string, unknown> | null | undefined;
                if (!pd) {
                  return <div className="text-ink-3">{ttBusy ? "Mengambil dari TikTok…" : "Belum ada rincian harga — klik Refresh."}</div>;
                }
                const R = (k: string) => (pd[k] != null ? rupiah(String(pd[k])) : "-");
                const rows: [string, string][] = [
                  ["Harga publish (SKU)", "sku_list_price"],
                  ["Setelah diskon (SKU)", "sku_sale_price"],
                  ["Diskon seller", "subtotal_deduction_seller"],
                  ["Diskon platform", "subtotal_deduction_platform"],
                  ["Pajak", "tax_amount"],
                  ["Ongkir (harga jual)", "shipping_sale_price"],
                  ["Total bayar pembeli", "payment"],
                ];
                return (
                  <dl className="divide-y divide-line">
                    {rows.map(([label, key]) => (
                      <div key={key} className="flex justify-between py-1">
                        <dt className="text-ink-3">{label}</dt>
                        <dd className="tabular-nums text-ink">{R(key)}</dd>
                      </div>
                    ))}
                  </dl>
                );
              })()}
              {(() => {
                const tr = (tt?.tracking ?? order.trackingLast) as Array<Record<string, unknown>> | null | undefined;
                if (!tr || !tr.length) return null;
                return (
                  <div className="pt-1">
                    <div className="text-ink-2 font-medium mb-1">Tracking</div>
                    <ul className="space-y-0.5">
                      {tr.slice(0, 8).map((ev, i) => (
                        <li key={i} className="flex justify-between gap-2 text-ink-3">
                          <span>{String(ev.description ?? "-")}</span>
                          <span className="shrink-0 tabular-nums">
                            {ev.update_time_millis
                              ? new Date(Number(ev.update_time_millis)).toLocaleString("id-ID", {
                                  day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                                })
                              : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })()}
              <p className="text-[11px] text-ink-3">
                Est. pencairan (net) = harga setelah diskon − estimasi komisi (atur % di Otomasi Order). Komisi asli
                TikTok tidak tersedia di API order, jadi angka ini estimasi.
              </p>
            </div>
          </div>
        )}

        {order.items && order.items.length > 0 && (
          <div className="rounded-lg border border-line mb-4">
            <div className="px-3.5 py-2.5 border-b border-line text-xs font-medium text-ink-2">
              Produk ({MP_LABEL[order.marketplace] ?? order.marketplace})
            </div>
            <div className="divide-y divide-line">
              {order.items.map((it, i) => {
                const mpNama = it.name ?? it.product_name ?? it.skuName ?? it.sellerSku ?? it.seller_sku ?? "-";
                const nm = it.masterName ?? mpNama;
                const qty = it.qty ?? it.quantity ?? 1;
                const sku = it.skuId ?? it.item_id;
                return (
                  <div key={sku ?? i} className="px-3.5 py-2.5 flex items-center gap-3">
                    {it.skuImage ? (
                      <img
                        src={it.skuImage}
                        alt={nm}
                        loading="lazy"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                        className="w-12 h-12 shrink-0 rounded-lg object-cover bg-canvas ring-1 ring-line"
                      />
                    ) : (
                      <div className="w-12 h-12 shrink-0 grid place-items-center rounded-lg bg-canvas text-ink-3 ring-1 ring-line">
                        <Icon name="cart" size={20} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between gap-2">
                        <span className="text-sm text-ink">{nm}</span>
                        <span className="text-sm text-ink-2 whitespace-nowrap tabular-nums">×{qty}</span>
                      </div>
                      {it.skuName && it.skuName !== nm && (
                        <div className="text-xs text-ink-3 mt-0.5 truncate">{it.skuName}</div>
                      )}
                      {sku && (
                        <div className="text-xs font-mono text-ink-3 mt-0.5">SKU: {sku}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="rounded-lg border border-line p-3.5">
          <div className="text-xs font-medium text-ink-2 mb-2.5">Status proses</div>

          {(order.fulfillmentStatus === "masuk" || next) && (
            <div className="flex flex-wrap gap-2 mb-3">
              {order.fulfillmentStatus === "masuk" && (
                <>
                  <Button
                    size="sm"
                    variant="filled"
                    icon="check"
                    onClick={kirimMarketplace}
                    loading={busy}
                    title="Proses ke marketplace (RTS): AWAITING_SHIPMENT → AWAITING_COLLECTION"
                  >
                    Proses
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    icon="xCircle"
                    onClick={() => setStatus("dibatalkan")}
                    disabled={busy}
                  >
                    Tolak
                  </Button>
                </>
              )}
              {next && order.fulfillmentStatus !== "masuk" && (
                <Button
                  size="sm"
                  variant="filled"
                  iconRight="arrowRight"
                  onClick={() => setStatus(next)}
                  loading={busy}
                >
                  Lanjut ke {FS_LABEL[next]}
                </Button>
              )}
              {["masuk", "approved", "produksi"].includes(order.fulfillmentStatus) && (
                <Button
                  size="sm"
                  variant="tonal"
                  icon="package"
                  onClick={() => setStatus("packing")}
                  loading={busy}
                  title="Tandai resi sudah dicetak & mulai kemas"
                >
                  Mulai Packing
                </Button>
              )}
            </div>
          )}

          <label className="block text-xs text-ink-2 mb-1.5">Ubah manual ke status apa pun</label>
          <Select
            value={order.fulfillmentStatus}
            disabled={busy}
            onChange={(e) => setStatus(e.target.value)}
          >
            {ALL_FS.map((s) => <option key={s} value={s}>{FS_LABEL[s]}</option>)}
          </Select>
        </div>

        <div className="mt-3 rounded-lg border border-line p-3.5">
          <div className="text-xs font-medium text-ink-2 mb-2">Kirim ke marketplace <span className="text-emerald-600">· TikTok Shop tersambung</span></div>
          <div className="flex flex-wrap gap-2">
            {order.fulfillmentStatus !== "masuk" && (
              order.awbUrl ? (
                <Button size="sm" variant="outline" icon="package" onClick={() => window.open(order.awbUrl!, "_blank", "noopener")}>
                  Cetak / Unduh Resi
                </Button>
              ) : (
                <Button size="sm" variant="outline" icon="download" loading={busy} onClick={cetakAwb}>
                  Ambil Resi dari TikTok
                </Button>
              )
            )}
            <Button size="sm" variant="filled" icon="check" loading={busy} onClick={kirimMarketplace}>
              Proses (RTS ke marketplace)
            </Button>
            {order.marketplace === "tiktok" && (
              <Button size="sm" variant="tonal" icon="users" loading={busy} onClick={chatBuyer} title="Buka / mulai chat dengan pembeli order ini">
                Chat pembeli
              </Button>
            )}
          </div>
          <p className="text-[11px] text-ink-3 mt-2">
            <b>Cetak AWB</b> membuka label PDF dari marketplace (read-only, tak mengubah apa pun).
            <b> Kirim ke marketplace</b> melakukan RTS — status di seller center jadi “menunggu kurir” &amp; AWB dibuat;
            tindakan nyata, ada konfirmasi dulu.
          </p>
        </div>
      </Modal>

      <ConfirmModal
        open={confirmStatus != null}
        onClose={() => setConfirmStatus(null)}
        onConfirm={() => confirmStatus && apply(confirmStatus)}
        title="Ubah status order"
        description={
          <>
            Ubah status order <span className="font-mono">{order.marketplaceOrderId}</span> ke{" "}
            <b>{confirmStatus ? FS_LABEL[confirmStatus] : ""}</b>?
          </>
        }
        confirmLabel="Ubah status"
        loading={busy}
      />
    </>
  );
}
