import { useCallback, useMemo, useState, type MouseEvent } from "react";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { useRealtime } from "../lib/realtime";
import { api } from "../lib/api";
import { rupiah, dateShort } from "../lib/fmt";
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
}

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

// Internal fulfillment workflow (ordered) + side states.
const FLOW = ["masuk", "approved", "produksi", "packing", "siap_kirim", "dikirim", "selesai"] as const;
const SIDE = ["retur", "dibatalkan"] as const;
const ALL_FS = [...FLOW, ...SIDE];
const FS_LABEL: Record<string, string> = {
  masuk: "Masuk", approved: "Disetujui", produksi: "Produksi", packing: "Packing",
  siap_kirim: "Siap Kirim", dikirim: "Dikirim", selesai: "Selesai",
  retur: "Retur", dibatalkan: "Dibatalkan",
};
const FS_TONE: Record<string, Tone> = {
  masuk: "neutral", approved: "info", produksi: "brand", packing: "brand",
  siap_kirim: "warning", dikirim: "info", selesai: "success",
  retur: "warning", dibatalkan: "danger",
};

const PAGE_SIZE = 15;

type ViewMode = "tabel" | "kanban";

const VIEWS: { mode: ViewMode; label: string; icon: IconName }[] = [
  { mode: "tabel", label: "Tabel", icon: "fileText" },
  { mode: "kanban", label: "Kanban", icon: "dashboard" },
];

export function Orders() {
  const { data, loading, reload } = useFetch<Order[]>("/orders");
  const toast = useToast();
  useRealtime(useCallback(() => reload(), [reload]));
  const [view, setView] = useState<ViewMode>("tabel");
  const [q, setQ] = useState("");
  const [mp, setMp] = useState("");
  const [fs, setFs] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Order | null>(null);

  const all = data ?? [];
  const marketplaces = useMemo(() => [...new Set(all.map((o) => o.marketplace))], [all]);

  // Shared search + marketplace filter for both views. The fulfillment-status
  // dropdown only applies to the table view (each Kanban column is a status).
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((o) => {
      if (mp && o.marketplace !== mp) return false;
      if (view === "tabel" && fs && o.fulfillmentStatus !== fs) return false;
      if (needle) {
        const hay = `${o.marketplaceOrderId} ${o.buyerName ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [all, q, mp, fs, view]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const rows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const hasFilters = Boolean(q.trim() || mp || fs);

  // Keep the live modal order in sync with reloaded data so the board reflects moves.
  const liveSelected = selected && (all.find((o) => o.id === selected.id) ?? selected);

  async function moveStatus(order: Order, status: string) {
    try {
      await api.patch<Order>(`/orders/${order.id}/status`, { status });
      toast(`Order dipindah ke ${FS_LABEL[status] ?? status}`, "success");
      reload();
    } catch (e) {
      toast((e as Error).message, "danger");
    }
  }

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
            <Button variant="outline" icon="refresh" loading={loading} onClick={() => reload()}>
              Segarkan
            </Button>
          </>
        }
      />

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
        <Card padded={false} className="overflow-hidden">
          <TableWrap>
            <Table className="min-w-[860px]">
              <THead>
                <tr>
                  <TH>Order</TH>
                  <TH>Marketplace</TH>
                  <TH>Status Proses</TH>
                  <TH>Pembeli</TH>
                  <TH align="right">Total</TH>
                  <TH align="right">Fee</TH>
                  <TH align="right">Waktu</TH>
                </tr>
              </THead>
              <tbody>
                {loading ? (
                  <SkeletonRows n={8} cols={7} />
                ) : !rows.length ? (
                  <tr>
                    <td colSpan={7}>
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
                      onClick={() => setSelected(o)}
                    >
                      <TD className="font-mono text-xs">{o.marketplaceOrderId}</TD>
                      <TD>
                        <Badge tone={MP_TONE[o.marketplace] ?? "neutral"}>
                          {MP_LABEL[o.marketplace] ?? o.marketplace}
                        </Badge>
                      </TD>
                      <TD>
                        <Badge tone={FS_TONE[o.fulfillmentStatus] ?? "neutral"}>
                          {FS_LABEL[o.fulfillmentStatus] ?? o.fulfillmentStatus}
                        </Badge>
                      </TD>
                      <TD>{o.buyerName ?? "-"}</TD>
                      <TD align="right" className="tabular-nums whitespace-nowrap">
                        {rupiah(o.totalAmount)}
                      </TD>
                      <TD align="right" className="tabular-nums whitespace-nowrap">
                        {o.feeDeducted ? (
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
          onChanged={(updated) => { setSelected(updated); reload(); }}
        />
      )}
    </Layout>
  );
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
    ["Status marketplace", order.status ?? "-"],
    ["Pembeli", order.buyerName ?? "-"],
    ["Total", <span className="tabular-nums">{rupiah(order.totalAmount)}</span>],
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

        {order.items && order.items.length > 0 && (
          <div className="rounded-lg border border-line mb-4">
            <div className="px-3.5 py-2.5 border-b border-line text-xs font-medium text-ink-2">
              Produk ({MP_LABEL[order.marketplace] ?? order.marketplace})
            </div>
            <div className="divide-y divide-line">
              {order.items.map((it, i) => (
                <div key={it.item_id ?? i} className="px-3.5 py-2.5">
                  <div className="flex justify-between gap-2">
                    <span className="text-sm text-ink">{it.product_name ?? it.seller_sku ?? "-"}</span>
                    <span className="text-sm text-ink-2 whitespace-nowrap tabular-nums">
                      ×{it.quantity ?? 1}
                    </span>
                  </div>
                  {it.item_id && (
                    <div className="text-xs font-mono text-ink-3 mt-0.5">Product ID: {it.item_id}</div>
                  )}
                </div>
              ))}
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
                    onClick={() => setStatus("approved")}
                    loading={busy}
                  >
                    Setujui
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
