import { useEffect, useState } from "react";
import { SectionTabs } from "../components/SectionTabs";
import { Layout } from "../components/Layout";
import { api } from "../lib/api";
import {
  Card, Badge, Button, Skeleton, InlineAlert, EmptyState,
  Table, TableWrap, THead, TR, TH, TD, useToast,
} from "../components/ui";

/**
 * Retur & Refund (Fase 1) — MONITORING (web). Menarik daftar retur dari
 * marketplace (Reverse Order API) & menampilkannya. Setujui/tolak (tulis-balik)
 * menyusul sebagai aksi manual + konfirmasi. Sinkron dorman sampai scope aktif.
 */
interface LineItem { product_name?: string; sku_name?: string; product_image?: { url?: string } }
interface Ret {
  id: string;
  returnId: string; orderId: string | null;
  returnType: string | null; returnStatus: string | null;
  role: string | null; reasonText: string | null;
  refundTotal: string | null; currency: string | null;
  lineItems: LineItem[] | null;
  sellerNextAction: string | null; nextActionDeadline: string | null;
  returnUpdateTime: string | null;
}

type Tone = "neutral" | "success" | "warning" | "danger" | "info";
const STATUS: Record<string, { label: string; tone: Tone }> = {
  RETURN_OR_REFUND_REQUEST_PENDING: { label: "Menunggu Ditinjau", tone: "warning" },
  AWAITING_BUYER_RESPONSE: { label: "Menunggu Respons Pembeli", tone: "info" },
  AWAITING_BUYER_SHIP: { label: "Menunggu Pembeli Kirim", tone: "info" },
  BUYER_SHIPPED_ITEM: { label: "Pembeli Sudah Kirim", tone: "info" },
  REFUND_OR_RETURN_REQUEST_REJECT: { label: "Ditolak", tone: "danger" },
  REJECT_RECEIVE_PACKAGE: { label: "Paket Ditolak", tone: "danger" },
  RETURN_OR_REFUND_REQUEST_SUCCESS: { label: "Disetujui", tone: "success" },
  RETURN_OR_REFUND_REQUEST_COMPLETE: { label: "Selesai (Refund)", tone: "success" },
  RETURN_OR_REFUND_REQUEST_CANCEL: { label: "Dibatalkan", tone: "neutral" },
};
const TYPE: Record<string, string> = {
  REFUND: "Refund", RETURN_AND_REFUND: "Retur + Refund", REPLACEMENT: "Penggantian",
};
const rp = (v: string | null, cur: string | null) =>
  v == null ? "-" : (cur === "IDR" || !cur ? "Rp " + Number(v).toLocaleString("id-ID") : `${cur} ${v}`);
const tgl = (s?: string | null) => (s ? new Date(s).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "-");

export function Retur() {
  const toast = useToast();
  const [rows, setRows] = useState<Ret[] | null>(null);
  const [sinkron, setSinkron] = useState(false);

  function muat() { api.get<Ret[]>("/marketplace-sync/returns").then(setRows).catch(() => setRows([])); }
  useEffect(() => { muat(); }, []);

  async function tarik() {
    setSinkron(true);
    try {
      const r = await api.post<{ returns: number; hasil: { shop: string; error?: string }[] }>(
        "/marketplace-sync/returns/sync", {});
      const err = r.hasil?.find((h) => h.error);
      if (err) toast(`Belum tersambung: ${err.error}. Pastikan scope retur aktif.`, "warning");
      else toast(`${r.returns} retur tersinkron.`, "success");
      muat();
    } catch (e) { toast((e as Error).message, "danger"); }
    finally { setSinkron(false); }
  }

  return (
    <Layout title="Retur & Refund">
      <SectionTabs tabs={[{ to: "/orders", label: "Pesanan" }, { to: "/retur", label: "Retur & Refund" }]} />
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-sm text-ink-2 max-w-2xl">
          Daftar permintaan retur/refund dari marketplace. Setujui/tolak akan menyusul sebagai aksi manual
          berkonfirmasi. Sinkron aktif begitu scope Reverse Order diaktifkan.
        </p>
        <Button variant="tonal" loading={sinkron} onClick={tarik}>Sinkron</Button>
      </div>

      {rows === null ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState icon="package" title="Belum ada retur" description="Klik Sinkron untuk menarik dari marketplace (butuh scope Reverse Order aktif)." />
      ) : (
        <TableWrap>
          <Table className="min-w-[860px]">
            <THead><tr>
              <TH>Retur / Order</TH><TH>Produk</TH><TH>Tipe</TH><TH>Status</TH>
              <TH align="right">Refund</TH><TH>Perlu Aksi</TH><TH align="right">Update</TH>
            </tr></THead>
            <tbody>
              {rows.map((r) => {
                const st = STATUS[r.returnStatus ?? ""] ?? { label: r.returnStatus ?? "-", tone: "neutral" as Tone };
                const li = r.lineItems?.[0];
                const img = li?.product_image?.url;
                return (
                  <TR key={r.id}>
                    <TD>
                      <div className="font-mono text-xs text-ink">{r.returnId}</div>
                      <div className="font-mono text-[11px] text-ink-3">order {r.orderId ?? "-"}</div>
                    </TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        {img && <img src={img} alt="" loading="lazy" className="w-8 h-8 rounded object-cover ring-1 ring-line" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />}
                        <span className="text-xs text-ink-2 truncate max-w-[220px]">{li?.product_name ?? li?.sku_name ?? "-"}{(r.lineItems?.length ?? 0) > 1 ? ` +${(r.lineItems!.length - 1)}` : ""}</span>
                      </div>
                    </TD>
                    <TD className="text-xs">{TYPE[r.returnType ?? ""] ?? r.returnType ?? "-"}</TD>
                    <TD><Badge tone={st.tone}>{st.label}</Badge></TD>
                    <TD align="right" className="tabular-nums whitespace-nowrap">{rp(r.refundTotal, r.currency)}</TD>
                    <TD className="text-xs">{r.sellerNextAction ? <span className="text-amber-700">{r.sellerNextAction}{r.nextActionDeadline ? ` · ${tgl(r.nextActionDeadline)}` : ""}</span> : "-"}</TD>
                    <TD align="right" className="text-xs text-ink-3 whitespace-nowrap">{tgl(r.returnUpdateTime)}</TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </Layout>
  );
}
