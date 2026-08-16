import { useMemo, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { calculatePayoutSplit, type SedekahBasis } from "@autotoko/shared";
import { Layout } from "../components/Layout";
import { FileUpload } from "../components/FileUpload";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";
import { rupiah, dateShort } from "../lib/fmt";
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
  Select,
  Skeleton,
  useToast,
} from "../components/ui";

interface ShopOpt {
  id: string;
  marketplace: string;
  shopName: string;
  subSellerName: string | null;
  subSubSellerName: string | null;
  effectiveSubSellerRate: number | null;
  effectiveSubSubSellerRate: number | null;
  scenario: "A" | "B" | "C";
}
interface Settings {
  sedekahRate: string;
  materialReserveRate: string;
  sedekahBasis: SedekahBasis;
}
interface Mutation {
  id: string;
  shopId: string;
  payoutDate: string;
  creditAmount: string;
  marketplaceProofAmount: string | null;
  marketplaceProofUrl: string | null;
  sedekahAmount: string;
  sellerAmount: string;
  sellerMaterialAmount: string | null;
  subSellerAmount: string | null;
  subSubSellerAmount: string | null;
  /** Who this shop's commission belongs to; the API already sends both. */
  subSellerId: string | null;
  subSubSellerId: string | null;
}
type ValidationStatus = "belum_upload" | "cocok_otomatis" | "tidak_cocok" | "override_manual";
interface Disbursement {
  id: string;
  // Null for the one consolidated sedekah row per batch — it isn't tied to a
  // single shop/mutation, see DisbursementRekap below.
  payoutMutationId: string | null;
  shopName: string | null;
  marketplace: string | null;
  recipientType: "sedekah" | "sub_seller" | "sub_sub_seller" | "bahan_baku";
  /** Part of expectedAmount that came from earlier batches. */
  carryoverAmount: string;
  recipientSubSellerId?: string | null;
  recipientSubSubSellerId?: string | null;
  recipientName: string;
  recipientChain: string | null;
  expectedAmount: string;
  recordedAccount: string | null;
  proofUrl: string | null;
  ocrAmount: string | null;
  ocrAccount: string | null;
  validationStatus: ValidationStatus;
  overrideReason: string | null;
}
interface BatchDetail {
  id: string;
  status: "berjalan" | "siap_distribusi" | "selesai";
  /** Five readable characters; the uuid stays the real key. */
  code: string | null;
  createdAt: string;
  /** When input was locked, and when the batch was finally closed. */
  closedAt: string | null;
  completedAt: string | null;
  mutations: Mutation[];
  disbursements: Disbursement[];
  carryovers?: {
    /** Held back by THIS batch for being under the minimum — still waiting. */
    held: { id: string; name: string; amount: number; recipientType: string }[];
    /** Brought forward from an earlier batch and paid out here. */
    applied: { id: string; name: string; amount: number; recipientType: string }[];
  };
}

const cents = (rupiahVal: number) => Math.round(rupiahVal * 100);
const READY: ValidationStatus[] = ["cocok_otomatis", "override_manual"];

// Upload URLs are stored/returned as a same-origin relative path
// ("/api/uploads/<uuid>.jpg") since the app is served from the same domain
// as the API. That resolves fine for an in-app <a href>, but a relative path
// is meaningless once copied into a WhatsApp message, CSV, or PNG shared
// outside the app — so anywhere the link leaves this page, it needs the
// domain prefixed on.
function absoluteUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `${window.location.origin}${url}`;
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ page */

export function PencairanBatch() {
  const { id } = useParams<{ id: string }>();
  const { data: batch, loading, reload } = useFetch<BatchDetail>(id ? `/payout/batches/${id}` : null);
  const { data: shops } = useFetch<ShopOpt[]>("/payout/shops");
  const { data: settings } = useFetch<Settings>("/payout/settings");

  return (
    <Layout title="Detail Batch Pencairan">
      <PageHeader
        // The code in the title, because this is the page somebody has open
        // while reading the number out to whoever asked about it.
        title={`Detail Batch Pencairan${batch?.code ? ` #${batch.code}` : ""}`}
        back={
          <Link
            to="/pencairan"
            className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink mb-3"
          >
            <Icon name="arrowLeft" size={16} /> Kembali ke daftar batch
          </Link>
        }
      />

      {loading || !batch ? (
        <div className="space-y-4">
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      ) : (
        <div className="space-y-4">
          <BatchProgress batch={batch} shops={shops ?? []} onDone={reload} />
          {batch.status === "berjalan" && shops && settings && (
            <>
              <MutationForm
                batchId={batch.id}
                shops={shops}
                settings={settings}
                onCreated={reload}
                startOpen={batch.mutations.length === 0}
              />
              <MutationList batch={batch} shops={shops} onChange={reload} />
            </>
          )}
          {batch.status !== "berjalan" && (
            <DisbursementRekap batch={batch} shops={shops ?? []} onChange={reload} />
          )}
        </div>
      )}
    </Layout>
  );
}

/* -------------------------------------------------- stepper + next action */

/**
 * "16 Agu 2026" — short enough for a chat line, unambiguous about the month.
 *
 * Two shapes arrive here: a bare date ("2026-08-16", which is a day and has no
 * timezone) and a full timestamp (which does). Reading a bare date as local
 * time would slide it a day backwards for anyone east of UTC, so each is read
 * in the zone it was written in.
 */
function tglPanjang(iso: string): string {
  const bareDate = iso.length <= 10;
  const d = new Date(bareDate ? iso + "T00:00:00Z" : iso);
  return d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: bareDate ? "UTC" : "Asia/Jakarta",
  });
}


const STEPS = [
  { key: "berjalan", label: "Rekam Pencairan", hint: "Input pencairan tiap toko" },
  { key: "siap_distribusi", label: "Transfer & Bukti", hint: "Transfer ke tiap penerima" },
  { key: "selesai", label: "Selesai", hint: "Batch ditutup" },
] as const;

/**
 * Ringkasan untuk pemiliknya sendiri.
 *
 * Tanpa rincian per toko: pesan ini ringkasan, dan siapa mendapat berapa di
 * toko mana bukan yang perlu dibaca semua penerimanya. Angkanya tetap lengkap
 * di halaman, CSV, dan PNG. Bagian seller ikut, karena memang untuk seller.
 */
