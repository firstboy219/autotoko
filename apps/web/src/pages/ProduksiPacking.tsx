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

interface LabelItem {
  name: string;
  qty: number;
}
interface Scan {
  id: string;
  resi: string;
  courier: string | null;
  source: string;
  deviceLabel: string | null;
  scannedAt: string;
  photoUrl: string | null;
  ocrStatus: string;
  labelOrderNo: string | null;
  labelRecipient: string | null;
  labelMarketplace: string | null;
  labelItems: LabelItem[] | null;
  packerPaidAt: string | null;
  packerPaidAmount: string | null;
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
  ocrPending: number;
  ocrFailed: number;
  lastScanAt: string | null;
}
interface DailyRow {
  day: string;
  total: number;
  paid: number;
  unpaid: number;
  paidAmount: number;
  dueAmount: number;
}
interface DailyRecap {
  feePerResi: number;
  days: DailyRow[];
  totals: {
    resi: number;
    paid: number;
    unpaid: number;
    paidAmount: number;
    dueAmount: number;
  };
}
interface AppDownload {
  url: string;
  fileName: string;
  sizeBytes: number;
  updatedAt: string;
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
 * Everything the scanner app has recorded: the waybill from the barcode, the
 * photographed label, and whatever the background reader has since made of it.
 *
 * Fields read off the label are shown exactly as confidently as they deserve.
 * A blank recipient means OCR found no anchor for one, not that the parcel had
 * no recipient; that gap is meant to be visible, because a wrong name filled
 * in by a guess would look identical to a right one and nobody would ever
 * check it.
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
  const app = useFetch<AppDownload | null>("/resi/app-download");
  const recap = useFetch<DailyRecap>("/resi/daily?limit=60");

  const [linking, setLinking] = useState<Scan | null>(null);
  const [photo, setPhoto] = useState<Scan | null>(null);

