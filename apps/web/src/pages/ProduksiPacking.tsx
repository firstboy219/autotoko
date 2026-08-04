import { useState } from "react";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";
import { rupiah, dateShort } from "../lib/fmt";
import { Icon } from "../components/Icon";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  InlineAlert,
  Input,
  Modal,
  PageHeader,
  Select,
  SkeletonRows,
  StatTile,
  Table,
  TableWrap,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from "../components/ui";

const FS_LABEL: Record<string, string> = {
  masuk: "Masuk", approved: "Disetujui", produksi: "Produksi", packing: "Packing",
  siap_kirim: "Siap Kirim", dikirim: "Dikirim", selesai: "Selesai",
  retur: "Retur", dibatalkan: "Dibatalkan",
};

interface Scan {
  id: string;
  resi: string;
  courier: string | null;
  source: string;
  deviceLabel: string | null;
  scannedAt: string;
  orderId: string | null;
  marketplaceOrderId: string | null;
  buyerName: string | null;
  orderStatus: string | null;
  totalAmount: string | null;
  shopName: string | null;
}
interface Summary {
  today: number;
  total: number;
  linked: number;
  unlinked: number;
  lastScanAt: string | null;
}
interface LinkableOrder {
  id: string;
  marketplaceOrderId: string;
  buyerName: string | null;
  fulfillmentStatus: string;
  totalAmount: string | null;
  marketplace: string;
  shopName: string | null;
  createdAt: string;
}

/**
 * Everything the scanner app has recorded, and the one action that turns a
 * scanned parcel into a shipped order.
 *
 * The link is manual by necessity, not by preference: an order only gains a
 * tracking number once somebody has attached one, so there is nothing to match
 * against until then. Attaching writes the resi onto the order, which is what
 * makes the NEXT scan of that label match by itself. The manual step exists to
 * make itself unnecessary.
 */
export function ProduksiPacking() {
  const toast = useToast();
  const [filter, setFilter] = useState<"" | "no" | "yes">("");
  const [q, setQ] = useState("");

  const query = new URLSearchParams();
  query.set("limit", "100");
  if (filter) query.set("linked", filter);
  if (q.trim()) query.set("q", q.trim());

  const scans = useFetch<{ rows: Scan[]; total: number }>(`/resi/scans?${query}`);
  const summary = useFetch<Summary>("/resi/scans/summary");

  const [linking, setLinking] = useState<Scan | null>(null);

  function refresh() {
    scans.reload();
    summary.reload();
  }

  async function unlink(scan: Scan) {
    try {
      await api.del(`/resi/scans/${scan.id}/link`);
      toast(`${scan.resi} dilepas dari order. Status order dikembalikan.`, "success");
      refresh();
    } catch (e) {
      toast((e as Error).message, "danger");
    }
  }

  const rows = scans.data?.rows ?? [];
  const unlinked = summary.data?.unlinked ?? 0;

  return (
    <Layout title="Produksi & Packing">
      <PageHeader
        title="Produksi & Packing"
        subtitle="Resi yang sudah discan dari aplikasi Android, dan order yang jadi terkirim karenanya."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile label="Discan hari ini" value={String(summary.data?.today ?? 0)} />
        <StatTile label="Total discan" value={String(summary.data?.total ?? 0)} />
        <StatTile label="Jadi order terkirim" value={String(summary.data?.linked ?? 0)} />
        <StatTile
          label="Belum terhubung"
          value={String(unlinked)}
          sub={unlinked > 0 ? "perlu dihubungkan ke order" : "semua sudah terhubung"}
        />
      </div>

      {unlinked > 0 && (
        <div className="mb-5">
          <InlineAlert tone="info">
            {unlinked} resi belum terhubung ke order, jadi belum terhitung sebagai Dikirim di
            Laporan. Hubungkan lewat tombol di tabel. Setelah itu nomor resinya tersimpan di order,
            sehingga label yang sama kalau discan lagi akan cocok otomatis.
          </InlineAlert>
        </div>
      )}

      <Card padded={false}>
        <CardHeader
          title={`Hasil Scan (${scans.data?.total ?? 0})`}
          action={
            <div className="flex gap-2">
              <Input
                placeholder="Cari resi"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="w-40"
              />
              <Select
                value={filter}
                onChange={(e) => setFilter(e.target.value as "" | "no" | "yes")}
              >
                <option value="">Semua</option>
                <option value="no">Belum terhubung</option>
                <option value="yes">Sudah terhubung</option>
              </Select>
            </div>
          }
        />

        {scans.error && (
          <div className="p-4">
            <InlineAlert tone="danger">{scans.error}</InlineAlert>
          </div>
        )}

        <TableWrap>
          <Table>
            <THead>
              <TR>
                <TH>Resi</TH>
                <TH>Kurir</TH>
                <TH>Waktu</TH>
                <TH>Perangkat</TH>
                <TH>Order</TH>
                <TH>Status Order</TH>
                <TH className="text-right">Aksi</TH>
              </TR>
            </THead>
            <tbody>
              {scans.loading ? (
                <SkeletonRows n={5} cols={7} />
              ) : rows.length === 0 ? (
                <TR>
                  <TD colSpan={7}>
                    <EmptyState
                      icon="package"
                      title="Belum ada resi yang discan"
                      description="Scan resi lewat aplikasi AutoToko Scan Resi di HP, hasilnya muncul di sini."
                    />
                  </TD>
                </TR>
              ) : (
                rows.map((s) => (
                  <TR key={s.id}>
                    <TD>
                      <span className="font-mono text-[13px]">{s.resi}</span>
                      {s.source === "manual" && (
                        <span className="ml-2 text-[10px] text-ink-2">manual</span>
                      )}
                    </TD>
                    <TD>{s.courier ?? "-"}</TD>
                    <TD className="whitespace-nowrap">{dateShort(s.scannedAt)}</TD>
                    <TD className="text-ink-2">{s.deviceLabel ?? "-"}</TD>
                    <TD>
                      {s.orderId ? (
                        <div>
                          <div className="font-mono text-[12px]">{s.marketplaceOrderId}</div>
                          <div className="text-[11px] text-ink-2">
                            {s.buyerName ?? "-"}
                            {s.shopName ? ` / ${s.shopName}` : ""}
                            {s.totalAmount ? ` / ${rupiah(Number(s.totalAmount))}` : ""}
                          </div>
                        </div>
                      ) : (
                        <span className="text-ink-2 text-xs">belum terhubung</span>
                      )}
                    </TD>
                    <TD>
                      {s.orderStatus ? (
                        <Badge tone={s.orderStatus === "dikirim" ? "info" : "neutral"}>
                          {FS_LABEL[s.orderStatus] ?? s.orderStatus}
                        </Badge>
                      ) : (
                        "-"
                      )}
                    </TD>
                    <TD className="text-right">
                      {s.orderId ? (
                        <Button variant="text" onClick={() => unlink(s)}>
                          Lepas
                        </Button>
                      ) : (
                        <Button variant="outline" onClick={() => setLinking(s)}>
                          <Icon name="link" className="w-3.5 h-3.5" />
                          Hubungkan
                        </Button>
                      )}
                    </TD>
                  </TR>
                ))
              )}
            </tbody>
          </Table>
        </TableWrap>
      </Card>

      {linking && (
        <LinkModal
          scan={linking}
          onClose={() => setLinking(null)}
          onDone={() => {
            setLinking(null);
            refresh();
          }}
        />
      )}
    </Layout>
  );
}