function pesanSeller(batch: BatchDetail, shops: ShopOpt[]): string {
  const t = batch.mutations.reduce(
    (a, m) => {
      a.credit += Number(m.creditAmount) || 0;
      a.sedekah += Number(m.sedekahAmount) || 0;
      a.seller += Number(m.sellerAmount) || 0;
      a.material += Number(m.sellerMaterialAmount) || 0;
      a.sub += Number(m.subSellerAmount) || 0;
      a.subSub += Number(m.subSubSellerAmount) || 0;
      return a;
    },
    { credit: 0, sedekah: 0, seller: 0, material: 0, sub: 0, subSub: 0 },
  );

  // Tanggal uangnya, bukan tanggal batch dibuka: batch yang dimulai Senin bisa
  // memuat transfer hari Jumat.
  const hari = batch.mutations.map((m) => m.payoutDate).filter(Boolean).sort();
  const rentang =
    hari.length === 0
      ? null
      : hari[0] === hari[hari.length - 1]
        ? tglPanjang(hari[0]!)
        : `${tglPanjang(hari[0]!)} – ${tglPanjang(hari[hari.length - 1]!)}`;

  const lines = [
    `*Rekap Pencairan* (${batch.mutations.length} toko)`,
    `Batch: ${batch.code ? `#${batch.code}` : batch.id.slice(0, 8)}`,
    ...(rentang ? [`Tanggal pencairan: ${rentang}`] : []),
    `Dibuat: ${tglPanjang(batch.createdAt)}`,
    `Total Kredit: ${rupiah(t.credit)}`,
    "",
    "*Hasil Kalkulasi*",
    `Sedekah: ${rupiah(t.sedekah)}`,
  ];
  if (t.sub > 0) lines.push(`Sub-seller: ${rupiah(t.sub)}`);
  if (t.subSub > 0) lines.push(`Sub-sub-seller: ${rupiah(t.subSub)}`);
  lines.push(`Seller: ${rupiah(t.seller)}`);
  if (t.material > 0) {
    lines.push(`  - Bahan baku: ${rupiah(t.material)}`);
    lines.push(`  - Sisa seller: ${rupiah(t.seller - t.material)}`);
  }

  /**
   * Per toko: namanya, berapa yang cair, dan buktinya.
   *
   * Sengaja hanya tiga hal itu. Pecahan sedekah/sub-seller/seller per toko
   * tidak ikut -- yang ingin dilihat di sini adalah "toko mana mencairkan
   * berapa, mana buktinya", dan menambahkan pecahannya mengembalikan tepat
   * rincian yang tadi dibuang.
   */
  if (batch.mutations.length > 0) {
    lines.push("", "*Detail Toko*");
    batch.mutations.forEach((m, i) => {
      const nama =
        shops.find((s) => s.id === m.shopId)?.shopName ?? m.shopId.slice(0, 8);
      lines.push(`${i + 1}. ${nama} - ${rupiah(m.creditAmount)}`);
      // Buktinya disebut ada-tidaknya, bukan dilewati diam-diam: baris tanpa
      // tautan yang tidak diterangkan terbaca seperti bukti yang hilang.
      lines.push(
        m.marketplaceProofUrl
          ? `   ${absoluteUrl(m.marketplaceProofUrl)}`
          : "   (bukti pencairan belum diunggah)",
      );
    });
  }

  return lines.join("\n");
}

/**
 * Bukti transfer untuk yang menerimanya.
 *
 * Tanpa ringkasan berhitung di kepala: kebalikan dari pesan seller, di sini
 * yang dikirim justru rinciannya. Jatah bahan baku tidak ikut -- uang itu
 * dipotong dari bagian seller dan masuk ke rekening pemilik sendiri, jadi
 * menampilkannya berarti memperlihatkan nominal seller lewat pintu lain.
 *
 * Transfer yang belum ada buktinya tetap didaftar dan disebut belum ada:
 * menghilangkannya membuat pesan terlihat lengkap sementara ada yang masih
 * menunggu uangnya.
 */
function pesanSubSeller(batch: BatchDetail): string {
  const JENIS: Record<string, string> = {
    sub_seller: "Sub-seller",
    sub_sub_seller: "Sub-sub-seller",
    sedekah: "Sedekah",
  };
  const per = new Map<
    string,
    { nama: string; jenis: string; total: number; bukti: string[]; tanpaBukti: number }
  >();
  for (const d of batch.disbursements) {
    if (d.recipientType === "bahan_baku") continue;
    const kunci = `${d.recipientType}|${d.recipientName}`;
    const g = per.get(kunci) ?? {
      nama: d.recipientName,
      jenis: d.recipientType,
      total: 0,
      bukti: [] as string[],
      tanpaBukti: 0,
    };
    g.total += Number(d.expectedAmount) || 0;
    if (d.proofUrl) g.bukti.push(absoluteUrl(d.proofUrl));
    else g.tanpaBukti += 1;
    per.set(kunci, g);
  }

  const lines = [
    "*Bukti Transfer Pencairan*",
    `Batch: ${batch.code ? `#${batch.code}` : batch.id.slice(0, 8)}`,
    `Tanggal: ${tglPanjang(batch.completedAt ?? batch.closedAt ?? batch.createdAt)}`,
    "",
  ];
  let n = 0;
  for (const g of [...per.values()].sort((a, b) => b.total - a.total)) {
    n += 1;
    lines.push(`${n}. ${g.nama} (${JENIS[g.jenis] ?? g.jenis}) — ${rupiah(g.total)}`);
    for (const url of g.bukti) lines.push(`   ${url}`);
    if (g.tanpaBukti > 0) lines.push(`   (${g.tanpaBukti} transfer belum ada buktinya)`);
  }
  return lines.join("\n");
}

/** Satu pintu ke WhatsApp, supaya penyusunan pesannya tidak tercecer. */
function bukaWhatsApp(teks: string) {
  window.open(`https://wa.me/?text=${encodeURIComponent(teks)}`, "_blank");
}

