import { useCallback } from "react";
import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { PendingTasksAlert } from "../components/PendingTasks";
import { ShopHealth } from "../components/ShopHealth";
import { useRealtime } from "../lib/realtime";
import { rupiah, dateShort } from "../lib/fmt";
import { Icon, type IconName } from "../components/Icon";
import {
  PageHeader,
  Card,
  CardHeader,
  StatTile,
  Button,
  Table,
  TableWrap,
  THead,
  TR,
  TH,
  TD,
  SkeletonRows,
  EmptyState,
  Badge,
} from "../components/ui";

interface Order {
  id: string;
  marketplace: string;
  marketplaceOrderId: string;
  status: string | null;
  buyerName: string | null;
  totalAmount: string | null;
  createdAt: string;
}

/** 7-day order-count bars computed client-side from the recent orders list. */
function TrendChart({ orders, loading }: { orders: Order[]; loading: boolean }) {
  const days: { label: string; count: number }[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const count = orders.filter((o) => o.createdAt?.slice(0, 10) === key).length;
    days.push({ label: d.toLocaleDateString("id-ID", { weekday: "short" }), count });
  }
  const max = Math.max(1, ...days.map((d) => d.count));

  if (loading) {
    return (
      <div className="flex items-end gap-3 h-40" aria-hidden="true">
        {days.map((_, i) => (
          <div key={i} className="flex-1 flex flex-col justify-end gap-2">
            <div
              className="w-full rounded-t-md bg-slate-200/70 animate-pulse"
              style={{ height: `${28 + ((i * 17) % 60)}px` }}
            />
            <div className="h-3.5 rounded bg-slate-200/70 animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-end gap-3 h-40">
      {days.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1.5 min-w-0">
          <div className="text-xs text-ink-2 tabular-nums">{d.count}</div>
          <div
            className={`w-full rounded-t-md transition-all ${
              d.count === 0 ? "bg-line" : "bg-brand/70"
            }`}
            style={{ height: `${(d.count / max) * 96 + 3}px` }}
            title={`${d.label}: ${d.count} order`}
          />
          <div className="text-xs text-ink-3 truncate w-full text-center">{d.label}</div>
        </div>
      ))}
    </div>
  );
}

interface Summary {
  today_orders: number;
  today_revenue: string;
  active_shops: number;
  total_orders: number;
  total_revenue: string;
}

interface DashAlerts {
  low_stock: { id: string; name: string; current: number; min: number; unit: string | null }[];
  low_wallet: { balance: number; threshold: number } | null;
  expiring_tokens: { shop_id: string; shop_name: string | null; expires_at: string }[];
}

function AlertCards({ a }: { a: DashAlerts | null }) {
  if (!a) return null;
  const cards: { key: string; icon: IconName; text: string; to: string }[] = [];
  if (a.low_stock.length)
    cards.push({
      key: "stock",
      icon: "beaker",
      to: "/bom",
      text: `${a.low_stock.length} bahan baku stok menipis: ${a.low_stock.slice(0, 3).map((s) => s.name).join(", ")}`,
    });
  if (a.low_wallet)
    cards.push({
      key: "wallet",
      icon: "creditCard",
      to: "/wallet",
      text: `Saldo wallet rendah: ${rupiah(a.low_wallet.balance)} (min ${rupiah(a.low_wallet.threshold)})`,
    });
  if (a.expiring_tokens.length)
    cards.push({
      key: "token",
      icon: "lock",
      to: "/toko",
      text: `${a.expiring_tokens.length} token toko akan kedaluwarsa: ${a.expiring_tokens.map((t) => t.shop_name ?? t.shop_id).join(", ")}`,
    });
  if (!cards.length) return null;
  return (
    <div className="space-y-2 mb-5">
      {cards.map((c) => (
        <Link
          key={c.key}
          to={c.to}
          className="flex items-center gap-2.5 rounded-lg bg-amber-50 border border-amber-100 text-amber-800 text-sm px-4 py-2.5 transition hover:bg-amber-100/70"
        >
          <Icon name={c.icon} size={16} className="shrink-0" />
          <span className="min-w-0">{c.text}</span>
          <Icon name="chevronRight" size={16} className="ml-auto shrink-0 opacity-70" />
        </Link>
      ))}
    </div>
  );
}

const QUICK: { to: string; label: string; icon: IconName }[] = [
  { to: "/toko", label: "Hubungkan Toko", icon: "store" },
  { to: "/produk", label: "Master Produk", icon: "package" },
  { to: "/wallet", label: "Top-up Saldo", icon: "wallet" },
];

export function Dashboard() {
  const wallet = useFetch<{ balance: string }>("/wallet");
  const summary = useFetch<Summary>("/dashboard/summary");
  const products = useFetch<unknown[]>("/products");
  const orders = useFetch<Order[]>("/orders");
  const alerts = useFetch<DashAlerts>("/dashboard/alerts");

  useRealtime(
    useCallback(() => {
      summary.reload();
      orders.reload();
      alerts.reload();
    }, [summary, orders, alerts]),
  );

  const recent = (orders.data ?? []).slice(0, 5);

  return (
    <Layout title="Dashboard">
      {/* First thing on the page, and absent entirely when there is nothing
          wrong. An alert that is always there stops being an alert. */}
      <PendingTasksAlert />
      <PageHeader
        title="Dashboard"
        subtitle="Ringkasan performa toko dan order terbaru."
        actions={
          <Button
            variant="outline"
            icon="refresh"
            loading={summary.loading && orders.loading}
            onClick={() => {
              summary.reload();
              orders.reload();
              alerts.reload();
              wallet.reload();
              products.reload();
            }}
          >
            Segarkan
          </Button>
        }
      />

      {/* The question this page is opened for. Above the summary tiles,
          which answer a narrower one. */}
      <div className="mb-6">
        <ShopHealth />
      </div>

      <AlertCards a={alerts.data} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile
          icon="cart"
          label="Order Hari Ini"
          loading={summary.loading}
          value={String(summary.data?.today_orders ?? 0)}
          sub={`total ${summary.data?.total_orders ?? 0} sepanjang waktu`}
        />
        <StatTile
          icon="trending"
          label="Revenue Hari Ini"
          loading={summary.loading}
          value={rupiah(summary.data?.today_revenue)}
          sub={`total ${rupiah(summary.data?.total_revenue)}`}
        />
        <StatTile
          icon="store"
          label="Toko Aktif"
          loading={summary.loading}
          value={String(summary.data?.active_shops ?? 0)}
          sub={`${products.data?.length ?? 0} master produk`}
        />
        <StatTile
          icon="wallet"
          label="Saldo Wallet"
          loading={wallet.loading}
          value={rupiah(wallet.data?.balance)}
          sub="AutoToko balance"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <Card className="lg:col-span-2" padded={false}>
          <CardHeader title="Tren Order (7 hari)" subtitle="Jumlah order per hari" />
          <div className="p-5">
            <TrendChart orders={orders.data ?? []} loading={orders.loading} />
          </div>
        </Card>

        <Card padded={false}>
          <CardHeader title="Aksi Cepat" />
          <div className="p-3 flex flex-col">
            {QUICK.map((q) => (
              <Link
                key={q.to}
                to={q.to}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-ink transition hover:bg-canvas"
              >
                <span className="w-8 h-8 rounded-full bg-brand/12 text-brand-ink flex items-center justify-center shrink-0">
                  <Icon name={q.icon} size={17} />
                </span>
                <span className="truncate">{q.label}</span>
                <Icon name="chevronRight" size={16} className="ml-auto text-ink-3" />
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-4 overflow-hidden" padded={false}>
        <CardHeader
          title="Order Terbaru"
          action={
            <Link
              to="/orders"
              className="inline-flex items-center gap-1 text-sm font-medium text-brand-ink hover:underline"
            >
              Lihat semua
              <Icon name="arrowRight" size={15} />
            </Link>
          }
        />
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>Order</TH>
                <TH>Marketplace</TH>
                <TH>Pembeli</TH>
                <TH align="right">Total</TH>
                <TH align="right">Waktu</TH>
              </tr>
            </THead>
            <tbody>
              {orders.loading ? (
                <SkeletonRows n={5} cols={5} />
              ) : !recent.length ? (
                <tr>
                  <td colSpan={5}>
                    <EmptyState
                      icon="inbox"
                      title="Belum ada order"
                      description="Order masuk otomatis via webhook marketplace setelah toko terhubung."
                      action={
                        <Link to="/toko">
                          <Button variant="tonal" icon="store">
                            Hubungkan Toko
                          </Button>
                        </Link>
                      }
                    />
                  </td>
                </tr>
              ) : (
                recent.map((o) => (
                  <TR key={o.id}>
                    <TD className="font-mono text-xs">{o.marketplaceOrderId}</TD>
                    <TD>
                      <Badge tone="neutral">
                        <span className="capitalize">{o.marketplace}</span>
                      </Badge>
                    </TD>
                    <TD className="text-ink">{o.buyerName ?? "-"}</TD>
                    <TD align="right" className="font-medium tabular-nums whitespace-nowrap">
                      {rupiah(o.totalAmount)}
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
    </Layout>
  );
}
