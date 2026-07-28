import { useMemo, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { calculatePayoutSplit, type SedekahBasis } from "@autotoko/shared";
import { Layout } from "../components/Layout";
import { FileUpload } from "../components/FileUpload";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";
import { rupiah, dateShort } from "../lib/fmt";

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
  subSellerAmount: string | null;
  subSubSellerAmount: string | null;
}
type ValidationStatus = "belum_upload" | "cocok_otomatis" | "tidak_cocok" | "override_manual";
interface Disbursement {
  id: string;
  payoutMutationId: string;
  shopName: string;
  marketplace: string;
  recipientType: "sedekah" | "sub_seller" | "sub_sub_seller";
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
  mutations: Mutation[];
  disbursements: Disbursement[];
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

export function PencairanBatch() {
  const { id } = useParams<{ id: string }>();
  const { data: batch, loading, reload } = useFetch<BatchDetail>(id ? `/payout/batches/${id}` : null);
  const { data: shops } = useFetch<ShopOpt[]>("/payout/shops");
  const { data: settings } = useFetch<Settings>("/payout/settings");

  return (
    <Layout title="Detail Batch Pencairan">
      <Link to="/pencairan" className="text-xs text-brand font-semibold hover:underline">← Kembali ke daftar batch</Link>
      {loading || !batch ? (
        <div className="text-slate-400 text-sm mt-4">Memuat…</div>
      ) : (
        <div className="mt-3 space-y-4">
          <BatchHeader batch={batch} onDone={reload} />
          {batch.status === "berjalan" && shops && settings && (
            <>
              <MutationForm batchId={batch.id} shops={shops} settings={settings} onCreated={reload} />
              <MutationList batch={batch} shops={shops} onChange={reload} />
            </>
          )}
          {batch.status !== "berjalan" && <DisbursementRekap batch={batch} onChange={reload} />}
        </div>
      )}
    </Layout>
  );
}

function BatchHeader({ batch, onDone }: { batch: BatchDetail; onDone: () => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setErr(null);
    try { await fn(); onDone(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function cancelBatch() {
    if (!confirm("Batalkan batch ini? Semua mutasi & rekap transfer di dalamnya akan terhapus permanen dan tidak bisa dikembalikan.")) return;
    setBusy(true); setErr(null);
    try {
      await api.del(`/payout/batches/${batch.id}`);
      navigate("/pencairan");
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  const notReady = batch.disbursements.filter((d) => !READY.includes(d.validationStatus));

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Status Batch</div>
          <div className="text-lg font-extrabold">
            {batch.status === "berjalan" && "Berjalan — input pencairan per toko"}
            {batch.status === "siap_distribusi" && "Siap Distribusi — transfer & upload bukti per penerima"}
            {batch.status === "selesai" && "✓ Selesai"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {batch.status === "berjalan" && (
            <button
              onClick={() => run(() => api.post(`/payout/batches/${batch.id}/close-input`))}
              disabled={busy || batch.mutations.length === 0}
              title={batch.mutations.length === 0 ? "Rekam minimal satu toko dulu" : ""}
              className="px-3 py-2 rounded-md bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold disabled:opacity-50"
            >
              Selesai Pencairan Semua Toko →
            </button>
          )}
          {batch.status === "siap_distribusi" && (
            <button
              onClick={() => run(() => api.post(`/payout/batches/${batch.id}/close`))}
              disabled={busy || notReady.length > 0}
              title={notReady.length > 0 ? `${notReady.length} transfer belum tervalidasi/di-override` : ""}
              className="px-3 py-2 rounded-md bg-green-600 hover:bg-green-700 text-white text-sm font-semibold disabled:opacity-50"
            >
              {notReady.length > 0 ? `Tutup Batch (${notReady.length} belum siap)` : "Tutup Batch"}
            </button>
          )}
          {batch.status !== "selesai" && (
            <button
              onClick={cancelBatch}
              disabled={busy}
              className="px-3 py-2 rounded-md border border-red-300 text-red-600 hover:bg-red-50 text-sm font-semibold disabled:opacity-50"
            >
              Batalkan Batch
            </button>
          )}
        </div>
      </div>
      {err && <div className="text-red-500 text-xs mt-2">{err}</div>}
    </div>
  );
}

function MutationForm({
  batchId, shops, settings, onCreated,
}: { batchId: string; shops: ShopOpt[]; settings: Settings; onCreated: () => void }) {
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
      });
    } catch { return null; }
  }, [shop, amountNum, settings]);

  // Titik 1 OCR: after the pencairan screenshot is uploaded, ask the server to
  // read it and suggest values — staff can still edit anything before submit.
  async function onProofUploaded(url: string) {
    setProofUrl(url);
    setOcrBusy(true);
    setOcrNote(null);
    try {
      const result = await api.post<{ amount: number | null; account: string | null }>(
        "/payout/ocr/extract-pencairan",
        { imageUrl: url },
      );
      if (result.amount != null) {
        setProofAmount(String(result.amount));
        setOcrSuggestedAmount(result.amount);
      }
      if (result.account != null) setReceiving(result.account);
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
    setBusy(true); setErr(null);
    try {
      await api.post("/payout/mutations", {
        batchId, shopId, payoutDate,
        marketplaceProofAmount: amountNum,
        ...(ocrSuggestedAmount != null ? { ocrSuggestedAmount } : {}),
        ...(receiving ? { receivingAccount: receiving } : {}),
        ...(proofUrl ? { marketplaceProofUrl: proofUrl } : {}),
        ...(note ? { note } : {}),
      });
      setShopId(""); setProofAmount(""); setOcrSuggestedAmount(null); setReceiving("");
      setProofUrl(""); setNote(""); setOcrNote(null);
      onCreated();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="font-bold text-sm mb-3">Rekam Pencairan Toko</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-xs font-semibold text-slate-600">
          Toko
          <select value={shopId} onChange={(e) => setShopId(e.target.value)} required
            className="mt-1 w-full px-2 py-2 rounded-md border border-slate-300 text-sm font-normal">
            <option value="">— pilih toko —</option>
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.shopName} ({s.marketplace}) · Skenario {s.scenario}
                {s.subSellerName ? ` · ${s.subSellerName}` : ""}
                {s.subSubSellerName ? ` › ${s.subSubSellerName}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">
          Tanggal Pencairan
          <input type="date" value={payoutDate} onChange={(e) => setPayoutDate(e.target.value)} required
            className="mt-1 w-full px-2 py-2 rounded-md border border-slate-300 text-sm font-normal" />
        </label>

        <div className="md:col-span-2">
          <FileUpload label="Bukti Pencairan Marketplace (unggah dulu — nominal & rekening akan dicoba dibaca otomatis)" value={proofUrl} onChange={onProofUploaded} />
          {ocrBusy && <div className="text-[11px] text-slate-400 mt-1">Membaca gambar…</div>}
          {ocrNote && <div className="text-[11px] text-brand mt-1">{ocrNote}</div>}
        </div>

        <label className="text-xs font-semibold text-slate-600">
          Nominal Bukti Marketplace (dasar kalkulasi)
          <input inputMode="numeric" value={proofAmount ? Number(proofAmount).toLocaleString("id-ID") : ""}
            onChange={(e) => setProofAmount(e.target.value.replace(/\D/g, ""))} placeholder="0" required
            className="mt-1 w-full px-2 py-2 rounded-md border border-slate-300 text-sm font-normal" />
          {ocrSuggestedAmount != null && Number(proofAmount) !== ocrSuggestedAmount && (
            <span className="block text-[11px] text-amber-600 font-normal mt-0.5">
              Dikoreksi dari hasil OCR ({rupiah(ocrSuggestedAmount)})
            </span>
          )}
        </label>
        <label className="text-xs font-semibold text-slate-600">
          Rekening Penampung
          <input value={receiving} onChange={(e) => setReceiving(e.target.value)}
            className="mt-1 w-full px-2 py-2 rounded-md border border-slate-300 text-sm font-normal" />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          Catatan (opsional)
          <input value={note} onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full px-2 py-2 rounded-md border border-slate-300 text-sm font-normal" />
        </label>
      </div>

      {split && shop && (
        <div className="mt-3 rounded-lg bg-slate-50 border border-slate-200 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-2">
            Kalkulasi Split (real-time · Skenario {split.scenario})
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <SplitCell label="Sedekah" value={split.sedekahCents} />
            <SplitCell label="Seller" value={split.sellerCents} />
            {split.subSellerCents > 0 && <SplitCell label={`Sub-seller${shop.subSellerName ? ` (${shop.subSellerName})` : ""}`} value={split.subSellerCents} />}
            {split.subSubSellerCents > 0 && <SplitCell label={`Sub-sub-seller${shop.subSubSellerName ? ` (${shop.subSubSellerName})` : ""}`} value={split.subSubSellerCents} />}
          </div>
        </div>
      )}

      {err && <div className="text-red-500 text-xs mt-2">{err}</div>}
      <div className="mt-3">
        <button disabled={busy || !shopId || amountNum <= 0}
          className="px-4 py-2 rounded-md bg-brand hover:bg-brand-dark text-white text-sm font-semibold disabled:opacity-50">
          {busy ? "…" : "Simpan Pencairan Toko Ini"}
        </button>
        <span className="text-[11px] text-slate-400 ml-3">Ulangi untuk toko lain sesuai kebutuhan — tidak wajib semua toko.</span>
      </div>
    </form>
  );
}

function SplitCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white rounded-md border border-slate-200 px-3 py-2">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className="font-bold">{rupiah(value / 100)}</div>
    </div>
  );
}

function MutationList({ batch, shops, onChange }: { batch: BatchDetail; shops: ShopOpt[]; onChange: () => void }) {
  const shopName = (id: string) => shops.find((s) => s.id === id)?.shopName ?? id.slice(0, 8);
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
        return acc;
      },
      { credit: 0, sedekah: 0, seller: 0, subSeller: 0, subSubSeller: 0 },
    );
  }, [batch.mutations]);

  async function remove(id: string) {
    setBusyId(id);
    try { await api.del(`/payout/mutations/${id}`); onChange(); } finally { setBusyId(null); }
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
    downloadBlob(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), `rekap-pencairan-${batch.id.slice(0, 8)}.csv`);
  }

  async function downloadPng() {
    if (!captureRef.current) return;
    setPngBusy(true);
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(captureRef.current, { backgroundColor: "#ffffff", scale: 2 });
      await new Promise<void>((resolve) => {
        canvas.toBlob((blob) => {
          if (blob) downloadBlob(blob, `rekap-pencairan-${batch.id.slice(0, 8)}.png`);
          resolve();
        });
      });
    } finally {
      setPngBusy(false);
    }
  }

  function shareWhatsApp() {
    const lines = [
      `*Rekap Pencairan* (${batch.mutations.length} toko)`,
      `Total Kredit: ${rupiah(totals.credit)}`,
      `Sedekah: ${rupiah(totals.sedekah)}`,
      `Seller: ${rupiah(totals.seller)}`,
    ];
    if (totals.subSeller > 0) lines.push(`Sub-seller: ${rupiah(totals.subSeller)}`);
    if (totals.subSubSeller > 0) lines.push(`Sub-sub-seller: ${rupiah(totals.subSubSeller)}`);
    lines.push("", "Detail Toko:");
    batch.mutations.forEach((m, i) => {
      const shop = shops.find((s) => s.id === m.shopId);
      const subAmt = Number(m.subSellerAmount) || 0;
      let line = `${i + 1}. ${shopName(m.shopId)} - ${rupiah(m.creditAmount)}`;
      if (subAmt > 0) line += ` (Sub-seller${shop?.subSellerName ? ` ${shop.subSellerName}` : ""}: ${rupiah(subAmt)})`;
      lines.push(line);
      if (m.marketplaceProofUrl) lines.push(absoluteUrl(m.marketplaceProofUrl));
    });
    window.open(`https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
        <span className="font-bold text-sm">Toko Sudah Direkam ({batch.mutations.length})</span>
        {batch.mutations.length > 0 && (
          <div className="flex items-center gap-2">
            <button onClick={downloadExcel}
              className="text-xs px-2.5 py-1.5 rounded-md border border-slate-300 hover:bg-slate-50 text-slate-600 font-semibold">
              ⬇ Excel
            </button>
            <button onClick={downloadPng} disabled={pngBusy}
              className="text-xs px-2.5 py-1.5 rounded-md border border-slate-300 hover:bg-slate-50 text-slate-600 font-semibold disabled:opacity-50">
              {pngBusy ? "…" : "⬇ PNG"}
            </button>
            <button onClick={shareWhatsApp}
              className="text-xs px-2.5 py-1.5 rounded-md bg-green-600 hover:bg-green-700 text-white font-semibold">
              Share WhatsApp
            </button>
          </div>
        )}
      </div>
      <div ref={captureRef}>
        {batch.mutations.length > 0 && (
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
            <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-2">
              Ringkasan Total ({batch.mutations.length} toko)
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
              <SplitCell label="Total Kredit" value={cents(totals.credit)} />
              <SplitCell label="Sedekah" value={cents(totals.sedekah)} />
              <SplitCell label="Seller" value={cents(totals.seller)} />
              {totals.subSeller > 0 && <SplitCell label="Sub-seller" value={cents(totals.subSeller)} />}
              {totals.subSubSeller > 0 && <SplitCell label="Sub-sub-seller" value={cents(totals.subSubSeller)} />}
            </div>
          </div>
        )}
        {!batch.mutations.length ? (
          <div className="px-4 py-6 text-center text-slate-400 text-sm">Belum ada. Rekam lewat form di atas.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {batch.mutations.map((m) => {
              const shop = shops.find((s) => s.id === m.shopId);
              const subSellerAmt = Number(m.subSellerAmount) || 0;
              const subSubSellerAmt = Number(m.subSubSellerAmount) || 0;
              return (
                <div key={m.id} className="px-4 py-2 flex items-center justify-between flex-wrap gap-y-1">
                  <div>
                    <div>
                      <span className="font-semibold text-sm">{shopName(m.shopId)}</span>
                      <span className="text-xs text-slate-400 ml-2">{dateShort(m.payoutDate)}</span>
                      <span className="text-xs text-slate-500 ml-2">{rupiah(m.creditAmount)}</span>
                    </div>
                    {m.marketplaceProofUrl && (
                      <a href={absoluteUrl(m.marketplaceProofUrl)} target="_blank" rel="noreferrer"
                        className="text-[11px] text-brand hover:underline break-all">
                        {absoluteUrl(m.marketplaceProofUrl)}
                      </a>
                    )}
                    {(subSellerAmt > 0 || subSubSellerAmt > 0) && (
                      <div className="text-[11px] text-violet-600 mt-0.5">
                        {subSellerAmt > 0 && (
                          <span>
                            Sub-seller{shop?.subSellerName ? ` (${shop.subSellerName})` : ""}
                            {shop?.effectiveSubSellerRate != null ? ` · ${(shop.effectiveSubSellerRate * 100).toFixed(1)}%` : ""}: {rupiah(subSellerAmt)}
                          </span>
                        )}
                        {subSellerAmt > 0 && subSubSellerAmt > 0 && <span className="mx-1.5">·</span>}
                        {subSubSellerAmt > 0 && (
                          <span>
                            Sub-sub-seller{shop?.subSubSellerName ? ` (${shop.subSubSellerName})` : ""}
                            {shop?.effectiveSubSubSellerRate != null ? ` · ${(shop.effectiveSubSubSellerRate * 100).toFixed(1)}%` : ""}: {rupiah(subSubSellerAmt)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <button onClick={() => remove(m.id)} disabled={busyId === m.id}
                    className="text-xs px-2 py-1 rounded bg-red-100 hover:bg-red-200 text-red-700 font-semibold disabled:opacity-50">
                    Hapus
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Tahap 2/3: rekap transfer per penerima, grouped by shop/mutation ---

function DisbursementRekap({ batch, onChange }: { batch: BatchDetail; onChange: () => void }) {
  const groups = useMemo(() => {
    const byMutation = new Map<string, Disbursement[]>();
    for (const d of batch.disbursements) {
      const arr = byMutation.get(d.payoutMutationId) ?? [];
      arr.push(d);
      byMutation.set(d.payoutMutationId, arr);
    }
    return [...byMutation.entries()];
  }, [batch.disbursements]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 font-bold text-sm">
        Rekap Transfer per Toko ({groups.length} toko, {batch.disbursements.length} transfer)
      </div>
      {!groups.length ? (
        <div className="px-4 py-6 text-center text-slate-400 text-sm">Tidak ada transfer yang perlu dilakukan.</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {groups.map(([mutationId, rows]) => (
            <div key={mutationId} className="px-4 py-3">
              <div className="font-semibold text-sm mb-2">{rows[0]!.shopName} <span className="text-xs text-slate-400 font-normal">({rows[0]!.marketplace})</span></div>
              <div className="space-y-2">
                {rows.map((d) => <DisbursementRow key={d.id} d={d} onChange={onChange} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const RECIPIENT_LABEL: Record<Disbursement["recipientType"], string> = {
  sedekah: "Sedekah",
  sub_seller: "Sub-seller",
  sub_sub_seller: "Sub-sub-seller",
};
const VALIDATION_BADGE: Record<ValidationStatus, string> = {
  belum_upload: "bg-slate-100 text-slate-500",
  cocok_otomatis: "bg-green-100 text-green-700",
  tidak_cocok: "bg-red-100 text-red-700",
  override_manual: "bg-violet-100 text-violet-700",
};
const VALIDATION_LABEL: Record<ValidationStatus, string> = {
  belum_upload: "Belum Upload",
  cocok_otomatis: "✓ Cocok Otomatis",
  tidak_cocok: "✗ Tidak Cocok",
  override_manual: "✓ Override Manual",
};

function DisbursementRow({ d, onChange }: { d: Disbursement; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showOverride, setShowOverride] = useState(false);
  const [reason, setReason] = useState("");

  async function uploadProof(url: string) {
    setBusy(true); setErr(null);
    try {
      await api.post(`/payout/disbursements/${d.id}/proof`, { proofUrl: url });
      onChange();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function override() {
    setBusy(true); setErr(null);
    try {
      await api.post(`/payout/disbursements/${d.id}/override`, { reason });
      setShowOverride(false); setReason("");
      onChange();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="text-xs font-bold">{RECIPIENT_LABEL[d.recipientType]}</span>
          {d.recipientChain && <span className="text-xs text-slate-500 ml-1">({d.recipientChain})</span>}
          {!d.recipientChain && d.recipientType !== "sedekah" && <span className="text-xs text-slate-500 ml-1">({d.recipientName})</span>}
          <span className={`ml-2 text-[10px] font-semibold px-2 py-0.5 rounded ${VALIDATION_BADGE[d.validationStatus]}`}>
            {VALIDATION_LABEL[d.validationStatus]}
          </span>
        </div>
        <div className="text-sm font-bold">{rupiah(d.expectedAmount)}</div>
      </div>
      <div className="text-xs text-slate-500 mt-1">
        Rekening tujuan: <span className="font-mono">{d.recordedAccount ?? "-"}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-end gap-3">
        <FileUpload label="Bukti Transfer" value={d.proofUrl ?? ""} onChange={uploadProof} />
        {d.validationStatus === "tidak_cocok" && !showOverride && (
          <button onClick={() => setShowOverride(true)}
            className="text-xs px-3 py-1.5 rounded bg-violet-600 hover:bg-violet-700 text-white font-semibold">
            Override Manual
          </button>
        )}
      </div>

      {d.validationStatus === "tidak_cocok" && (
        <div className="mt-2 text-[11px] bg-red-50 border border-red-200 text-red-700 rounded-md px-2 py-1.5">
          OCR tidak cocok — hasil baca: {d.ocrAmount ? rupiah(d.ocrAmount) : "(nominal tak terbaca)"}
          {" · "}{d.ocrAccount ?? "(rekening tak terbaca)"}. Seharusnya {rupiah(d.expectedAmount)} ke {d.recordedAccount ?? "-"}.
        </div>
      )}
      {d.validationStatus === "override_manual" && d.overrideReason && (
        <div className="mt-2 text-[11px] text-violet-700">Alasan override: {d.overrideReason}</div>
      )}

      {showOverride && (
        <div className="mt-2 flex gap-2 items-center">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Alasan override (wajib)"
            className="flex-1 px-2 py-1.5 rounded-md border border-slate-300 text-xs" />
          <button onClick={override} disabled={busy || !reason.trim()}
            className="text-xs px-3 py-1.5 rounded bg-violet-600 hover:bg-violet-700 text-white font-semibold disabled:opacity-50">
            Konfirmasi
          </button>
        </div>
      )}
      {err && <div className="text-red-500 text-[11px] mt-1">{err}</div>}
    </div>
  );
}