function stepIndex(status: BatchDetail["status"]): number {
  return STEPS.findIndex((s) => s.key === status);
}

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-stretch gap-1 sm:gap-2">
      {STEPS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s.key} className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-xs font-medium ${
                  done
                    ? "bg-emerald-500 text-white"
                    : active
                      ? "bg-brand text-onbrand"
                      : "bg-canvas text-ink-3 border border-line"
                }`}
              >
                {done ? <Icon name="check" size={14} /> : i + 1}
              </span>
              <div
                className={`h-0.5 flex-1 rounded-full ${
                  i < current ? "bg-emerald-500" : "bg-line"
                } ${i === STEPS.length - 1 ? "invisible" : ""}`}
              />
            </div>
            <div className="mt-1.5 pr-2">
              <div
                className={`text-xs truncate ${
                  active ? "text-ink font-medium" : done ? "text-ink-2" : "text-ink-3"
                }`}
              >
                {s.label}
              </div>
              <div className="text-xs text-ink-3 truncate hidden sm:block">{s.hint}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function BatchProgress({
  batch,
  shops,
  onDone,
}: {
  batch: BatchDetail;
  /** Dipakai hanya untuk menamai toko di pesan WhatsApp. */
  shops: ShopOpt[];
  onDone: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const notReady = batch.disbursements.filter((d) => !READY.includes(d.validationStatus));
  const current = stepIndex(batch.status);

  const totals = useMemo(
    () =>
      batch.mutations.reduce(
        (a, m) => {
          a.credit += Number(m.creditAmount) || 0;
          a.sedekah += Number(m.sedekahAmount) || 0;
          a.seller += Number(m.sellerAmount) || 0;
          a.material += Number(m.sellerMaterialAmount) || 0;
          a.sub += (Number(m.subSellerAmount) || 0) + (Number(m.subSubSellerAmount) || 0);
          return a;
        },
        { credit: 0, sedekah: 0, seller: 0, sub: 0, material: 0 },
      ),
    [batch.mutations],
  );

  async function run(fn: () => Promise<unknown>, okMsg: string) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      toast(okMsg, "success");
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelBatch() {
    setBusy(true);
    setErr(null);
    try {
      await api.del(`/payout/batches/${batch.id}`);
      navigate("/pencairan");
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
      setConfirmCancel(false);
    }
  }

  /**
   * Back to step 1.
   *
   * Closing input wrote a transfer row per recipient, so going back deletes
   * them — and with them any proof already uploaded. The server refuses the
   * first attempt when that would destroy work and says how much; only then do
   * we ask, and only a yes sends force. A "back" button must never quietly
   * throw away evidence somebody photographed and uploaded.
   */
  async function reopenInput(force: boolean) {
    setBusy(true);
    try {
      await api.post(`/payout/batches/${batch.id}/reopen-input`, force ? { force: true } : {});
      toast("Kembali ke tahap Rekam Pencairan", "success");
      onDone();
    } catch (e) {
      const msg = (e as Error).message;
      if (!force && /bukti|validasi/i.test(msg)) {
        if (
          window.confirm(
            `${msg}\n\nLanjutkan? Bukti transfer yang sudah diunggah akan hilang dan tidak bisa dikembalikan.`,
          )
        ) {
          setBusy(false);
          return reopenInput(true);
        }
      } else {
        toast(msg, "danger");
      }
    } finally {
      setBusy(false);
    }
  }

  // The single most important thing on this page: what do I do next.
  let nextAction: React.ReactNode = null;
  let nextHint = "";
  if (batch.status === "berjalan") {
    nextHint =
      batch.mutations.length === 0
        ? "Rekam pencairan minimal satu toko untuk melanjutkan."
        : `${batch.mutations.length} toko sudah direkam. Lanjutkan bila semua toko selesai direkam.`;
    nextAction = (
      <div className="flex flex-wrap items-center gap-2">
        {batch.mutations.length > 0 && (
          <Button
            variant="outline"
            icon="refresh"
            loading={busy}
            onClick={() =>
              run(async () => {
                const r = await api.post<{ total: number; changed: number }>(
                  `/payout/batches/${batch.id}/recalculate`,
                );
                return r;
              }, "Perhitungan diperbarui")
            }
          >
            Hitung Ulang
          </Button>
        )}
        <Button
          variant="filled"
          iconRight="arrowRight"
          disabled={batch.mutations.length === 0}
          loading={busy}
          onClick={() => run(() => api.post(`/payout/batches/${batch.id}/close-input`), "Input ditutup — rekap transfer dibuat")}
        >
          Selesai Pencairan Semua Toko
        </Button>
      </div>
    );
  } else if (batch.status === "siap_distribusi") {
    nextHint =
      notReady.length > 0
        ? `${notReady.length} transfer belum tervalidasi. Upload bukti atau override dulu.`
        : "Semua transfer sudah tervalidasi. Batch siap ditutup.";
    nextAction = (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          icon="arrowLeft"
          loading={busy}
          onClick={() => reopenInput(false)}
        >
          Kembali ke Rekam Pencairan
        </Button>
        <Button
          variant="filled"
          iconRight="check"
          disabled={notReady.length > 0}
          loading={busy}
          onClick={() => run(() => api.post(`/payout/batches/${batch.id}/close`), "Batch ditutup")}
        >
          Tutup Batch
        </Button>
      </div>
    );
  } else {
    nextHint = "Batch sudah ditutup. Tidak ada tindakan lagi.";
  }

  return (
    <>
      <Card>
        <Stepper current={current} />

        <div className="mt-5 pt-4 border-t border-line flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                tone={
                  batch.status === "selesai"
                    ? "success"
                    : batch.status === "siap_distribusi"
                      ? "warning"
                      : "info"
                }
              >
                {batch.status === "berjalan"
                  ? "Berjalan"
                  : batch.status === "siap_distribusi"
                    ? "Siap Distribusi"
                    : "Selesai"}
              </Badge>
              <span className="text-sm text-ink-2">{nextHint}</span>
            </div>

            {/* Di kartu kepala, bukan di dalam salah satu step. Sebelumnya
                yang seller cuma ada saat batch masih berjalan dan yang
                sub-seller cuma saat sudah ditutup, jadi pada batch yang
                sedang ditransfer tidak satupun bisa dijangkau. Syaratnya
                sekarang isi, bukan status. */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {batch.mutations.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  icon="share"
                  onClick={() => bukaWhatsApp(pesanSeller(batch, shops))}
                >
                  Bagikan WA ke Seller
                </Button>
              )}
              {batch.disbursements.some((d) => d.recipientType !== "bahan_baku") && (
                <Button
                  size="sm"
                  variant="outline"
                  icon="share"
                  onClick={() => bukaWhatsApp(pesanSubSeller(batch))}
                >
                  Bagikan WA ke Sub-seller
                </Button>
              )}
            </div>

            {batch.mutations.length > 0 && (
              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                {[
                  ["Total Kredit", totals.credit],
                  ["Sedekah", totals.sedekah],
                  // Net, for the same reason as the Ringkasan Total below.
                  ["Seller (bersih)", totals.seller - totals.material],
                  ...(totals.material > 0
                    ? ([["Bahan Baku", totals.material]] as [string, number][])
                    : []),
                  ...(totals.sub > 0 ? ([["Sub-seller", totals.sub]] as [string, number][]) : []),
                ].map(([label, val]) => (
                  <div key={label as string}>
                    <dt className="text-xs text-ink-3">{label}</dt>
                    <dd className="text-sm text-ink tabular-nums">{rupiah(val as number)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          <div className="flex items-center gap-2">
            {batch.status !== "selesai" && (
              <Button variant="text" onClick={() => setConfirmCancel(true)} disabled={busy}>
                Batalkan Batch
              </Button>
            )}
            {nextAction}
          </div>
        </div>

        {err && (
          <div className="mt-3">
            <InlineAlert tone="danger">{err}</InlineAlert>
          </div>
        )}
      </Card>

      <ConfirmModal
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={cancelBatch}
        loading={busy}
        title="Batalkan batch ini?"
        confirmLabel="Batalkan Batch"
        description="Semua mutasi & rekap transfer di dalamnya akan terhapus permanen dan tidak bisa dikembalikan."
      />
    </>
  );
}

/* ------------------------------------------------------------- input form */

function MutationForm({
  batchId,
  shops,
  settings,
  onCreated,
  startOpen,
}: {
  batchId: string;
  shops: ShopOpt[];
  settings: Settings;
  onCreated: () => void;
  startOpen: boolean;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(startOpen);
  const [shopId, setShopId] = useState("");
  const [payoutDate, setPayoutDate] = useState(new Date().toISOString().slice(0, 10));
  // The single amount field — both the split basis AND the marketplace proof
  // figure (no more separate "Nominal Kredit" input).
  const [proofAmount, setProofAmount] = useState("");
  // What OCR originally suggested for this amount, captured once at upload
  // time and never touched afterward — comparing it to the final proofAmount
  // at submit is how the backend detects "staff corrected an OCR misread"
  // (a null/unchanged value means OCR was right, or wasn't used).
  const [ocrSuggestedAmount, setOcrSuggestedAmount] = useState<number | null>(null);
  const [receiving, setReceiving] = useState("");
  // Every account number OCR could plausibly find on the receipt, best guess
  // first. A receipt usually has several digit runs (reference no, phone,
  // order id) and picking the wrong one silently is worse than asking — so
  // when there is more than one the operator chooses.
  const [accountOptions, setAccountOptions] = useState<string[]>([]);
  const [proofUrl, setProofUrl] = useState("");
  const [note, setNote] = useState("");
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrNote, setOcrNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const shop = shops.find((s) => s.id === shopId);
  const amountNum = Number(proofAmount) || 0;

  const split = useMemo(() => {
    if (!shop || amountNum <= 0) return null;
    try {
      return calculatePayoutSplit({
        creditCents: cents(amountNum),
        sedekahRate: Number(settings.sedekahRate),
        sedekahBasis: settings.sedekahBasis,
        subSellerRate: shop.effectiveSubSellerRate,
        subSubSellerRate: shop.effectiveSubSubSellerRate,
        materialReserveRate: Number(settings.materialReserveRate ?? 0),
      });
    } catch {
      return null;
    }
  }, [shop, amountNum, settings]);

  // Titik 1 OCR: after the pencairan screenshot is uploaded, ask the server to
  // read it and suggest values — staff can still edit anything before submit.
  async function onProofUploaded(url: string) {
    setProofUrl(url);
    setOcrBusy(true);
    setOcrNote(null);
    try {
      const result = await api.post<{
        amount: number | null;
        account: string | null;
        accountCandidates?: string[];
      }>("/payout/ocr/extract-pencairan", { imageUrl: url });
      if (result.amount != null) {
        setProofAmount(String(result.amount));
        setOcrSuggestedAmount(result.amount);
      }
      if (result.account != null) setReceiving(result.account);
      setAccountOptions(result.accountCandidates ?? []);
      setOcrNote(
        result.amount != null || result.account != null
          ? "Terisi otomatis dari OCR — periksa dan koreksi jika perlu."
          : "OCR tidak berhasil membaca nominal/rekening — isi manual.",
      );
    } catch {
      setOcrNote("OCR gagal diproses — isi manual.");
    } finally {
      setOcrBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post("/payout/mutations", {
        batchId,
        shopId,
        payoutDate,
        marketplaceProofAmount: amountNum,
        ...(ocrSuggestedAmount != null ? { ocrSuggestedAmount } : {}),
        ...(receiving ? { receivingAccount: receiving } : {}),
        ...(proofUrl ? { marketplaceProofUrl: proofUrl } : {}),
        ...(note ? { note } : {}),
      });
      setShopId("");
      setProofAmount("");
      setOcrSuggestedAmount(null);
      setReceiving("");
      setAccountOptions([]);
      setProofUrl("");
      setNote("");
      setOcrNote(null);
      toast("Pencairan toko tersimpan", "success");
      onCreated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="tonal" icon="plus" onClick={() => setOpen(true)}>
        Rekam Pencairan Toko
      </Button>
    );
  }

  return (
    <Card padded={false}>
      <CardHeader
        title="Rekam Pencairan Toko"
        subtitle="Ulangi untuk toko lain sesuai kebutuhan — tidak wajib semua toko."
        action={
          <Button variant="text" size="sm" onClick={() => setOpen(false)}>
            Tutup
          </Button>
        }
      />
      <form onSubmit={submit} className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Toko" required>
            <Select value={shopId} onChange={(e) => setShopId(e.target.value)} required>
              <option value="">— pilih toko —</option>
              {shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.shopName} ({s.marketplace}) · Skenario {s.scenario}
                  {s.subSellerName ? ` · ${s.subSellerName}` : ""}
                  {s.subSubSellerName ? ` › ${s.subSubSellerName}` : ""}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Tanggal Pencairan" required>
            <Input
              type="date"
              value={payoutDate}
              onChange={(e) => setPayoutDate(e.target.value)}
              required
            />
          </Field>

          <div className="md:col-span-2">
            <FileUpload
              label="Bukti Pencairan Marketplace (unggah dulu — nominal & rekening akan dicoba dibaca otomatis)"
              value={proofUrl}
              onChange={onProofUploaded}
            />
            {ocrBusy && (
              <div className="flex items-center gap-1.5 text-xs text-ink-2 mt-1.5">
                <Icon name="refresh" size={13} className="animate-spin" /> Membaca gambar…
              </div>
            )}
            {ocrNote && !ocrBusy && (
              <div className="text-xs text-ink-2 mt-1.5">{ocrNote}</div>
            )}
          </div>

          <Field
            label="Nominal Bukti Marketplace (dasar kalkulasi)"
            required
            hint={
              ocrSuggestedAmount != null && Number(proofAmount) !== ocrSuggestedAmount ? (
                <span className="text-amber-600">
                  Dikoreksi dari hasil OCR ({rupiah(ocrSuggestedAmount)})
                </span>
              ) : undefined
            }
          >
            <Input
              inputMode="numeric"
              value={proofAmount ? Number(proofAmount).toLocaleString("id-ID") : ""}
              onChange={(e) => setProofAmount(e.target.value.replace(/\D/g, ""))}
              placeholder="0"
              required
              className="tabular-nums"
            />
          </Field>

          <Field
            label="Rekening Penampung"
            hint={
              accountOptions.length > 1
                ? "OCR menemukan beberapa angka yang mirip nomor rekening — pilih yang benar."
                : undefined
            }
          >
            <Input value={receiving} onChange={(e) => setReceiving(e.target.value)} className="font-mono" />
            {accountOptions.length > 1 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {accountOptions.map((opt, i) => {
                  const active = receiving === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setReceiving(opt)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs transition ${
                        active
                          ? "border-brand bg-brand/15 text-ink"
                          : "border-line bg-white text-ink-2 hover:bg-canvas"
                      }`}
                    >
                      {active && <Icon name="check" size={12} />}
                      {opt}
                      {i === 0 && !active && (
                        <span className="font-sans text-ink-3">· tebakan utama</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </Field>

          <Field label="Catatan (opsional)" className="md:col-span-2">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>

        {split && shop && (
          <div className="mt-4 rounded-lg bg-canvas border border-line p-4">
            <div className="text-xs font-medium text-ink-2 mb-3">
              Kalkulasi Split (real-time · Skenario {split.scenario})
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SplitCell label="Sedekah" value={split.sedekahCents} />
              <SplitCell label="Seller" value={split.sellerCents} />
              {split.sellerMaterialCents > 0 && (
                <>
                  <SplitCell label="- Bahan baku" value={split.sellerMaterialCents} />
                  <SplitCell label="- Sisa seller" value={split.sellerNetCents} />
                </>
              )}
              {split.subSellerCents > 0 && (
                <SplitCell
                  label={`Sub-seller${shop.subSellerName ? ` (${shop.subSellerName})` : ""}`}
                  value={split.subSellerCents}
                />
              )}
              {split.subSubSellerCents > 0 && (
                <SplitCell
                  label={`Sub-sub-seller${shop.subSubSellerName ? ` (${shop.subSubSellerName})` : ""}`}
                  value={split.subSubSellerCents}
                />
              )}
            </div>
          </div>
        )}

        {err && (
          <div className="mt-4">
            <InlineAlert tone="danger">{err}</InlineAlert>
          </div>
        )}

        <div className="mt-4">
          <Button variant="filled" icon="check" loading={busy} disabled={!shopId || amountNum <= 0}>
            Simpan Pencairan Toko Ini
          </Button>
        </div>
      </form>
    </Card>
  );
}