  function refresh() {
    scans.reload();
    summary.reload();
    recap.reload();
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
  const pending = summary.data?.ocrPending ?? 0;

  return (
    <Layout title="Produksi & Packing">
      <PageHeader
        title="Produksi & Packing"
        subtitle="Resi yang discan dari aplikasi Android, isi labelnya, dan order yang jadi terkirim karenanya."
        actions={
          <Button variant="outline" onClick={refresh}>
            <Icon name="refresh" className="w-3.5 h-3.5" />
            Muat Ulang
          </Button>
        }
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

      {pending > 0 && (
        <div className="mb-3">
          <InlineAlert tone="info">
            {pending} label sedang dibaca di server. Nomor pesanan, penerima dan isi paket akan
            muncul sendiri dalam beberapa saat. Nomor resinya sudah tersimpan sejak awal karena
            diambil dari barcode, bukan dari pembacaan foto.
          </InlineAlert>
        </div>
      )}

      {unlinked > 0 && (
        <div className="mb-5">
          <InlineAlert tone="info">
            {unlinked} resi belum terhubung ke order, jadi belum terhitung sebagai Dikirim di
            Laporan. Kalau nomor pesanan terbaca dari label, penghubungan terjadi otomatis;
            sisanya bisa dihubungkan lewat tombol di tabel.
          </InlineAlert>
        </div>
      )}

      {recap.data && <DailyRecapCard recap={recap.data} onChange={refresh} />}

      {app.data && <AppCard app={app.data} />}

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
                <TH>Foto</TH>
                <TH>Resi</TH>
                <TH>Waktu</TH>
                <TH>Isi Label (hasil OCR)</TH>
                <TH>Order</TH>
                <TH className="text-right">Aksi</TH>
              </TR>
            </THead>
            <tbody>
              {scans.loading ? (
                <SkeletonRows n={5} cols={6} />
              ) : rows.length === 0 ? (
                <TR>
                  <TD colSpan={6}>
                    <EmptyState
                      icon="package"
                      title="Belum ada resi yang discan"
                      description="Scan barcode resi lewat aplikasi AutoToko Scan Resi di HP, hasilnya muncul di sini."
                    />
                  </TD>
                </TR>
              ) : (
                rows.map((s) => (
                  <TR key={s.id}>
                    <TD>
                      {s.photoUrl ? (
                        <button
                          onClick={() => setPhoto(s)}
                          className="block w-12 h-12 rounded-lg overflow-hidden border border-line hover:border-brand"
                          title="Lihat foto label"
                        >
                          <img
                            src={s.photoUrl}
                            alt={`Label ${s.resi}`}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ) : (
                        <span className="text-ink-2 text-xs">-</span>
                      )}
                    </TD>

                    <TD>
                      <div className="font-mono text-[13px]">{s.resi}</div>
                      <div className="text-[11px] text-ink-2">
                        {s.courier ?? "-"}
                        {s.source === "manual" ? " / manual" : ""}
                      </div>
                      {s.packerPaidAt && (
                        <Badge tone="success">
                          upah dibayar
                          {s.packerPaidAmount ? ` ${rupiah(Number(s.packerPaidAmount))}` : ""}
                        </Badge>
                      )}
                    </TD>

                    <TD className="whitespace-nowrap">
                      <div className="text-[12px]">{dateShort(s.scannedAt)}</div>
                      <div className="text-[11px] text-ink-2">{s.deviceLabel ?? "-"}</div>
                    </TD>

                    <TD>
                      <LabelCell scan={s} />
                    </TD>

                    <TD>
                      {s.orderId ? (
                        <div>
                          <div className="font-mono text-[12px]">{s.marketplaceOrderId}</div>
                          <div className="text-[11px] text-ink-2">
                            {s.buyerName ?? "-"}
                            {s.shopName ? ` / ${s.shopName}` : ""}
                            {s.totalAmount ? ` / ${rupiah(Number(s.totalAmount))}` : ""}
                          </div>
                          {s.orderStatus && (
                            <Badge tone={s.orderStatus === "dikirim" ? "info" : "neutral"}>
                              {FS_LABEL[s.orderStatus] ?? s.orderStatus}
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <span className="text-ink-2 text-xs">belum terhubung</span>
                      )}
                    </TD>

                    <TD className="text-right">
                      {s.orderId ? (
                        <Button variant="text" onClick={() => unlink(s)}>
                          Lepas
                        </Button>
                      ) : (
                        <Button variant="outline" onClick={() => setLinking(s)}>
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

      {photo && (
        <Modal open title={`Label ${photo.resi}`} onClose={() => setPhoto(null)} width="max-w-3xl">
          {photo.photoUrl && (
            <img
              src={photo.photoUrl}
              alt={`Label ${photo.resi}`}
              className="w-full rounded-lg border border-line"
            />
          )}
          <div className="mt-3 text-xs text-ink-2">
            Discan {dateShort(photo.scannedAt)} dari {photo.deviceLabel ?? "perangkat tak dikenal"}.
          </div>
        </Modal>
      )}
    </Layout>
  );
}

/**
 * Parcels handed to the courier per day, and the packing wage that follows.
 *
 * "Sudah dibayar" is recorded on each parcel together with the rate actually
 * paid, so raising the rate later changes what is still owed without quietly
 * restating payslips already settled. Amount still due uses today's rate;
 * amount already paid is summed from what was recorded at the time.
 */
function DailyRecapCard({ recap, onChange }: { recap: DailyRecap; onChange: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function settle(day: string, paying: boolean) {
    setBusy(day);
    try {
      const r = await api.post<{ paidCount?: number; amount?: number; revertedCount?: number }>(
        paying ? "/resi/pay-packer" : "/resi/unpay-packer",
        { day },
      );
      toast(
        paying
          ? `${r.paidCount ?? 0} resi ditandai terbayar (${rupiah(r.amount ?? 0)}).`
          : `${r.revertedCount ?? 0} resi dikembalikan ke belum terbayar.`,
        "success",
      );
      onChange();
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setBusy(null);
    }
  }

  const noRate = recap.feePerResi <= 0;

  return (
    <Card padded={false} className="mb-5">
      <CardHeader
        title="Rekap Harian & Upah Packing"
        subtitle={
          noRate
            ? "Upah per resi belum diatur."
            : `${rupiah(recap.feePerResi)} per resi. Belum dibayar: ${rupiah(
                recap.totals.dueAmount,
              )} (${recap.totals.unpaid} resi).`
        }
        action={
          <a href="/akun" className="text-xs text-brand-ink hover:underline">
            Atur upah per resi
          </a>
        }
      />

      {noRate && (
        <div className="px-4 pt-4">
          <InlineAlert tone="warning">
            Isi dulu upah per resi di halaman Akun sebelum menandai pembayaran, supaya nominal
            yang tercatat pada tiap resi benar.
          </InlineAlert>
        </div>
      )}

      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>Tanggal</TH>
              <TH className="text-right">Resi Dikirim</TH>
              <TH className="text-right">Sudah Dibayar</TH>
              <TH className="text-right">Belum</TH>
              <TH className="text-right">Nominal Belum Dibayar</TH>
              <TH className="text-right">Sudah Terbayar</TH>
              <TH className="text-right">Aksi</TH>
            </TR>
          </THead>
          <tbody>
            {recap.days.length === 0 ? (
              <TR>
                <TD colSpan={7}>
                  <EmptyState
                    icon="package"
                    title="Belum ada resi yang discan"
                    description="Rekap harian muncul setelah ada resi yang discan dari aplikasi."
                  />
                </TD>
              </TR>
            ) : (
              recap.days.map((d) => (
                <TR key={d.day}>
                  <TD className="whitespace-nowrap">{d.day}</TD>
                  <TD className="text-right">{d.total}</TD>
                  <TD className="text-right">{d.paid}</TD>
                  <TD className="text-right">
                    {d.unpaid > 0 ? (
                      <Badge tone="warning">{d.unpaid}</Badge>
                    ) : (
                      <span className="text-ink-2">0</span>
                    )}
                  </TD>
                  <TD className="text-right">{d.dueAmount > 0 ? rupiah(d.dueAmount) : "-"}</TD>
                  <TD className="text-right text-ink-2">
                    {d.paidAmount > 0 ? rupiah(d.paidAmount) : "-"}
                  </TD>
                  <TD className="text-right whitespace-nowrap">
                    {d.unpaid > 0 && (
                      <Button
                        variant="outline"
                        disabled={busy !== null || noRate}
                        onClick={() => settle(d.day, true)}
                      >
                        Tandai Terbayar
                      </Button>
                    )}
                    {d.paid > 0 && (
                      <Button
                        variant="text"
                        disabled={busy !== null}
                        onClick={() => settle(d.day, false)}
                      >
                        Batalkan
                      </Button>
                    )}
                  </TD>
                </TR>
              ))
            )}
          </tbody>
        </Table>
      </TableWrap>

      {recap.days.length > 0 && (
        <div className="px-5 py-3 border-t border-line text-xs text-ink-2">
          Total {recap.totals.resi} resi &middot; sudah dibayar {recap.totals.paid} (
          {rupiah(recap.totals.paidAmount)}) &middot; belum {recap.totals.unpaid} (
          {rupiah(recap.totals.dueAmount)})
        </div>
      )}
    </Card>
  );
}

/**
 * The install link for the scanner app.
 *
 * The full URL is spelled out and selectable, not hidden behind the button:
 * the person reading this page is usually at a desktop, while the app has to
 * end up on a warehouse phone, so being able to read the address across and
 * type it in matters more than a tidy button.
 */
function AppCard({ app }: { app: AppDownload }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const mb = (app.sizeBytes / (1024 * 1024)).toFixed(1);

  return (
    <Card className="mb-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink mb-1">Aplikasi Scan Resi (Android)</div>
          <p className="text-xs text-ink-2 mb-2 max-w-xl">
            Pasang di HP gudang untuk memindai barcode resi. Buka alamat berikut lewat browser di
            HP, lalu izinkan pemasangan dari sumber ini saat diminta.
          </p>
          <code className="block text-[11px] bg-canvas border border-line rounded-lg px-2.5 py-2 break-all select-all">
            {origin}
            {app.url}
          </code>
          <div className="text-[11px] text-ink-2 mt-1.5">
            {mb} MB &middot; diperbarui {dateShort(app.updatedAt)} &middot; Android 5.0 ke atas
          </div>
        </div>
        <a href={app.url} download>
          <Button variant="outline">
            <Icon name="download" className="w-3.5 h-3.5" />
            Unduh APK
          </Button>
        </a>
      </div>
    </Card>
  );
}

/** What the background reader found, stated only as far as it is known. */
function LabelCell({ scan }: { scan: Scan }) {
  if (scan.ocrStatus === "pending") {
    return <span className="text-[11px] text-ink-2">sedang dibaca...</span>;
  }
  if (scan.ocrStatus === "none") {
    return <span className="text-[11px] text-ink-2">tanpa foto</span>;
  }
  if (scan.ocrStatus === "failed") {
    return (
      <span className="text-[11px] text-ink-2" title="Foto tidak terbaca setelah 3 percobaan">
        label tidak terbaca
      </span>
    );
  }

  const items = scan.labelItems ?? [];
  const nothing = !scan.labelOrderNo && !scan.labelRecipient && items.length === 0;
  if (nothing) {
    return <span className="text-[11px] text-ink-2">terbaca, tidak ada data dikenali</span>;
  }

  return (
    <div className="text-[11px] leading-relaxed">
      {scan.labelOrderNo && (
        <div>
          <span className="text-ink-2">Pesanan </span>
          <span className="font-mono">{scan.labelOrderNo}</span>
        </div>
      )}
      {scan.labelRecipient && (
        <div>
          <span className="text-ink-2">Penerima </span>
          {scan.labelRecipient}
        </div>
      )}
      {scan.labelMarketplace && <Badge tone="neutral">{scan.labelMarketplace}</Badge>}
      {items.length > 0 && (
        <ul className="mt-1">
          {items.map((it, i) => (
            <li key={i}>
              {it.qty}x {it.name}
            </li>
          ))}
        </ul>
      )}
    </div>
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
  // Prefer the order number the label gave us; it is the strongest hint there
  // is about which order this parcel belongs to.
  const [q, setQ] = useState(scan.labelOrderNo ?? "");
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
        nomor resinya tersimpan.
      </p>

      {scan.labelRecipient && (
        <div className="mb-3 text-xs text-ink-2">
          Dari label: penerima <strong>{scan.labelRecipient}</strong>
          {scan.labelOrderNo ? (
            <>
              {" "}
              / pesanan <span className="font-mono">{scan.labelOrderNo}</span>
            </>
          ) : null}
        </div>
      )}

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
          title="Tidak ada order yang cocok"
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
