import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";
import { rupiah } from "../lib/fmt";
import { Icon } from "../components/Icon";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  PageHeader,
  Skeleton,
  Table,
  TableWrap,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from "../components/ui";

interface MaterialLine {
  id: string;
  materialName: string;
  unit: string | null;
  quantity: number;
  unitCost: number;
  lineCost: number;
}
interface Costing {
  serviceCostPerPcs: number;
  publishPrice: number | null;
  marketplaceFeeRate: number;
  eventRate: number;
  affiliatorRate: number;
  adsRate: number;
  adsFixedPerPcs: number;
  sedekahRate: number;
  resellerRate: number;
  targetProfitRate: number;
}
interface Pricing {
  publishPrice: number;
  marketplaceFee: number;
  event: number;
  affiliator: number;
  marketplaceWithheld: number;
  payout: number;
  sedekah: number;
  reseller: number;
  sellerShare: number;
  hpp: number;
  ads: number;
  netProfit: number;
  netMarginRate: number;
}
interface Detail {
  product: { id: string; sku: string; name: string };
  materials: MaterialLine[];
  costing: Costing;
  hpp: { materialCost: number; serviceCost: number; total: number };
  pricing: Pricing | null;
}

const pctStr = (r: number) => (r * 100).toFixed(r * 100 % 1 === 0 ? 0 : 1);

export function HppDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, reload } = useFetch<Detail>(id ? `/costing/${id}` : null);

  return (
    <Layout title="Hitung HPP & Harga Jual">
      <PageHeader
        title={data?.product.name ?? "Hitung HPP & Harga Jual"}
        subtitle={data ? `SKU ${data.product.sku}` : undefined}
        back={
          <Link
            to="/hpp"
            className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink mb-3"
          >
            <Icon name="arrowLeft" size={16} /> Kembali ke daftar produk
          </Link>
        }
      />

      {loading || !data || !id ? (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full rounded-lg" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      ) : (
        <div className="space-y-4">
          <HppSection productId={id} data={data} onChange={reload} />
          <PublishSection productId={id} data={data} onChange={reload} />
        </div>
      )}
    </Layout>
  );
}

/* ----------------------------------------------------------- HPP section */

function HppSection({
  productId,
  data,
  onChange,
}: {
  productId: string;
  data: Detail;
  onChange: () => void;
}) {
  const toast = useToast();
  const [service, setService] = useState(String(data.costing.serviceCostPerPcs));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setService(String(data.costing.serviceCostPerPcs));
  }, [data.costing.serviceCostPerPcs]);

  async function saveService() {
    setBusy(true);
    try {
      await api.patch(`/costing/${productId}`, { serviceCostPerPcs: Number(service) || 0 });
      toast("Biaya jasa produksi disimpan", "success");
      onChange();
    } finally {
      setBusy(false);
    }
  }

  const serviceDirty = Number(service) !== data.costing.serviceCostPerPcs;

  return (
    <Card padded={false}>
      <CardHeader
        title="1 · Harga Pokok Produksi"
        subtitle="Takaran bahan baku untuk 1 pcs produk, dikali harga satuannya."
        action={
          <Link
            to="/bom"
            className="inline-flex items-center gap-1 text-sm text-brand-ink hover:underline"
          >
            Kelola bahan <Icon name="arrowRight" size={14} />
          </Link>
        }
      />

      {!data.materials.length ? (
        <EmptyState
          icon="beaker"
          title="Belum ada bahan baku"
          description="Tambahkan bahan baku beserta takarannya di menu BOM / Bahan, lalu isi harga satuannya di sini."
          action={
            <Link to="/bom">
              <Button variant="filled" icon="plus">
                Tambah Bahan Baku
              </Button>
            </Link>
          }
        />
      ) : (
        <TableWrap>
          <Table className="min-w-[720px]">
            <THead>
              <TR className="border-t-0">
                <TH>Bahan Baku</TH>
                <TH align="right">Takaran / pcs</TH>
                <TH align="right">Harga Satuan</TH>
                <TH align="right">Subtotal</TH>
              </TR>
            </THead>
            <tbody>
              {data.materials.map((m) => (
                <MaterialRow key={m.id} m={m} onChange={onChange} />
              ))}
              <TR className="bg-canvas">
                <TD colSpan={3} className="text-sm text-ink-2">
                  Total Bahan Baku
                </TD>
                <TD align="right" className="text-ink font-medium tabular-nums">
                  {rupiah(data.hpp.materialCost)}
                </TD>
              </TR>
            </tbody>
          </Table>
        </TableWrap>
      )}

      <div className="border-t border-line p-5">
        <div className="flex flex-wrap items-end gap-3">
          <Field
            label="Biaya Jasa Produksi / pcs"
            hint="Ongkos produksi di luar bahan baku (jahit, packing, dll)."
            className="w-full sm:w-64"
          >
            <Input
              inputMode="numeric"
              value={service ? Number(service).toLocaleString("id-ID") : ""}
              onChange={(e) => setService(e.target.value.replace(/\D/g, ""))}
              placeholder="0"
              className="tabular-nums"
            />
          </Field>
          <Button
            variant={serviceDirty ? "filled" : "outline"}
            loading={busy}
            disabled={!serviceDirty}
            onClick={saveService}
          >
            Simpan
          </Button>
        </div>

        <div className="mt-5 rounded-lg border border-line bg-canvas p-4">
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-2">Total bahan baku</dt>
              <dd className="text-ink tabular-nums">{rupiah(data.hpp.materialCost)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-2">Biaya jasa produksi</dt>
              <dd className="text-ink tabular-nums">{rupiah(data.hpp.serviceCost)}</dd>
            </div>
            <div className="flex justify-between pt-2 mt-1 border-t border-line">
              <dt className="font-medium text-ink">Harga Pokok Produksi / pcs</dt>
              <dd className="text-lg text-ink tabular-nums">{rupiah(data.hpp.total)}</dd>
            </div>
          </dl>
        </div>
      </div>
    </Card>
  );
}