/**
 * One figure from the split, with what share of the payout it is.
 *
 * The percentage is the point of the whole row: it is how someone checks that
 * what came out matches what was configured, without dividing anything by hand
 * or trusting that the rates were applied.
 */
function SplitCell({
  label,
  value,
  ofCents,
  note,
}: {
  label: string;
  value: number;
  /** Denominator for the share. Omit to show no percentage. */
  ofCents?: number;
  note?: string;
}) {
  const pct = ofCents && ofCents > 0 ? (value / ofCents) * 100 : null;
  return (
    <div className="bg-white rounded-lg border border-line px-3 py-2.5">
      <div className="text-xs text-ink-3 truncate">{label}</div>
      <div className="text-sm text-ink tabular-nums mt-0.5">{rupiah(value / 100)}</div>
      {pct != null && (
        <div className="text-[11px] text-ink-3 tabular-nums">{pct.toFixed(1)}% dari kredit</div>
      )}
      {note && <div className="text-[11px] text-ink-3">{note}</div>}
    </div>
  );
}

/* ------------------------------------------------------- recorded list */

function MutationList({
  batch,
  shops,
  onChange,
}: {
  batch: BatchDetail;
  shops: ShopOpt[];
  onChange: () => void;
}) {
  const toast = useToast();
  const shopName = (id: string) => shops.find((s) => s.id === id)?.shopName ?? id.slice(0, 8);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pngBusy, setPngBusy] = useState(false);
  // Only the ringkasan + shop-row list gets captured for the PNG export —
  // not the header/button bar above it.
  const captureRef = useRef<HTMLDivElement>(null);

  // Sum of what each recipient bucket is owed across every shop recorded so
  // far in this batch — lets staff sanity-check the total before closing
  // input, without adding up the per-shop rows by hand.
  const totals = useMemo(() => {
    return batch.mutations.reduce(
      (acc, m) => {
        acc.credit += Number(m.creditAmount) || 0;
        acc.sedekah += Number(m.sedekahAmount) || 0;
        acc.seller += Number(m.sellerAmount) || 0;
        acc.subSeller += Number(m.subSellerAmount) || 0;
        acc.subSubSeller += Number(m.subSubSellerAmount) || 0;
        acc.material += Number(m.sellerMaterialAmount) || 0;
        return acc;
      },
      { credit: 0, sedekah: 0, seller: 0, subSeller: 0, subSubSeller: 0, material: 0 },
    );
  }, [batch.mutations]);

  async function remove(id: string) {
    setBusyId(id);
    try {
      await api.del(`/payout/mutations/${id}`);
      toast("Mutasi dihapus", "success");
      onChange();
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  }

  function downloadExcel() {
    const header = [
      "Toko", "Tanggal", "Total Kredit", "Sedekah", "Seller",
      "Sub-seller", "Nama Sub-seller", "Sub-sub-seller", "Nama Sub-sub-seller", "Link Bukti",
    ];
    const rows = batch.mutations.map((m) => {
      const shop = shops.find((s) => s.id === m.shopId);
      return [
        shopName(m.shopId), m.payoutDate, Number(m.creditAmount) || 0, Number(m.sedekahAmount) || 0,
        Number(m.sellerAmount) || 0, Number(m.subSellerAmount) || 0, shop?.subSellerName ?? "",
        Number(m.subSubSellerAmount) || 0, shop?.subSubSellerName ?? "",
        m.marketplaceProofUrl ? absoluteUrl(m.marketplaceProofUrl) : "",
      ];
    });
    const totalRow = [
      "TOTAL", "", totals.credit, totals.sedekah, totals.seller,
      totals.subSeller, "", totals.subSubSeller, "", "",
    ];
    const csv = [header, ...rows, totalRow].map((r) => r.map(csvEscape).join(",")).join("\r\n");
    // Leading BOM so Excel opens the UTF-8 file (rupiah symbols etc.) correctly.
    downloadBlob(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), `rekap-pencairan-${batch.code ?? batch.id.slice(0, 8)}.csv`);
  }

  async function downloadPng() {
    if (!captureRef.current) return;
    setPngBusy(true);
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(captureRef.current, { backgroundColor: "#ffffff", scale: 2 });
      await new Promise<void>((resolve) => {
        canvas.toBlob((blob) => {
          if (blob) downloadBlob(blob, `rekap-pencairan-${batch.code ?? batch.id.slice(0, 8)}.png`);
          resolve();
        });
      });
    } finally {
      setPngBusy(false);
    }
  }


  const target = batch.mutations.find((m) => m.id === confirmId);

  return (
    <>
      <Card padded={false}>
        <CardHeader
          title={`Toko Sudah Direkam (${batch.mutations.length})`}
          action={
            batch.mutations.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" icon="download" onClick={downloadExcel}>
                  Excel
                </Button>
                <Button size="sm" variant="outline" icon="image" loading={pngBusy} onClick={downloadPng}>
                  PNG
                </Button>
              </div>
            )
          }
        />

        <div ref={captureRef}>
          {batch.mutations.length > 0 && (
            <div className="px-5 py-4 border-b border-line bg-canvas">
              <div className="text-xs font-medium text-ink-2 mb-3">
                Ringkasan Total ({batch.mutations.length} toko)
              </div>
              {/* Seller is shown NET. The reserve is carved out of the
                  seller's own cut, so a gross figure here overstated what
                  actually reaches them by the whole reserve — 50% of it, for
                  this tenant. Net + reserve + everyone else still adds up to
                  the credit, which is what the percentages let you check. */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <SplitCell label="Total Kredit" value={cents(totals.credit)} />
                <SplitCell
                  label="Sedekah"
                  value={cents(totals.sedekah)}
                  ofCents={cents(totals.credit)}
                />
                <SplitCell
                  label="Seller (bersih)"
                  value={cents(totals.seller - totals.material)}
                  ofCents={cents(totals.credit)}
                />
                {totals.material > 0 && (
                  <SplitCell
                    label="Bahan Baku"
                    value={cents(totals.material)}
                    ofCents={cents(totals.credit)}
                    note={
                      totals.seller > 0
                        ? `${((totals.material / totals.seller) * 100).toFixed(0)}% dari seller`
                        : undefined
                    }
                  />
                )}
                {totals.subSeller > 0 && (
                  <SplitCell
                    label="Sub-seller"
                    value={cents(totals.subSeller)}
                    ofCents={cents(totals.credit)}
                  />
                )}
                {totals.subSubSeller > 0 && (
                  <SplitCell
                    label="Sub-sub-seller"
                    value={cents(totals.subSubSeller)}
                    ofCents={cents(totals.credit)}
                  />
                )}
              </div>
            </div>
          )}

          {!batch.mutations.length ? (
            <EmptyState
              icon="inbox"
              title="Belum ada toko direkam"
              description="Klik “Rekam Pencairan Toko” di atas untuk menambahkan pencairan toko pertama."
            />
          ) : (
            <ul className="divide-y divide-line">
              {batch.mutations.map((m) => {
                const shop = shops.find((s) => s.id === m.shopId);
                const subSellerAmt = Number(m.subSellerAmount) || 0;
                const subSubSellerAmt = Number(m.subSubSellerAmount) || 0;
                // What actually has to be transferred out to the reseller side
                // for this shop — the number staff act on, so it earns the
                // prominent right-hand slot.
                const komisi = subSellerAmt + subSubSellerAmt;
                const komisiPct =
                  shop?.effectiveSubSellerRate != null
                    ? `${(shop.effectiveSubSellerRate * 100).toFixed(0)}%`
                    : null;
                return (
                  <li key={m.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-ink truncate">
                          {shopName(m.shopId)}
                        </div>
                        <div className="text-xs text-ink-3 mt-0.5">{dateShort(m.payoutDate)}</div>
                      </div>
                      <div className="text-right shrink-0">
                        {komisi > 0 ? (
                          <>
                            <div className="text-base text-ink tabular-nums">{rupiah(komisi)}</div>
                            <div className="text-xs text-ink-3">
                              komisi{komisiPct ? ` ${komisiPct}` : ""}
                            </div>
                          </>
                        ) : (
                          <div className="text-sm text-ink-3">tanpa komisi</div>
                        )}
                        <button
                          onClick={() => setConfirmId(m.id)}
                          disabled={busyId === m.id}
                          className="text-xs text-red-600 hover:underline disabled:opacity-50 mt-1"
                        >
                          Hapus
                        </button>
                      </div>
                    </div>

                    {/* Breakdown as discrete chips — previously these piled up
                        into one dense run-on line that was hard to scan. */}
                    <div className="flex flex-wrap gap-1.5 mt-2.5">
                      <Badge tone="neutral">Total {rupiah(m.creditAmount)}</Badge>
                      <Badge tone="neutral">Sedekah {rupiah(m.sedekahAmount)}</Badge>
                      <Badge tone="neutral">Seller {rupiah(m.sellerAmount)}</Badge>
                      {subSellerAmt > 0 && (
                        <Badge tone="brand">
                          {shop?.subSellerName ?? "Sub-seller"}
                          {shop?.effectiveSubSellerRate != null
                            ? ` ${(shop.effectiveSubSellerRate * 100).toFixed(0)}%`
                            : ""}{" "}
                          {rupiah(subSellerAmt)}
                        </Badge>
                      )}
                      {subSubSellerAmt > 0 && (
                        <Badge tone="brand">
                          {shop?.subSubSellerName ?? "Sub-sub-seller"}
                          {shop?.effectiveSubSubSellerRate != null
                            ? ` ${(shop.effectiveSubSubSellerRate * 100).toFixed(0)}%`
                            : ""}{" "}
                          {rupiah(subSubSellerAmt)}
                        </Badge>
                      )}
                    </div>

                    {m.marketplaceProofUrl && (
                      <a
                        href={absoluteUrl(m.marketplaceProofUrl)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-brand-ink hover:underline mt-2 break-all"
                      >
                        <Icon name="image" size={13} />
                        {absoluteUrl(m.marketplaceProofUrl)}
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>

      <ConfirmModal
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        onConfirm={() => confirmId && remove(confirmId)}
        loading={busyId !== null}
        title="Hapus mutasi ini?"
        description={
          target
            ? `Pencairan ${shopName(target.shopId)} sebesar ${rupiah(target.creditAmount)} akan dihapus dari batch ini.`
            : ""
        }
      />
    </>
  );
}

/* ------------------------------------------------------- transfer rekap */
//
// Sedekah is transferred ONCE per batch (a single consolidated row, not one
// per shop) — that row has payoutMutationId null and is rendered as its own
// card, separate from the per-shop groups below. Batches closed BEFORE this
// change still have their old per-mutation sedekah rows in the database
// (each with a payoutMutationId) — those are left exactly where they were,
// grouped alongside that shop's other transfers, so historical batches don't
// lose data from view. "Consolidated" is detected as exactly one sedekah row
// with no mutation link; anything else falls back to the old per-shop path.

interface Carryover {
  name: string;
  type: string;
  amount: number;
  ids: string[];
  since: string;
}

function DisbursementRekap({
  batch,
  shops,
  onChange,
}: {
  batch: BatchDetail;
  shops: ShopOpt[];
  onChange: () => void;
}) {
  const [showDone, setShowDone] = useState(false);
  const toast = useToast();
  const held = useFetch<Carryover[]>("/payout/carryovers");
  const [releasing, setReleasing] = useState<string | null>(null);

  /**
   * Send a held amount now regardless of the minimum.
   *
   * Deliberately per recipient rather than a single "release everything":
   * paying out a balance below the bank's floor is a decision about one
   * person's money, usually because they have stopped selling, and it should
   * not happen to three other people as a side effect.
   */
  async function release(c: Carryover) {
    if (
      !window.confirm(
        `Cairkan sisa ${c.name} sebesar ${rupiah(c.amount)} sekarang?\n\n` +
          "Nominalnya di bawah minimum transfer, jadi bank mungkin menolak. " +
          "Pakai ini kalau kamu memang akan mentransfernya dengan cara lain.",
      )
    ) {
      return;
    }
    setReleasing(c.name);
    try {
      await api.post(`/payout/batches/${batch.id}/release-carryovers`, { ids: c.ids });
      toast(`Sisa ${c.name} masuk ke daftar transfer batch ini.`, "success");
      held.reload();
      onChange();
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setReleasing(null);
    }
  }

  /**
   * Transfers that cover the whole batch rather than one shop.
   *
   * Detected by having no mutation to belong to, which is what "consolidated"
   * actually means here — rather than by naming sedekah, as this did when
   * sedekah was the only one. The material reserve is the second, and anything
   * later gets its card for free.
   */
  const consolidated = useMemo(
    () => batch.disbursements.filter((d) => d.payoutMutationId == null),
    [batch.disbursements],
  );

  const groups = useMemo(() => {
    const byMutation = new Map<string, Disbursement[]>();
    for (const d of batch.disbursements) {
      if (!d.payoutMutationId) continue;
      const arr = byMutation.get(d.payoutMutationId) ?? [];
      arr.push(d);
      byMutation.set(d.payoutMutationId, arr);
    }
    return [...byMutation.entries()];
  }, [batch.disbursements]);

  /**
   * Why this step's total is not the header's total.
   *
   * The header adds up what was CALCULATED for every shop. This step lists
   * what will actually be TRANSFERRED now, and amounts under the minimum
   * transfer wait for the next batch instead. Two totals disagreeing with
   * nothing to account for the gap reads as a broken sum — it was reported as
   * one — so the arithmetic is spelled out rather than left to be guessed.
   */
  const rekonsiliasi = useMemo(() => {
    const dihitung = batch.mutations.reduce(
      (n, m) =>
        n +
        (Number(m.sedekahAmount) || 0) +
        (Number(m.subSellerAmount) || 0) +
        (Number(m.subSubSellerAmount) || 0) +
        (Number(m.sellerMaterialAmount) || 0),
      0,
    );
    const ditahan = (batch.carryovers?.held ?? []).reduce((n, c) => n + c.amount, 0);
    const dibawa = (batch.carryovers?.applied ?? []).reduce((n, c) => n + c.amount, 0);
    const ditransfer = batch.disbursements.reduce(
      (n, d) => n + (Number(d.expectedAmount) || 0),
      0,
    );
    return {
      dihitung,
      ditahan,
      dibawa,
      ditransfer,
      // If this is not zero the explanation is incomplete, and saying so beats
      // showing a tidy panel that quietly does not add up.
      sisa: Math.round((dihitung - ditahan + dibawa - ditransfer) * 100) / 100,
    };
  }, [batch.mutations, batch.carryovers, batch.disbursements]);


  const all = batch.disbursements;
  const doneCount = all.filter((d) => READY.includes(d.validationStatus)).length;
  const pct = all.length ? Math.round((doneCount / all.length) * 100) : 0;
  const totalToTransfer = all.reduce((n, d) => n + (Number(d.expectedAmount) || 0), 0);

  // Split each group into outstanding vs finished so "what still needs doing"
  // is never buried among rows that are already validated.
  const isDone = (d: Disbursement) => READY.includes(d.validationStatus);
  const pendingGroups = groups
    .map(([id, rows]) => [id, rows.filter((r) => !isDone(r))] as const)
    .filter(([, rows]) => rows.length > 0);
  const doneGroups = groups
    .map(([id, rows]) => [id, rows.filter(isDone)] as const)
    .filter(([, rows]) => rows.length > 0);


  return (
    <div className="space-y-4">
      {/* Progress — the answer to "mana yang sudah / belum". */}
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-ink">Progres Transfer</div>
            <div className="text-xs text-ink-2 mt-0.5">
              {doneCount} dari {all.length} transfer sudah tervalidasi · total{" "}
              <span className="tabular-nums">{rupiah(totalToTransfer)}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-2xl text-ink tabular-nums">{pct}%</div>
          </div>
        </div>
        {/* The arithmetic behind the two totals, because they legitimately
            differ and nothing on the page used to say why. Rendered whenever
            anything was held or brought forward — when neither happened the
            two totals agree and a panel explaining nothing is just noise. */}
        {(rekonsiliasi.ditahan > 0 ||
          rekonsiliasi.dibawa > 0 ||
          Math.abs(rekonsiliasi.sisa) > 0.01) && (
          <div className="mt-3 rounded-lg border border-line p-3">
            <div className="text-xs font-medium text-ink-2">
              Kenapa total di sini beda dengan di atas
            </div>
            <dl className="mt-2 space-y-1 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-ink-2">Dihitung untuk semua toko</dt>
                <dd className="tabular-nums text-ink">{rupiah(rekonsiliasi.dihitung)}</dd>
              </div>
              {rekonsiliasi.ditahan > 0 && (
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-2">
                    Ditahan — di bawah batas transfer minimum
                  </dt>
                  <dd className="tabular-nums text-red-600">
                    −{rupiah(rekonsiliasi.ditahan)}
                  </dd>
                </div>
              )}
              {rekonsiliasi.dibawa > 0 && (
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-2">Dibawa dari batch sebelumnya</dt>
                  <dd className="tabular-nums text-emerald-600">
                    +{rupiah(rekonsiliasi.dibawa)}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-2 border-t border-line pt-1">
                <dt className="font-medium text-ink">Ditransfer sekarang</dt>
                <dd className="font-medium tabular-nums text-ink">
                  {rupiah(rekonsiliasi.ditransfer)}
                </dd>
              </div>
            </dl>

            {batch.carryovers?.held?.length ? (
              <div className="mt-2 text-[11px] text-ink-3">
                Menunggu batch berikutnya:{" "}
                {batch.carryovers.held
                  .map((c) => `${c.name} ${rupiah(c.amount)}`)
                  .join(" · ")}
                . Uangnya tidak hilang — ikut ditransfer begitu jumlahnya melewati
                batas minimum.
              </div>
            ) : null}

            {/* If the explanation does not close, say so rather than show a
                tidy panel that quietly does not add up. */}
            {Math.abs(rekonsiliasi.sisa) > 0.01 && (
              <div className="mt-2 text-[11px] text-red-600">
                Masih ada selisih {rupiah(Math.abs(rekonsiliasi.sisa))} yang belum
                terjelaskan oleh penahanan maupun bawaan — laporkan ini, jangan
                dianggap wajar.
              </div>
            )}
          </div>
        )}

        <div className="mt-3 h-1.5 rounded-full bg-line overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              pct === 100 ? "bg-emerald-500" : "bg-brand"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </Card>

      {(held.data?.length ?? 0) > 0 && (
        <Card padded={false}>
          <CardHeader
            title="Sisa Tertahan"
            subtitle="Di bawah minimum transfer, jadi belum dibuatkan transfer. Otomatis ikut batch berikutnya."
          />
          <ul className="divide-y divide-line">
            {(held.data ?? []).map((c) => (
              <li key={c.name} className="px-5 py-3 flex flex-wrap items-center gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-ink">{c.name}</div>
                  <div className="text-[11px] text-ink-3">
                    tertahan sejak {dateShort(c.since)}
                  </div>
                </div>
                <div className="ml-auto text-sm text-ink tabular-nums">{rupiah(c.amount)}</div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => release(c)}
                  disabled={releasing !== null || batch.status !== "siap_distribusi"}
                >
                  Cairkan sekarang
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {consolidated.map((d) => (
        <Card padded={false} key={d.id}>
          <CardHeader
            title={RECIPIENT_LABEL[d.recipientType]}
            subtitle={
              d.recipientType === "bahan_baku"
                ? `Gabungan ${batch.mutations.length} toko — porsi bahan baku dari bagian seller`
                : `Gabungan ${batch.mutations.length} toko — cukup 1 transfer`
            }
            action={
              isDone(d) ? (
                <Badge tone="success" icon="check">
                  Selesai
                </Badge>
              ) : (
                <Badge tone="warning">Belum</Badge>
              )
            }
          />
          <div className="p-4">
            <DisbursementRow d={d} onChange={onChange} />
            <ShopBreakdown batch={batch} shops={shops} d={d} />
          </div>
        </Card>
      ))}

      {(pendingGroups.length > 0 || doneGroups.length > 0) && (
      <Card padded={false}>
        <CardHeader
          title="Perlu Ditransfer"
          subtitle={
            pendingGroups.length
              ? `${pendingGroups.reduce((n, [, r]) => n + r.length, 0)} transfer dari ${pendingGroups.length} toko`
              : undefined
          }
        />
        {!pendingGroups.length ? (
          <EmptyState
            icon="checkCircle"
            title="Semua transfer sudah tervalidasi"
            description="Tidak ada transfer sub-seller yang tersisa untuk batch ini."
          />
        ) : (
          <ul className="divide-y divide-line">
            {pendingGroups.map(([mutationId, rows]) => (
              <li key={mutationId} className="px-5 py-4">
                <div className="text-sm font-medium text-ink mb-3">
                  {rows[0]!.shopName}{" "}
                  <span className="text-xs text-ink-3 font-normal">({rows[0]!.marketplace})</span>
                </div>
                <div className="space-y-3">
                  {rows.map((d) => (
                    <DisbursementRow key={d.id} d={d} onChange={onChange} />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      )}

      {doneGroups.length > 0 && (
        <Card padded={false}>
          <button
            onClick={() => setShowDone((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-canvas transition"
          >
            <span className="text-sm font-medium text-ink">
              Sudah Selesai ({doneGroups.reduce((n, [, r]) => n + r.length, 0)})
            </span>
            <Icon name={showDone ? "chevronDown" : "chevronRight"} size={16} className="text-ink-3" />
          </button>
          {showDone && (
            <ul className="divide-y divide-line border-t border-line">
              {doneGroups.map(([mutationId, rows]) => (
                <li key={mutationId} className="px-5 py-4">
                  <div className="text-sm font-medium text-ink mb-3">
                    {rows[0]!.shopName}{" "}
                    <span className="text-xs text-ink-3 font-normal">({rows[0]!.marketplace})</span>
                  </div>
                  <div className="space-y-3">
                    {rows.map((d) => (
                      <DisbursementRow key={d.id} d={d} onChange={onChange} />
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

/**
 * Which shops make up one consolidated transfer, and how much of it was held
 * over from before.
 *
 * A sub-seller's transfer is now one figure covering every shop of theirs in
 * the batch. Without the breakdown that figure cannot be checked against
 * anything, and a number nobody can check is a number nobody trusts.
 */
function ShopBreakdown({
  batch,
  shops,
  d,
}: {
  batch: BatchDetail;
  shops: ShopOpt[];
  d: Disbursement;
}) {
  // Falls back to a short id: a shop deleted since the batch closed still has
  // a line here, and showing nothing would make the figures stop adding up.
  const nameOf = (id: string) => shops.find((s) => s.id === id)?.shopName ?? id.slice(0, 8);
  const carried = Number(d.carryoverAmount) || 0;
  const rows =
    d.recipientType === "sub_seller" || d.recipientType === "sub_sub_seller"
      ? batch.mutations
          .filter((m) =>
            d.recipientType === "sub_seller"
              ? m.subSellerId === d.recipientSubSellerId
              : m.subSubSellerId === d.recipientSubSubSellerId,
          )
          .map((m) => ({
            id: m.id,
            shopId: m.shopId,
            amount:
              Number(
                d.recipientType === "sub_seller" ? m.subSellerAmount : m.subSubSellerAmount,
              ) || 0,
          }))
          .filter((r) => r.amount > 0)
      : [];

  if (!rows.length && carried <= 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-line text-[11px] text-ink-2 space-y-1">
      {rows.map((r) => (
        <div key={r.id} className="flex justify-between gap-3">
          <span className="truncate">{nameOf(r.shopId)}</span>
          <span className="tabular-nums">{rupiah(r.amount)}</span>
        </div>
      ))}
      {carried > 0 && (
        <div className="flex justify-between gap-3 text-ink-3">
          <span>sisa batch sebelumnya</span>
          <span className="tabular-nums">{rupiah(carried)}</span>
        </div>
      )}
    </div>
  );
}

const RECIPIENT_LABEL: Record<Disbursement["recipientType"], string> = {
  sedekah: "Sedekah",
  sub_seller: "Sub-seller",
  sub_sub_seller: "Sub-sub-seller",
  bahan_baku: "Bahan Baku",
};
const VALIDATION_TONE: Record<ValidationStatus, "neutral" | "success" | "danger" | "info"> = {
  belum_upload: "neutral",
  cocok_otomatis: "success",
  tidak_cocok: "danger",
  override_manual: "info",
};
const VALIDATION_LABEL: Record<ValidationStatus, string> = {
  belum_upload: "Belum Upload",
  cocok_otomatis: "Cocok Otomatis",
  tidak_cocok: "Tidak Cocok",
  override_manual: "Override Manual",
};

function DisbursementRow({ d, onChange }: { d: Disbursement; onChange: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showOverride, setShowOverride] = useState(false);
  const [reason, setReason] = useState("");

  async function uploadProof(url: string) {
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/payout/disbursements/${d.id}/proof`, { proofUrl: url });
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function override() {
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/payout/disbursements/${d.id}/override`, { reason });
      setShowOverride(false);
      setReason("");
      toast("Transfer di-override manual", "success");
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-ink">{RECIPIENT_LABEL[d.recipientType]}</span>
            {d.recipientChain && <span className="text-sm text-ink-2">({d.recipientChain})</span>}
            {!d.recipientChain &&
              d.recipientType !== "sedekah" &&
              d.recipientType !== "bahan_baku" && (
              <span className="text-sm text-ink-2">({d.recipientName})</span>
            )}
            <Badge
              tone={VALIDATION_TONE[d.validationStatus]}
              icon={
                d.validationStatus === "cocok_otomatis" || d.validationStatus === "override_manual"
                  ? "check"
                  : d.validationStatus === "tidak_cocok"
                    ? "warning"
                    : undefined
              }
            >
              {VALIDATION_LABEL[d.validationStatus]}
            </Badge>
          </div>
          <div className="text-xs text-ink-2 mt-1.5">
            Rekening tujuan: <span className="font-mono text-ink">{d.recordedAccount ?? "-"}</span>
          </div>
        </div>
        <div className="text-base text-ink tabular-nums shrink-0">{rupiah(d.expectedAmount)}</div>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <FileUpload label="Bukti Transfer" value={d.proofUrl ?? ""} onChange={uploadProof} />
        {busy && <Icon name="refresh" size={14} className="animate-spin text-ink-3 mb-2" />}
        {d.validationStatus === "tidak_cocok" && !showOverride && (
          <Button size="sm" variant="outline" onClick={() => setShowOverride(true)}>
            Override Manual
          </Button>
        )}
      </div>

      {d.validationStatus === "tidak_cocok" && (
        <div className="mt-3">
          {(() => {
            // Dipisah supaya jelas apa yang gagal. Nominal dibandingkan dalam
            // rupiah bulat, sama seperti di server -- kalau tidak, pesannya
            // bisa menunjuk nominal yang di layar terlihat sama persis.
            const nominalCocok =
              d.ocrAmount != null &&
              Math.round(Number(d.ocrAmount)) === Math.round(Number(d.expectedAmount));
            const ekor = (d.recordedAccount ?? "").replace(/\D/g, "").slice(-4);
            return (
              <InlineAlert tone="danger">
                {!nominalCocok ? (
                  <>
                    <strong>Nominalnya berbeda.</strong> Struk terbaca{" "}
                    {d.ocrAmount ? rupiah(d.ocrAmount) : "(tidak terbaca)"}, seharusnya{" "}
                    {rupiah(d.expectedAmount)}.
                  </>
                ) : (
                  <>
                    <strong>Nominalnya cocok, rekeningnya yang belum terbukti.</strong>{" "}
                    Struk tidak memuat nama bank beserta 4 angka terakhir
                    {ekor ? ` (${ekor})` : ""} dari {d.recordedAccount ?? "rekening tujuan"}.
                    {d.ocrAccount ? ` Yang terbaca: ${d.ocrAccount}.` : ""}
                  </>
                )}
                <div className="mt-1 text-[11px]">
                  Kalau transfernya memang benar, pakai Override dan tulis alasannya —
                  jangan diunggah ulang berkali-kali.
                </div>
              </InlineAlert>
            );
          })()}
        </div>
      )}
      {d.validationStatus === "override_manual" && d.overrideReason && (
        <div className="text-xs text-ink-2 mt-2">Alasan override: {d.overrideReason}</div>
      )}

      {showOverride && (
        <div className="mt-3 flex flex-wrap gap-2 items-center">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Alasan override (wajib)"
            className="flex-1 min-w-[200px]"
          />
          <Button size="sm" variant="filled" loading={busy} disabled={!reason.trim()} onClick={override}>
            Konfirmasi
          </Button>
          <Button size="sm" variant="text" onClick={() => setShowOverride(false)}>
            Batal
          </Button>
        </div>
      )}

      {err && (
        <div className="mt-2">
          <InlineAlert tone="danger">{err}</InlineAlert>
        </div>
      )}
    </div>
  );
}
