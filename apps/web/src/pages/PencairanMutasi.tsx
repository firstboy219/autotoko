import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { rupiah, dateShort } from "../lib/fmt";
import { Icon } from "../components/Icon";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  Table,
  TableWrap,
  TD,
  TH,
  THead,
  TR,
} from "../components/ui";

interface Mutation {
  id: string; batchId: string; shopId: string; payoutDate: string;
  creditAmount: string; sedekahAmount: string; sellerAmount: string;
  sellerMaterialAmount: string | null;
  subSellerAmount: string | null; subSubSellerAmount: string | null;
  status: "draft" | "completed";
}
interface ShopOpt { id: string; shopName: string; marketplace: string; }

export function PencairanMutasi() {
  const [status, setStatus] = useState("");
  const path = useMemo(() => `/payout/mutations${status ? `?status=${status}` : ""}`, [status]);
  const { data, loading } = useFetch<Mutation[]>(path);
  const { data: shops } = useFetch<ShopOpt[]>("/payout/shops");
  const shopName = (id: string) => shops?.find((s) => s.id === id)?.shopName ?? id.slice(0, 8);

  // Column totals — the point of an "all mutations" view is the aggregate,
  // which previously had to be added up by hand.
  const totals = useMemo(
    () =>
      (data ?? []).reduce(
        (a, m) => {
          a.credit += Number(m.creditAmount) || 0;
          a.sedekah += Number(m.sedekahAmount) || 0;
          a.seller += Number(m.sellerAmount) || 0;
          a.material += Number(m.sellerMaterialAmount) || 0;
          a.sub += Number(m.subSellerAmount) || 0;
          a.subSub += Number(m.subSubSellerAmount) || 0;
          return a;
        },
        { credit: 0, sedekah: 0, seller: 0, sub: 0, subSub: 0, material: 0 },
      ),
    [data],
  );

  return (
    <Layout title="Semua Mutasi Pencairan">
      <PageHeader
        title="Semua Mutasi Pencairan"
        subtitle="Seluruh pencairan toko dari semua batch."
        back={
          <Link
            to="/pencairan"
            className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink mb-3"
          >
            <Icon name="arrowLeft" size={16} /> Kembali
          </Link>
        }
        actions={
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-auto min-w-[160px]"
          >
            <option value="">Semua status</option>
            <option value="draft">Draft</option>
            <option value="completed">Selesai</option>
          </Select>
        }
      />

      <Card padded={false}>
        <CardHeader
          title={loading ? "Memuat…" : `${data?.length ?? 0} mutasi`}
          subtitle={
            !loading && data?.length
              ? `Total kredit ${rupiah(totals.credit)}`
              : undefined
          }
        />
        <TableWrap>
          <Table className="min-w-[860px]">
            <THead>
              <TR className="border-t-0">
                <TH>Tanggal</TH>
                <TH>Toko</TH>
                <TH align="right">Kredit</TH>
                <TH align="right">Sedekah</TH>
                <TH align="right">Seller</TH>
                <TH align="right">Bahan Baku</TH>
                <TH align="right">Sub-seller</TH>
                <TH align="right">Sub-sub</TH>
                <TH>Status</TH>
                <TH align="right" />
              </TR>
            </THead>
            <tbody>
              {loading ? (
                <SkeletonRows n={5} cols={9} />
              ) : !data?.length ? (
                <TR>
                  <TD colSpan={10} className="p-0">
                    <EmptyState
                      icon="fileText"
                      title="Tidak ada mutasi"
                      description={
                        status
                          ? "Tidak ada mutasi dengan status tersebut. Coba ubah filter."
                          : "Mutasi akan muncul di sini setelah kamu merekam pencairan pada sebuah batch."
                      }
                    />
                  </TD>
                </TR>
              ) : (
                <>
                  {data.map((m) => (
                    <TR key={m.id}>
                      <TD className="text-ink-2 whitespace-nowrap">{dateShort(m.payoutDate)}</TD>
                      <TD className="text-ink">{shopName(m.shopId)}</TD>
                      <TD align="right" className="text-ink tabular-nums">{rupiah(m.creditAmount)}</TD>
                      <TD align="right" className="text-ink-2 tabular-nums">{rupiah(m.sedekahAmount)}</TD>
                      <TD align="right" className="text-ink-2 tabular-nums">{rupiah(m.sellerAmount)}</TD>
                      {/* Carved out of the Seller column beside it, not taken
                          on top of it — reading them as two payouts would
                          double count what the seller keeps. */}
                      <TD align="right" className="text-ink-3 tabular-nums">
                        {Number(m.sellerMaterialAmount) > 0 ? rupiah(m.sellerMaterialAmount!) : "—"}
                      </TD>
                      <TD align="right" className="text-ink-2 tabular-nums">
                        {m.subSellerAmount ? rupiah(m.subSellerAmount) : "—"}
                      </TD>
                      <TD align="right" className="text-ink-2 tabular-nums">
                        {m.subSubSellerAmount ? rupiah(m.subSubSellerAmount) : "—"}
                      </TD>
                      <TD>
                        <Badge tone={m.status === "completed" ? "success" : "neutral"}>
                          {m.status === "completed" ? "Selesai" : "Draft"}
                        </Badge>
                      </TD>
                      <TD align="right">
                        <Link
                          to={`/pencairan/batch/${m.batchId}`}
                          className="inline-flex items-center gap-1 text-sm text-brand-ink hover:underline whitespace-nowrap"
                        >
                          Batch <Icon name="chevronRight" size={14} />
                        </Link>
                      </TD>
                    </TR>
                  ))}
                  <TR className="bg-canvas">
                    <TD className="text-xs font-medium text-ink-2">TOTAL</TD>
                    <TD />
                    <TD align="right" className="text-ink font-medium tabular-nums">{rupiah(totals.credit)}</TD>
                    <TD align="right" className="text-ink-2 tabular-nums">{rupiah(totals.sedekah)}</TD>
                    <TD align="right" className="text-ink-2 tabular-nums">{rupiah(totals.seller)}</TD>
                    <TD align="right" className="text-ink-3 tabular-nums">
                      {totals.material > 0 ? rupiah(totals.material) : "—"}
                    </TD>
                    <TD align="right" className="text-ink-2 tabular-nums">{rupiah(totals.sub)}</TD>
                    <TD align="right" className="text-ink-2 tabular-nums">{rupiah(totals.subSub)}</TD>
                    <TD />
                    <TD />
                  </TR>
                </>
              )}
            </tbody>
          </Table>
        </TableWrap>
      </Card>
    </Layout>
  );
}