function LinkModal({
  scan,
  onClose,
  onDone,
}: {
  scan: Scan;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const list = useFetch<LinkableOrder[]>(
    `/resi/linkable-orders${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`,
  );

  async function pick(order: LinkableOrder) {
    setBusy(order.id);
    try {
      await api.post(`/resi/scans/${scan.id}/link`, { orderId: order.id });
      toast(`${scan.resi} terhubung ke ${order.marketplaceOrderId}, ditandai Dikirim.`, "success");
      onDone();
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setBusy(null);
    }
  }

  const orders = list.data ?? [];

  return (
    <Modal open title={`Hubungkan resi ${scan.resi}`} onClose={onClose} width="max-w-2xl">
      <p className="text-sm text-ink-2 mb-3">
        Pilih order yang dikirim dengan resi ini. Order akan ditandai <strong>Dikirim</strong> dan
        nomor resinya tersimpan, sehingga scan berikutnya atas label yang sama cocok otomatis.
      </p>

      <Input
        placeholder="Cari nomor order atau nama pembeli"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="mb-3"
        autoFocus
      />

      {list.loading ? (
        <div className="py-6">
          <SkeletonRows n={4} cols={1} />
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          icon="cart"
          title="Tidak ada order yang bisa dihubungkan"
          description="Order yang sudah punya nomor resi atau sudah dibatalkan tidak ditampilkan di sini."
        />
      ) : (
        <div className="max-h-[50vh] overflow-y-auto">
          {orders.map((o) => (
            <button
              key={o.id}
              onClick={() => pick(o)}
              disabled={busy !== null}
              className="w-full text-left px-3 py-2.5 rounded-lg border border-line mb-2 hover:border-brand hover:bg-canvas transition disabled:opacity-50"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-[13px] truncate">{o.marketplaceOrderId}</div>
                  <div className="text-[11px] text-ink-2 truncate">
                    {o.buyerName ?? "-"}
                    {o.shopName ? ` / ${o.shopName}` : ` / ${o.marketplace}`} /{" "}
                    {dateShort(o.createdAt)}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[13px] font-medium">
                    {o.totalAmount ? rupiah(Number(o.totalAmount)) : "-"}
                  </div>
                  <Badge tone="neutral">
                    {FS_LABEL[o.fulfillmentStatus] ?? o.fulfillmentStatus}
                  </Badge>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
