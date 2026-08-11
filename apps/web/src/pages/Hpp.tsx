import { useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { rupiah } from "../lib/fmt";
import { Icon } from "../components/Icon";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableWrap,
} from "../components/ui";
import { PackingMaterialsCard } from "../components/PackingMaterials";

interface Row {
  productId: string;
  sku: string;
  name: string;
  materialCount: number;
  missingCost: boolean;
  hpp: number;
  publishPrice: number | null;
  netProfit: number | null;
  netMarginRate: number | null;
  /** Units shipped in the chosen window, from packing scans. */
  soldQty?: number;
}

export function Hpp() {
  /** "" every brand, "none" the unassigned ones. */
  const [brand, setBrand] = useState("");
  const brands = useFetch<{ id: string; name: string }[]>("/shops/categories");
  const [sort, setSort] = useState("nama");
  /** Only consulted when sorting by sales; see the control below. */
  const [days, setDays] = useState("30");
  const { data, loading } = useFetch<Row[]>(
    `/costing?brandId=${brand}&sort=${sort}&days=${days}`,
  );

  return (
    <Layout title="HPP & Harga Jual">
      <PageHeader
        title="HPP & Harga Jual"
        subtitle="Hitung harga pokok produksi dari bahan baku, lalu susun harga publish beserta seluruh potongannya."
      />

      <PackingMaterialsCard />

      <Card padded={false}>
        <CardHeader
          title={loading ? "Memuat…" : `${data?.length ?? 0} produk`}
          subtitle="Pilih produk untuk mengatur takaran bahan, biaya jasa, dan komposisi harga."
          action={
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

              {/* Only for sales. A margin is not "over 30 days", and a control
                  that stays put while doing nothing teaches people to ignore
                  controls. */}
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

              <Select
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="min-w-[170px]"
              >
                <option value="">Semua brand</option>
                {(brands.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
                <option value="none">Tanpa brand</option>
              </Select>
            </div>
          }
        />
        <TableWrap>
          <Table className="min-w-[820px]">
            <THead>
              <TR className="border-t-0">
                <TH>Produk</TH>
                <TH>Bahan Baku</TH>
                <TH align="right">Terjual<div className="text-[10px] font-normal text-ink-3">{days === "30" ? "30 hari" : days === "90" ? "3 bulan" : days === "180" ? "6 bulan" : "1 tahun"}</div></TH>
                <TH align="right">HPP / pcs</TH>
                <TH align="right">Harga Publish</TH>
                <TH align="right">Profit Bersih</TH>
                <TH align="right">Margin</TH>
                <TH align="right" />
              </TR>
            </THead>
            <tbody>
              {loading ? (
                <SkeletonRows n={4} cols={7} />
              ) : !data?.length ? (
                <TR>
                  <TD colSpan={8} className="p-0">
                    <EmptyState
                      icon="package"
                      title="Belum ada produk"
                      description="Tambahkan master produk terlebih dahulu, lalu isi bahan bakunya di menu BOM / Bahan."
                    />
                  </TD>
                </TR>
              ) : (
                data.map((r) => (
                  <TR key={r.productId}>
                    <TD>
                      <div className="text-ink font-medium">{r.name}</div>
                      <div className="text-xs text-ink-3 font-mono mt-0.5">{r.sku}</div>
                    </TD>
                    <TD>
                      {r.materialCount === 0 ? (
                        <Badge tone="neutral">Belum ada bahan</Badge>
                      ) : r.missingCost ? (
                        <Badge tone="warning">{r.materialCount} bahan · harga belum lengkap</Badge>
                      ) : (
                        <Badge tone="success">{r.materialCount} bahan</Badge>
                      )}
                    </TD>
                    {/* From packing scans — the only record of anything
                        leaving, since the marketplace APIs are not connected. */}
                    <TD align="right" className="tabular-nums text-ink-2">
                      {r.soldQty ? r.soldQty.toLocaleString("id-ID") : "—"}
                    </TD>
                    <TD align="right" className="text-ink tabular-nums">{rupiah(r.hpp)}</TD>
                    <TD align="right" className="text-ink-2 tabular-nums">
                      {r.publishPrice != null ? rupiah(r.publishPrice) : "—"}
                    </TD>
                    <TD
                      align="right"
                      className={`tabular-nums ${
                        r.netProfit == null
                          ? "text-ink-3"
                          : r.netProfit < 0
                            ? "text-red-600"
                            : "text-ink"
                      }`}
                    >
                      {r.netProfit != null ? rupiah(r.netProfit) : "—"}
                    </TD>
                    <TD align="right">
                      {r.netMarginRate != null ? (
                        <Badge tone={r.netMarginRate < 0 ? "danger" : r.netMarginRate < 0.1 ? "warning" : "success"}>
                          {(r.netMarginRate * 100).toFixed(1)}%
                        </Badge>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </TD>
                    <TD align="right">
                      <Link
                        to={`/hpp/${r.productId}`}
                        className="inline-flex items-center gap-1 text-sm text-brand-ink hover:underline whitespace-nowrap"
                      >
                        Hitung <Icon name="chevronRight" size={14} />
                      </Link>
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
