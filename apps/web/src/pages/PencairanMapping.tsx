import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
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

interface MappingRow {
  id: string;
  shopName: string;
  marketplace: string;
  scenario: "A" | "B" | "C";
  subSellerId: string | null;
  subSellerName: string | null;
  subSubSellerName: string | null;
  activeAccount: string | null;
  effectiveSubSellerRate: number | null;
  effectiveSubSubSellerRate: number | null;
  addedByType: "seller" | "sub_seller" | "sub_sub_seller";
  addedByName: string;
}

/**
 * `scenario` is not stored anywhere — the server derives it per shop:
 * a sub-sub-seller makes it C, a sub-seller makes it B, neither makes it A.
 * It still decides which rates a row shows, so the field stays.
 *
 * Its own column does not. It said exactly what the ownership chain beside it
 * already said — A meant the chain was empty, B meant one name, C meant two —
 * so the table asked the reader to learn a letter for something already spelled
 * out in words one column over.
 */
const pct = (r: number | null) => (r == null ? "—" : `${(r * 100).toFixed(1)}%`);

export function PencairanMapping() {
  const { data, loading } = useFetch<MappingRow[]>("/payout/mapping");
  const [filterSub, setFilterSub] = useState("");

  const subOptions = useMemo(() => {
    const map = new Map<string, string>();
    (data ?? []).forEach((r) => {
      if (r.subSellerId && r.subSellerName) map.set(r.subSellerId, r.subSellerName);
    });
    return [...map.entries()];
  }, [data]);

  const rows = useMemo(() => {
    if (!filterSub) return data ?? [];
    return (data ?? []).filter((r) => r.subSellerId === filterSub);
  }, [data, filterSub]);

  // Scenario mix — a quick read of how the portfolio is owned, without
  // counting rows by eye.
  const counts = useMemo(() => {
    const c = { A: 0, B: 0, C: 0 };
    (data ?? []).forEach((r) => { c[r.scenario] += 1; });
    return c;
  }, [data]);

  return (
    <Layout title="Mapping Toko ↔ Owner">
      <PageHeader
        title="Mapping Toko ↔ Owner"
        subtitle="Kepemilikan tiap toko, rekening tujuan aktif, dan rate yang berlaku."
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
            value={filterSub}
            onChange={(e) => setFilterSub(e.target.value)}
            className="w-auto min-w-[180px]"
          >
            <option value="">Semua Sub-seller</option>
            {subOptions.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </Select>
        }
      />

      {!loading && (data?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <Badge tone="neutral">{counts.A} toko milik seller</Badge>
          <Badge tone="info">{counts.B} lewat sub-seller</Badge>
          <Badge tone="brand">{counts.C} lewat sub-sub-seller</Badge>
        </div>
      )}

      <Card padded={false}>
        <CardHeader
          title={loading ? "Memuat…" : `${rows.length} toko`}
          subtitle={filterSub ? "Difilter berdasarkan sub-seller" : undefined}
        />
        <TableWrap>
          <Table className="min-w-[900px]">
            <THead>
              <TR className="border-t-0">
                <TH>Nama Toko</TH>
                <TH>Marketplace</TH>
                <TH>Rantai Kepemilikan</TH>
                <TH>Rekening Tujuan Aktif</TH>
                <TH>Rate Berlaku</TH>
                <TH>Ditambahkan Oleh</TH>
              </TR>
            </THead>
            <tbody>
              {loading ? (
                <SkeletonRows n={5} cols={6} />
              ) : !rows.length ? (
                <TR>
                  <TD colSpan={6} className="p-0">
                    <EmptyState
                      icon="store"
                      title={filterSub ? "Tidak ada toko untuk sub-seller ini" : "Belum ada toko"}
                      description={
                        filterSub
                          ? "Coba ubah filter sub-seller."
                          : "Hubungkan toko lewat menu Toko Saya, lalu tugaskan kepemilikannya di halaman Sub-seller."
                      }
                    />
                  </TD>
                </TR>
              ) : (
                rows.map((r) => (
                  <TR key={r.id}>
                    <TD className="text-ink font-medium">{r.shopName}</TD>
                    <TD className="text-ink-2 capitalize">{r.marketplace}</TD>
                    <TD className="text-ink-2">
                      {r.scenario === "A" && "Milik seller"}
                      {r.scenario === "B" && r.subSellerName}
                      {r.scenario === "C" && `${r.subSubSellerName} › ${r.subSellerName}`}
                    </TD>
                    <TD className="font-mono text-xs text-ink">{r.activeAccount ?? "—"}</TD>
                    <TD className="text-xs text-ink-2">
                      {r.scenario === "A" ? (
                        "—"
                      ) : (
                        <>
                          <div>Sub-seller: {pct(r.effectiveSubSellerRate)}</div>
                          {r.scenario === "C" && (
                            <div>Sub-sub-seller: {pct(r.effectiveSubSubSellerRate)}</div>
                          )}
                        </>
                      )}
                    </TD>
                    <TD className="text-ink-2">{r.addedByName}</TD>
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
