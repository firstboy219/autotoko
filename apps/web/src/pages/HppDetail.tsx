import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { calculatePublishPricing, requiredPublishPriceCents } from "@autotoko/shared";
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
  ConfirmModal,
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
  packingCostPerOrder: number;
  avgUnitsPerOrder: number;
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
interface PackingLine {
  id: string;
  name: string;
  unit: string | null;
  quantity: number;
  defaultQuantity: number;
  unitCost: number;
  lineCost: number;
  /** True when this product set its own amount instead of inheriting. */
  isOverride: boolean;
}
interface Detail {
  product: { id: string; sku: string; name: string };
  materials: MaterialLine[];
  packingMaterials: PackingLine[];
  costing: Costing;
  hpp: { materialCost: number; serviceCost: number; packingCost: number; total: number };
  pricing: Pricing | null;
}

const rp = (cents: number) => cents / 100;
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
  const [packing, setPacking] = useState(String(data.costing.packingCostPerOrder));
  const [avgUnits, setAvgUnits] = useState(String(data.costing.avgUnitsPerOrder));
  const [suggest, setSuggest] = useState<{ suggested: number | null; basedOnOrders: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    setService(String(data.costing.serviceCostPerPcs));
    setPacking(String(data.costing.packingCostPerOrder));
    setAvgUnits(String(data.costing.avgUnitsPerOrder));
  }, [data.costing]);

  async function saveService() {
    setBusy(true);
    try {
      await api.patch(`/costing/${productId}`, {
        serviceCostPerPcs: Number(service) || 0,
        packingCostPerOrder: Number(packing) || 0,
        avgUnitsPerOrder: Math.max(0.01, Number(avgUnits) || 1),
      });
      toast("Biaya produksi & packing disimpan", "success");
      onChange();
    } finally {
      setBusy(false);
    }
  }

  const serviceDirty =
    Number(service) !== data.costing.serviceCostPerPcs ||
    Number(packing) !== data.costing.packingCostPerOrder ||
    Number(avgUnits) !== data.costing.avgUnitsPerOrder;

  async function loadSuggestion() {
    const r = await api.get<{ suggested: number | null; basedOnOrders: number }>(
      "/costing/meta/avg-units-per-order",
    );
    setSuggest(r);
    if (r.suggested) setAvgUnits(String(r.suggested));
  }

  return (
    <>
    <PackingSection productId={productId} lines={data.packingMaterials ?? []} onChange={onChange} />
    <Card padded={false}>
      <CardHeader
        title="1 · Harga Pokok Produksi"
        subtitle="Takaran bahan baku untuk 1 pcs produk, dikali harga satuannya."
        action={
          <div className="flex items-center gap-3">
            {!adding && data.materials.length > 0 && (
              <Button size="sm" variant="tonal" icon="plus" onClick={() => setAdding(true)}>
                Tambah Bahan
              </Button>
            )}
            <Link
              to="/bom"
              className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"
              title="Atur supplier, stok, dan restock di modul BOM"
            >
              Kelola stok & supplier <Icon name="arrowRight" size={14} />
            </Link>
          </div>
        }
      />

      {adding && (
        <AddMaterialForm
          productId={productId}
          onDone={() => {
            setAdding(false);
            onChange();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {!data.materials.length ? (
        !adding && (
          <EmptyState
            icon="beaker"
            title="Belum ada bahan baku"
            description="Tambahkan bahan beserta takarannya untuk 1 pcs produk, lalu isi harga satuannya."
            action={
              <Button variant="filled" icon="plus" onClick={() => setAdding(true)}>
                Tambah Bahan Baku
              </Button>
            }
          />
        )
      ) : (
        <TableWrap>
          <Table className="min-w-[780px]">
            <THead>
              <TR className="border-t-0">
                <TH>Bahan Baku</TH>
                <TH align="right">Takaran / pcs</TH>
                <TH align="right">Harga Satuan</TH>
                <TH align="right">Subtotal</TH>
                <TH align="right" />
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
                <TD />
              </TR>
            </tbody>
          </Table>
        </TableWrap>
      )}

      <div className="border-t border-line p-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field
            label="Biaya Jasa Produksi / pcs"
            hint="Ongkos produksi di luar bahan baku (jahit, rakit, dll)."
          >
            <Input
              inputMode="numeric"
              value={service ? Number(service).toLocaleString("id-ID") : ""}
              onChange={(e) => setService(e.target.value.replace(/\D/g, ""))}
              placeholder="0"
              className="tabular-nums"
            />
          </Field>

          <Field
            label="Biaya Packing Lain / resi"
            hint="Dibayar sekali per pengiriman, bukan per pcs."
          >
            <Input
              inputMode="numeric"
              value={packing ? Number(packing).toLocaleString("id-ID") : ""}
              onChange={(e) => setPacking(e.target.value.replace(/\D/g, ""))}
              placeholder="0"
              className="tabular-nums"
            />
          </Field>

          <Field
            label="Rata-rata pcs / resi"
            hint="Pembagi biaya packing agar jadi per produk."
          >
            <Input
              inputMode="decimal"
              value={avgUnits}
              onChange={(e) => setAvgUnits(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder="1"
              className="tabular-nums"
            />
          </Field>
        </div>

        {/* Packing is charged per shipment but HPP is per product, so the cost
            has to be divided by however many units ship together. */}
        {Number(packing) > 0 && (
          <div className="mt-3 rounded-lg bg-canvas border border-line px-3.5 py-2.5">
            <div className="text-xs text-ink-2">
              {rupiah(Number(packing) || 0)} per resi ÷{" "}
              {Number(avgUnits) > 0 ? Number(avgUnits) : 1} pcs ={" "}
              <span className="text-ink tabular-nums">
                {rupiah((Number(packing) || 0) / (Number(avgUnits) > 0 ? Number(avgUnits) : 1))}
              </span>{" "}
              per produk
            </div>
            <button
              type="button"
              onClick={loadSuggestion}
              className="text-xs text-brand-ink hover:underline mt-1.5"
            >
              Hitung rata-rata dari riwayat order
            </button>
            {suggest && (
              <div className="text-xs text-ink-2 mt-1">
                {suggest.suggested
                  ? `Rata-rata ${suggest.suggested} pcs per order, dari ${suggest.basedOnOrders} order terakhir.`
                  : "Belum ada data order untuk dihitung."}
              </div>
            )}
          </div>
        )}

        <div className="mt-4">
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
            {data.hpp.packingCost > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-2">
                  Biaya packing{" "}
                  <span className="text-ink-3">
                    ({rupiah(data.costing.packingCostPerOrder)}/resi ÷ {data.costing.avgUnitsPerOrder} pcs)
                  </span>
                </dt>
                <dd className="text-ink tabular-nums">{rupiah(data.hpp.packingCost)}</dd>
              </div>
            )}
            <div className="flex justify-between pt-2 mt-1 border-t border-line">
              <dt className="font-medium text-ink">Harga Pokok Produksi / pcs</dt>
              <dd className="text-lg text-ink tabular-nums">{rupiah(data.hpp.total)}</dd>
            </div>
          </dl>
        </div>
      </div>
    </Card>
    </>
  );
}

function AddMaterialForm({
  productId,
  onDone,
  onCancel,
}: {
  productId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [cost, setCost] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid = name.trim() !== "" && Number(qty) > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/costing/${productId}/materials`, {
        materialName: name.trim(),
        quantity: Number(qty),
        unit: unit.trim() || undefined,
        unitCost: Number(cost) || 0,
      });
      toast(`${name.trim()} ditambahkan`, "success");
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="border-b border-line bg-canvas p-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Field label="Nama Bahan" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="mis. Biji Kopi Arabika"
            autoFocus
          />
        </Field>
        <Field label="Takaran / pcs" required hint="Untuk 1 pcs produk">
          <Input
            inputMode="decimal"
            value={qty}
            onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="0"
            className="tabular-nums"
          />
        </Field>
        <Field label="Satuan" hint="kg, gram, meter, pcs…">
          <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="kg" />
        </Field>
        <Field label="Harga Satuan" hint="Harga per 1 satuan di atas">
          <Input
            inputMode="numeric"
            value={cost ? Number(cost).toLocaleString("id-ID") : ""}
            onChange={(e) => setCost(e.target.value.replace(/\D/g, ""))}
            placeholder="0"
            className="tabular-nums"
          />
        </Field>
      </div>

      {Number(qty) > 0 && Number(cost) > 0 && (
        <div className="text-xs text-ink-2 mt-3">
          Subtotal untuk 1 pcs:{" "}
          <span className="text-ink tabular-nums">
            {rupiah(Number(qty) * Number(cost))}
          </span>
        </div>
      )}

      {err && (
        <div className="mt-3">
          <InlineAlert tone="danger">{err}</InlineAlert>
        </div>
      )}

      <div className="flex gap-2 mt-4">
        <Button variant="filled" icon="check" loading={busy} disabled={!valid}>
          Tambah Bahan
        </Button>
        <Button type="button" variant="text" onClick={onCancel} disabled={busy}>
          Batal
        </Button>
      </div>
    </form>
  );
}

function MaterialRow({ m, onChange }: { m: MaterialLine; onChange: () => void }) {
  const toast = useToast();
  const [qty, setQty] = useState(String(m.quantity));
  const [cost, setCost] = useState(String(m.unitCost));
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

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

  async function remove() {
    setBusy(true);
    try {
      await api.del(`/costing/materials/${m.id}`);
      toast(`${m.materialName} dihapus`, "success");
      onChange();
    } finally {
      setBusy(false);
      setConfirmDel(false);
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
      <TD align="right">
        <button
          onClick={() => setConfirmDel(true)}
          disabled={busy}
          aria-label={`Hapus ${m.materialName}`}
          className="p-1.5 rounded-full text-ink-3 hover:text-red-600 hover:bg-red-50 transition disabled:opacity-50"
        >
          <Icon name="trash" size={16} />
        </button>
        <ConfirmModal
          open={confirmDel}
          onClose={() => setConfirmDel(false)}
          onConfirm={remove}
          loading={busy}
          title="Hapus bahan baku ini?"
          description={`"${m.materialName}" akan dihapus dari resep produk ini dan HPP dihitung ulang.`}
        />
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
  const [rates, setRates] = useState<Record<string, string>>(() =>
    Object.fromEntries(RATE_FIELDS.map((f) => [f.key, pctStr(Number(c[f.key]) || 0)])),
  );
  const [adsFixed, setAdsFixed] = useState(String(c.adsFixedPerPcs));
  const [target, setTarget] = useState(String(Math.round(c.targetProfitRate * 100)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setPrice(c.publishPrice != null ? String(c.publishPrice) : "");
    setAdsFixed(String(c.adsFixedPerPcs));
    setRates(Object.fromEntries(RATE_FIELDS.map((f) => [f.key, pctStr(Number(c[f.key]) || 0)])));
    setTarget(String(Math.round(c.targetProfitRate * 100)));
  }, [c]);

  const hppCents = Math.round(data.hpp.total * 100);
  const rate = (k: string) => (Number(rates[k]) || 0) / 100;

  /**
   * The composition inputs feed the same shared calculator the backend uses,
   * so the waterfall recomputes as you type — no save round-trip needed just
   * to see the effect of a number.
   */
  const costInputs = useMemo(
    () => ({
      hppCents,
      marketplaceFeeRate: rate("marketplaceFeeRate"),
      eventRate: rate("eventRate"),
      affiliatorRate: rate("affiliatorRate"),
      adsRate: rate("adsRate"),
      adsFixedCents: Math.round((Number(adsFixed) || 0) * 100),
      sedekahRate: rate("sedekahRate"),
      resellerRate: rate("resellerRate"),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hppCents, rates, adsFixed],
  );

  const priceNum = Number(price) || 0;

  const live = useMemo(
    () =>
      priceNum > 0
        ? calculatePublishPricing({ ...costInputs, publishPriceCents: Math.round(priceNum * 100) })
        : null,
    [costInputs, priceNum],
  );

  /**
   * Before a price exists there is nothing to show a waterfall for, so offer a
   * starting point derived from the HPP and the target margin instead of an
   * empty panel.
   */
  const targetRate = (Number(target) || 0) / 100;
  const suggestedCents = useMemo(
    () => requiredPublishPriceCents({ ...costInputs, target: { kind: "margin", marginRate: targetRate } }),
    [costInputs, targetRate],
  );
  // Nobody lists Rp 9.259,26 — round up to a whole rupiah.
  const suggested = suggestedCents == null ? null : Math.ceil(suggestedCents / 100);

  const dirty =
    priceNum !== (c.publishPrice ?? 0) ||
    (Number(adsFixed) || 0) !== c.adsFixedPerPcs ||
    targetRate !== c.targetProfitRate ||
    RATE_FIELDS.some((f) => rate(f.key) !== Number(c[f.key]));

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const payload: Record<string, number | null> = {
        publishPrice: price === "" ? null : priceNum,
        adsFixedPerPcs: Number(adsFixed) || 0,
        targetProfitRate: targetRate,
      };
      for (const f of RATE_FIELDS) payload[f.key] = rate(f.key);
      await api.patch(`/costing/${productId}`, payload);
      toast("Komposisi harga disimpan", "success");
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card padded={false}>
      <CardHeader
        title="2 · Harga Publish & Profit"
        subtitle="Susun komposisi biaya, lalu lihat sisa bersih yang benar-benar diterima seller."
        action={
          dirty ? (
            <Badge tone="warning">Belum disimpan</Badge>
          ) : (
            <Badge tone="success" icon="check">
              Tersimpan
            </Badge>
          )
        }
      />

      <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* --- inputs --- */}
        <div>
          <Field
            label="Harga Publish"
            hint="Harga yang tampil di marketplace."
            className="max-w-xs"
          >
            <Input
              inputMode="numeric"
              value={price ? Number(price).toLocaleString("id-ID") : ""}
              onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))}
              placeholder="0"
              className="tabular-nums"
            />
          </Field>

          {priceNum <= 0 && (
            <div className="mt-3">
              {suggested != null ? (
                <div className="rounded-lg border border-brand/40 bg-brand/10 p-3.5">
                  <div className="text-sm text-ink">
                    Saran harga publish:{" "}
                    <b className="tabular-nums">{rupiah(suggested)}</b>
                  </div>
                  <div className="text-xs text-ink-2 mt-0.5">
                    Dari HPP {rupiah(data.hpp.total)} agar profit bersih ≈ {target}%.
                  </div>
                  <Button
                    size="sm"
                    variant="filled"
                    icon="check"
                    className="mt-2.5"
                    onClick={() => setPrice(String(suggested))}
                  >
                    Pakai harga ini
                  </Button>
                </div>
              ) : (
                <InlineAlert tone="warning">
                  Target {target}% tidak tercapai dengan komposisi biaya saat ini — total potongan
                  sudah menghabiskan harga jual. Turunkan target atau kurangi persentase biaya.
                </InlineAlert>
              )}
            </div>
          )}

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
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-3">
                    %
                  </span>
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
            <Field label="Target Margin" hint="Dipakai untuk saran harga">
              <div className="relative">
                <Input
                  inputMode="decimal"
                  value={target}
                  onChange={(e) => setTarget(e.target.value.replace(/[^\d.]/g, ""))}
                  className="pr-7 tabular-nums"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-3">
                  %
                </span>
              </div>
            </Field>
          </div>

          {err && (
            <div className="mt-4">
              <InlineAlert tone="danger">{err}</InlineAlert>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 mt-4">
            <Button
              variant={dirty ? "filled" : "outline"}
              icon="check"
              loading={busy}
              disabled={!dirty}
              onClick={save}
            >
              Simpan Komposisi
            </Button>
            {priceNum > 0 && suggested != null && priceNum !== suggested && (
              <Button size="sm" variant="text" icon="trending" onClick={() => setPrice(String(suggested))}>
                Pakai saran {rupiah(suggested)} ({target}%)
              </Button>
            )}
          </div>
        </div>

        {/* --- waterfall, recomputed live from the inputs above --- */}
        <div>
          {!live ? (
            <EmptyState
              icon="banknote"
              title="Isi harga publish dulu"
              description="Begitu harga publish diisi, rincian potongan sampai profit bersih langsung muncul di sini."
            />
          ) : (
            <div className="rounded-lg border border-line overflow-hidden">
              <WaterRow label="Harga Publish" value={rp(live.publishPriceCents)} strong />
              <WaterRow
                label={`Biaya Marketplace ${rates.marketplaceFeeRate || 0}%`}
                value={-rp(live.marketplaceFeeCents)}
              />
              <WaterRow label={`Biaya Event ${rates.eventRate || 0}%`} value={-rp(live.eventCents)} />
              <WaterRow
                label={`Biaya Affiliator ${rates.affiliatorRate || 0}%`}
                value={-rp(live.affiliatorCents)}
              />
              <WaterRow label="Diterima dari Marketplace" value={rp(live.payoutCents)} subtotal />

              <WaterRow label={`Sedekah ${rates.sedekahRate || 0}%`} value={-rp(live.sedekahCents)} />
              <WaterRow
                label={`Reseller / Sub-seller ${rates.resellerRate || 0}%`}
                value={-rp(live.resellerCents)}
              />
              <WaterRow label="Bagian Seller" value={rp(live.sellerShareCents)} subtotal />

              <WaterRow label="Harga Pokok Produksi" value={-rp(live.hppCents)} />
              {live.adsCents > 0 && <WaterRow label="Biaya Iklan" value={-rp(live.adsCents)} />}

              <div className="flex items-center justify-between px-4 py-4 bg-canvas border-t border-line">
                <div>
                  <div className="text-sm font-medium text-ink">Profit Bersih Seller</div>
                  <div className="text-xs text-ink-2 mt-0.5">per pcs terjual</div>
                </div>
                <div className="text-right">
                  <div
                    className={`text-xl tabular-nums ${
                      live.netProfitCents < 0 ? "text-red-600" : "text-ink"
                    }`}
                  >
                    {rupiah(rp(live.netProfitCents))}
                  </div>
                  <div className="mt-1">
                    <Badge
                      tone={
                        live.netMarginRate < 0
                          ? "danger"
                          : live.netMarginRate < 0.1
                            ? "warning"
                            : "success"
                      }
                    >
                      margin {(live.netMarginRate * 100).toFixed(1)}%
                    </Badge>
                  </div>
                </div>
              </div>

              {live.netProfitCents < 0 && (
                <div className="p-3 border-t border-line">
                  <InlineAlert tone="danger">
                    Harga publish saat ini membuat seller rugi per pcs. Naikkan harga, tekan biaya,
                    atau turunkan HPP.
                  </InlineAlert>
                </div>
              )}

              {dirty && (
                <div className="px-4 py-2.5 bg-amber-50 border-t border-amber-100 text-xs text-amber-800">
                  Angka di atas dihitung dari input terbaru — klik “Simpan Komposisi” agar tersimpan.
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

/**
 * Packing materials for THIS product.
 *
 * The list is shared by every product; the amounts are not. A product that has
 * not set its own inherits the shared default, and says so — otherwise nobody
 * can tell whether a number was chosen here or came from somewhere else, and
 * changing the shared default would look like it did nothing.
 */
function PackingSection({
  productId,
  lines,
  onChange,
}: {
  productId: string;
  lines: PackingLine[];
  onChange: () => void;
}) {
  const toast = useToast();
  if (!lines.length) return null;

  const total = lines.reduce((a, l) => a + l.lineCost, 0);

  async function save(line: PackingLine, raw: string) {
    const q = Number(raw);
    if (!Number.isFinite(q) || q <= 0 || q === line.quantity) return;
    try {
      await api.patch(`/costing/${productId}/packing/${line.id}`, { quantity: q });
      onChange();
    } catch (e) {
      toast((e as Error).message, "danger");
    }
  }

  async function reset(line: PackingLine) {
    try {
      await api.patch(`/costing/${productId}/packing/${line.id}`, {});
      onChange();
    } catch (e) {
      toast((e as Error).message, "danger");
    }
  }

  return (
    <Card padded={false} className="mb-4">
      <CardHeader
        title="Bahan Packing Produk Ini"
        subtitle="Daftar bahannya sama untuk semua produk; jumlahnya bisa beda per produk."
        action={<span className="text-xs text-ink-2">{rupiah(total)}/resi</span>}
      />
      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>Bahan</TH>
              <TH className="text-right">Jumlah</TH>
              <TH className="text-right">Harga Satuan</TH>
              <TH className="text-right">Biaya</TH>
              <TH />
            </TR>
          </THead>
          <tbody>
            {lines.map((l) => (
              <TR key={l.id}>
                <TD>
                  {l.name}
                  {l.unit ? <span className="text-ink-2"> ({l.unit})</span> : null}
                  {!l.isOverride && (
                    <span className="ml-2 text-[10px] text-ink-3">
                      default ({l.defaultQuantity})
                    </span>
                  )}
                </TD>
                <TD className="text-right">
                  <Input
                    inputMode="decimal"
                    defaultValue={String(l.quantity)}
                    onBlur={(e) => save(l, e.target.value)}
                    className="w-24 text-right tabular-nums"
                  />
                </TD>
                <TD className="text-right tabular-nums">{rupiah(l.unitCost)}</TD>
                <TD className="text-right tabular-nums">{rupiah(l.lineCost)}</TD>
                <TD className="text-right">
                  {l.isOverride && (
                    <Button variant="text" onClick={() => reset(l)}>
                      Pakai default
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    </Card>
  );
}