function MaterialRow({ m, onChange }: { m: MaterialLine; onChange: () => void }) {
  const toast = useToast();
  const [qty, setQty] = useState(String(m.quantity));
  const [cost, setCost] = useState(String(m.unitCost));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setQty(String(m.quantity));
    setCost(String(m.unitCost));
  }, [m.quantity, m.unitCost]);

  const dirty = Number(qty) !== m.quantity || Number(cost) !== m.unitCost;
  const preview = (Number(qty) || 0) * (Number(cost) || 0);

  async function save() {
    setBusy(true);
    try {
      await api.patch(`/costing/materials/${m.id}`, {
        quantity: Number(qty) || 0,
        unitCost: Number(cost) || 0,
      });
      toast(`${m.materialName} diperbarui`, "success");
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <TR>
      <TD>
        <div className="text-ink">{m.materialName}</div>
        {m.unit && <div className="text-xs text-ink-3 mt-0.5">satuan: {m.unit}</div>}
      </TD>
      <TD align="right">
        <div className="flex items-center justify-end gap-1.5">
          <Input
            inputMode="decimal"
            value={qty}
            onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ""))}
            className="w-24 text-right tabular-nums"
          />
          {m.unit && <span className="text-xs text-ink-3 w-10 text-left">{m.unit}</span>}
        </div>
      </TD>
      <TD align="right">
        <Input
          inputMode="numeric"
          value={cost ? Number(cost).toLocaleString("id-ID") : ""}
          onChange={(e) => setCost(e.target.value.replace(/\D/g, ""))}
          placeholder="0"
          invalid={Number(cost) <= 0}
          className="w-32 text-right tabular-nums"
        />
      </TD>
      <TD align="right">
        <div className="flex items-center justify-end gap-2">
          <span className="text-ink tabular-nums">{rupiah(preview)}</span>
          {dirty && (
            <Button size="sm" variant="filled" loading={busy} onClick={save}>
              Simpan
            </Button>
          )}
        </div>
      </TD>
    </TR>
  );
}

/* ------------------------------------------------------- publish section */

const RATE_FIELDS: { key: keyof Costing; label: string; hint?: string }[] = [
  { key: "marketplaceFeeRate", label: "Biaya Marketplace", hint: "% dari harga publish" },
  { key: "eventRate", label: "Biaya Event", hint: "% dari harga publish" },
  { key: "affiliatorRate", label: "Biaya Affiliator", hint: "% dari harga publish" },
  { key: "adsRate", label: "Biaya Iklan", hint: "% dari harga publish" },
  { key: "sedekahRate", label: "Sedekah", hint: "% dari dana yang dicairkan" },
  { key: "resellerRate", label: "Reseller / Sub-seller", hint: "% dari sisa setelah sedekah" },
];

function PublishSection({
  productId,
  data,
  onChange,
}: {
  productId: string;
  data: Detail;
  onChange: () => void;
}) {
  const toast = useToast();
  const c = data.costing;
  const [price, setPrice] = useState(c.publishPrice != null ? String(c.publishPrice) : "");
  const [rates, setRates] = useState<Record<string, string>>({});
  const [adsFixed, setAdsFixed] = useState(String(c.adsFixedPerPcs));
  const [target, setTarget] = useState(String(Math.round(c.targetProfitRate * 100)));
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<{ price: number | null; reason: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setPrice(c.publishPrice != null ? String(c.publishPrice) : "");
    setAdsFixed(String(c.adsFixedPerPcs));
    setRates(
      Object.fromEntries(RATE_FIELDS.map((f) => [f.key, pctStr(Number(c[f.key]) || 0)])),
    );
    setTarget(String(Math.round(c.targetProfitRate * 100)));
  }, [c]);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const payload: Record<string, number | null> = {
        publishPrice: price === "" ? null : Number(price),
        adsFixedPerPcs: Number(adsFixed) || 0,
        targetProfitRate: (Number(target) || 0) / 100,
      };
      for (const f of RATE_FIELDS) {
        payload[f.key] = (Number(rates[f.key]) || 0) / 100;
      }
      await api.patch(`/costing/${productId}`, payload);
      toast("Komposisi harga disimpan", "success");
      setSuggestion(null);
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function suggest() {
    setSuggesting(true);
    setErr(null);
    try {
      const r = await api.post<{ suggestedPrice: number | null; reason: string | null }>(
        `/costing/${productId}/suggest-price`,
        { kind: "margin", value: (Number(target) || 0) / 100 },
      );
      setSuggestion({ price: r.suggestedPrice, reason: r.reason });
      if (r.suggestedPrice != null) setPrice(String(r.suggestedPrice));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSuggesting(false);
    }
  }

  const p = data.pricing;

  return (
    <Card padded={false}>
      <CardHeader
        title="2 · Harga Publish & Profit"
        subtitle="Susun komposisi biaya, lalu lihat sisa bersih yang benar-benar diterima seller."
      />

      <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* --- inputs --- */}
        <div>
          <Field label="Harga Publish" hint="Harga yang tampil di marketplace." className="max-w-xs">
            <Input
              inputMode="numeric"
              value={price ? Number(price).toLocaleString("id-ID") : ""}
              onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))}
              placeholder="0"
              className="tabular-nums"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3 mt-4">
            {RATE_FIELDS.map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint}>
                <div className="relative">
                  <Input
                    inputMode="decimal"
                    value={rates[f.key] ?? ""}
                    onChange={(e) =>
                      setRates((s) => ({ ...s, [f.key]: e.target.value.replace(/[^\d.]/g, "") }))
                    }
                    className="pr-7 tabular-nums"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-3">%</span>
                </div>
              </Field>
            ))}
            <Field label="Iklan Tetap / pcs" hint="Rupiah, di luar persentase">
              <Input
                inputMode="numeric"
                value={adsFixed ? Number(adsFixed).toLocaleString("id-ID") : ""}
                onChange={(e) => setAdsFixed(e.target.value.replace(/\D/g, ""))}
                placeholder="0"
                className="tabular-nums"
              />
            </Field>
          </div>

          {err && (
            <div className="mt-4">
              <InlineAlert tone="danger">{err}</InlineAlert>
            </div>
          )}

          <div className="mt-4">
            <Button variant="filled" icon="check" loading={busy} onClick={save}>
              Simpan Komposisi
            </Button>
          </div>

          <div className="mt-5 pt-4 border-t border-line">
            <div className="text-sm font-medium text-ink mb-1">Cari harga dari target profit</div>
            <p className="text-xs text-ink-2 mb-3">
              Hitung mundur: berapa harga publish supaya profit bersihnya sesuai target.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Target margin" className="w-32">
                <div className="relative">
                  <Input
                    inputMode="decimal"
                    value={target}
                    onChange={(e) => setTarget(e.target.value.replace(/[^\d.]/g, ""))}
                    className="pr-7 tabular-nums"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-3">%</span>
                </div>
              </Field>
              <Button variant="tonal" icon="trending" loading={suggesting} onClick={suggest}>
                Hitung Harga
              </Button>
            </div>
            {suggestion && (
              <div className="mt-3">
                {suggestion.price != null ? (
                  <InlineAlert tone="success">
                    Harga publish yang disarankan:{" "}
                    <b className="tabular-nums">{rupiah(suggestion.price)}</b>. Sudah diisikan ke
                    kolom di atas — klik Simpan Komposisi untuk menyimpan.
                  </InlineAlert>
                ) : (
                  <InlineAlert tone="warning">{suggestion.reason}</InlineAlert>
                )}
              </div>
            )}
          </div>
        </div>

        {/* --- waterfall --- */}
        <div>
          {!p ? (
            <EmptyState
              icon="banknote"
              title="Isi harga publish dulu"
              description="Setelah harga publish diisi dan disimpan, rincian potongan sampai profit bersih akan muncul di sini."
            />
          ) : (
            <div className="rounded-lg border border-line overflow-hidden">
              <WaterRow label="Harga Publish" value={p.publishPrice} strong />
              <WaterRow label={`Biaya Marketplace ${pctStr(c.marketplaceFeeRate)}%`} value={-p.marketplaceFee} />
              <WaterRow label={`Biaya Event ${pctStr(c.eventRate)}%`} value={-p.event} />
              <WaterRow label={`Biaya Affiliator ${pctStr(c.affiliatorRate)}%`} value={-p.affiliator} />
              <WaterRow label="Diterima dari Marketplace" value={p.payout} subtotal />

              <WaterRow label={`Sedekah ${pctStr(c.sedekahRate)}%`} value={-p.sedekah} />
              <WaterRow label={`Reseller / Sub-seller ${pctStr(c.resellerRate)}%`} value={-p.reseller} />
              <WaterRow label="Bagian Seller" value={p.sellerShare} subtotal />

              <WaterRow label="Harga Pokok Produksi" value={-p.hpp} />
              {p.ads > 0 && <WaterRow label="Biaya Iklan" value={-p.ads} />}

              <div className="flex items-center justify-between px-4 py-4 bg-canvas border-t border-line">
                <div>
                  <div className="text-sm font-medium text-ink">Profit Bersih Seller</div>
                  <div className="text-xs text-ink-2 mt-0.5">per pcs terjual</div>
                </div>
                <div className="text-right">
                  <div
                    className={`text-xl tabular-nums ${
                      p.netProfit < 0 ? "text-red-600" : "text-ink"
                    }`}
                  >
                    {rupiah(p.netProfit)}
                  </div>
                  <div className="mt-1">
                    <Badge
                      tone={
                        p.netMarginRate < 0 ? "danger" : p.netMarginRate < 0.1 ? "warning" : "success"
                      }
                    >
                      margin {(p.netMarginRate * 100).toFixed(1)}%
                    </Badge>
                  </div>
                </div>
              </div>

              {p.netProfit < 0 && (
                <div className="p-3 border-t border-line">
                  <InlineAlert tone="danger">
                    Harga publish saat ini membuat seller rugi per pcs. Naikkan harga, tekan biaya,
                    atau turunkan HPP.
                  </InlineAlert>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function WaterRow({
  label,
  value,
  strong,
  subtotal,
}: {
  label: string;
  value: number;
  strong?: boolean;
  subtotal?: boolean;
}) {
  const negative = value < 0;
  return (
    <div
      className={`flex items-center justify-between px-4 py-2.5 border-b border-line last:border-b-0 ${
        subtotal ? "bg-canvas" : ""
      }`}
    >
      <span className={`text-sm ${strong || subtotal ? "text-ink font-medium" : "text-ink-2"}`}>
        {label}
      </span>
      <span
        className={`text-sm tabular-nums ${
          negative ? "text-red-600" : strong || subtotal ? "text-ink font-medium" : "text-ink"
        }`}
      >
        {negative ? `− ${rupiah(Math.abs(value))}` : rupiah(value)}
      </span>
    </div>
  );
}
