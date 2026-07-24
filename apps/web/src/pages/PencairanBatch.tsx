import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { calculatePayoutSplit, type SedekahBasis } from "@autotoko/shared";
import { Layout } from "../components/Layout";
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
  sedekahAmount: string;
  sellerAmount: string;
  subSellerAmount: string | null;
  subSubSellerAmount: string | null;
  status: "draft" | "completed";
  subSellerForwardStatus: "pending" | "forwarded" | null;
  subSubSellerForwardStatus: "pending" | "forwarded" | null;
  marketplaceProofUrl: string | null;
}
interface BatchDetail {
  id: string;
  status: "running" | "awaiting_transfer" | "transferred" | "completed";
  totalTransferToAdmin: string;
  transferProofUrl: string | null;
  mutations: Mutation[];
}

const cents = (rupiahVal: number) => Math.round(rupiahVal * 100);

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
          <BatchActions batch={batch} onDone={reload} />
          {batch.status === "running" && shops && settings && (
            <MutationForm batchId={batch.id} shops={shops} settings={settings} onCreated={reload} />
          )}
          <MutationList batch={batch} shops={shops ?? []} onChange={reload} />
        </div>
      )}
    </Layout>
  );
}

function BatchActions({ batch, onDone }: { batch: BatchDetail; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [proof, setProof] = useState("");

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setErr(null);
    try { await fn(); onDone(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Total perlu diteruskan ke sub-seller</div>
          <div className="text-2xl font-extrabold">{rupiah(batch.totalTransferToAdmin)}</div>
        </div>
        <div>
          {batch.status === "running" && (
            <button onClick={() => run(() => api.post(`/payout/batches/${batch.id}/close`))} disabled={busy}
              className="px-3 py-2 rounded-md bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold disabled:opacity-50">
              Tutup & Lapor ke Owner
            </button>
          )}
          {batch.status === "awaiting_transfer" && (
            <div className="flex gap-2 items-center">
              <input value={proof} onChange={(e) => setProof(e.target.value)} placeholder="URL bukti transfer ke Admin"
                className="px-2 py-2 rounded-md border border-slate-300 text-sm w-64" />
              <button onClick={() => run(() => api.post(`/payout/batches/${batch.id}/transferred`, { transferProofUrl: proof }))}
                disabled={busy || !proof}
                className="px-3 py-2 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50">
                Tandai Sudah Ditransfer
              </button>
            </div>
          )}
          {batch.status === "transferred" && (
            <span className="text-xs text-violet-700 font-semibold">Tandai tiap mutasi "Diteruskan" di bawah.</span>
          )}
          {batch.status === "completed" && (
            <span className="text-xs text-green-700 font-semibold">✓ Batch selesai</span>
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
  const [credit, setCredit] = useState("");
  const [proofAmount, setProofAmount] = useState("");
  const [receiving, setReceiving] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const shop = shops.find((s) => s.id === shopId);
  const creditNum = Number(credit) || 0;

  const split = useMemo(() => {
    if (!shop || creditNum <= 0) return null;
    try {
      return calculatePayoutSplit({
        creditCents: cents(creditNum),
        sedekahRate: Number(settings.sedekahRate),
        sedekahBasis: settings.sedekahBasis,
        subSellerRate: shop.effectiveSubSellerRate,
        subSubSellerRate: shop.effectiveSubSubSellerRate,
      });
    } catch { return null; }
  }, [shop, creditNum, settings]);

  const proofDiff = proofAmount !== "" && Number(proofAmount) !== creditNum;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.post("/payout/mutations", {
        batchId, shopId, payoutDate, creditAmount: creditNum,
        ...(proofAmount !== "" ? { marketplaceProofAmount: Number(proofAmount) } : {}),
        ...(receiving ? { receivingAccount: receiving } : {}),
        ...(proofUrl ? { marketplaceProofUrl: proofUrl } : {}),
        ...(note ? { note } : {}),
      });
      setShopId(""); setCredit(""); setProofAmount(""); setReceiving(""); setProofUrl(""); setNote("");
      onCreated();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="font-bold text-sm mb-3">Input Mutasi Pencairan</div>
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
        <label className="text-xs font-semibold text-slate-600">
          Nominal Kredit (dasar kalkulasi)
          <input inputMode="numeric" value={credit ? Number(credit).toLocaleString("id-ID") : ""}
            onChange={(e) => setCredit(e.target.value.replace(/\D/g, ""))} placeholder="0" required
            className="mt-1 w-full px-2 py-2 rounded-md border border-slate-300 text-sm font-normal" />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          Nominal Bukti Marketplace (opsional)
          <input inputMode="numeric" value={proofAmount ? Number(proofAmount).toLocaleString("id-ID") : ""}
            onChange={(e) => setProofAmount(e.target.value.replace(/\D/g, ""))} placeholder="samakan dengan kredit"
            className="mt-1 w-full px-2 py-2 rounded-md border border-slate-300 text-sm font-normal" />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          Rekening Penampung (opsional)
          <input value={receiving} onChange={(e) => setReceiving(e.target.value)}
            className="mt-1 w-full px-2 py-2 rounded-md border border-slate-300 text-sm font-normal" />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          URL Bukti Pencairan Marketplace (opsional saat draft)
          <input value={proofUrl} onChange={(e) => setProofUrl(e.target.value)} placeholder="ditempel dari upload"
            className="mt-1 w-full px-2 py-2 rounded-md border border-slate-300 text-sm font-normal" />
        </label>
      </div>

      {proofDiff && (
        <div className="mt-3 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-md px-3 py-2">
          ⚠️ Nominal bukti marketplace ({rupiah(Number(proofAmount))}) berbeda dari nominal kredit ({rupiah(creditNum)}).
          Selisih {rupiah(Math.abs(Number(proofAmount) - creditNum))}. Tetap bisa disimpan.
        </div>
      )}

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
          <div className="text-[11px] text-slate-400 mt-2">
            Total split {rupiah((split.sedekahCents + split.sellerCents + split.subSellerCents + split.subSubSellerCents) / 100)} = kredit {rupiah(creditNum)}
          </div>
        </div>
      )}

      {err && <div className="text-red-500 text-xs mt-2">{err}</div>}
      <div className="mt-3">
        <button disabled={busy || !shopId || creditNum <= 0}
          className="px-4 py-2 rounded-md bg-brand hover:bg-brand-dark text-white text-sm font-semibold disabled:opacity-50">
          {busy ? "…" : "Simpan sebagai Draft"}
        </button>
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
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 font-bold text-sm">Mutasi dalam Batch ({batch.mutations.length})</div>
      {!batch.mutations.length ? (
        <div className="px-4 py-6 text-center text-slate-400 text-sm">Belum ada mutasi. Tambahkan lewat form di atas.</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {batch.mutations.map((m) => (
            <MutationRow key={m.id} m={m} shopName={shopName(m.shopId)} batchStatus={batch.status} onChange={onChange} />
          ))}
        </div>
      )}
    </div>
  );
}

function MutationRow({
  m, shopName, batchStatus, onChange,
}: { m: Mutation; shopName: string; batchStatus: BatchDetail["status"]; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [proofs, setProofs] = useState({
    marketplaceProofUrl: m.marketplaceProofUrl ?? "",
    sedekahTransferProofUrl: "",
    subSellerTransferProofUrl: "",
    subSubSellerTransferProofUrl: "",
  });

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setErr(null);
    try { await fn(); onChange(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const needSub = Number(m.subSellerAmount ?? 0) > 0;
  const needSubSub = Number(m.subSubSellerAmount ?? 0) > 0;

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-semibold text-sm">{shopName}</span>
          <span className="text-xs text-slate-400 ml-2">{dateShort(m.payoutDate)}</span>
          <span className={`ml-2 text-[10px] font-semibold px-2 py-0.5 rounded ${m.status === "completed" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>
            {m.status === "completed" ? "Selesai" : "Draft"}
          </span>
          {m.subSellerForwardStatus === "forwarded" && (
            <span className="ml-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-green-100 text-green-700">Diteruskan</span>
          )}
        </div>
        <div className="text-sm font-bold">{rupiah(m.creditAmount)}</div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-slate-500">
        <span>Sedekah {rupiah(m.sedekahAmount)}</span>
        <span>Seller {rupiah(m.sellerAmount)}</span>
        {m.subSellerAmount != null && <span>Sub-seller {rupiah(m.subSellerAmount)}</span>}
        {m.subSubSellerAmount != null && <span>Sub-sub-seller {rupiah(m.subSubSellerAmount)}</span>}
      </div>

      {/* actions */}
      <div className="mt-2 flex flex-wrap gap-2">
        {m.status === "draft" && batchStatus === "running" && (
          <>
            <button onClick={() => setCompleting((v) => !v)} className="text-xs px-2 py-1 rounded bg-green-600 hover:bg-green-700 text-white font-semibold">
              {completing ? "Batal" : "Selesaikan"}
            </button>
            <button onClick={() => run(() => api.del(`/payout/mutations/${m.id}`))} disabled={busy}
              className="text-xs px-2 py-1 rounded bg-red-100 hover:bg-red-200 text-red-700 font-semibold">
              Hapus
            </button>
          </>
        )}
        {m.status === "completed" && batchStatus === "transferred" && needSub && m.subSellerForwardStatus !== "forwarded" && (
          <button onClick={() => run(() => api.post(`/payout/mutations/${m.id}/forward`))} disabled={busy}
            className="text-xs px-2 py-1 rounded bg-violet-600 hover:bg-violet-700 text-white font-semibold">
            Tandai Diteruskan
          </button>
        )}
      </div>

      {completing && (
        <div className="mt-2 rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-2">
          <ProofInput label="URL Bukti Pencairan Marketplace (wajib)" value={proofs.marketplaceProofUrl}
            onChange={(v) => setProofs((p) => ({ ...p, marketplaceProofUrl: v }))} />
          <ProofInput label="URL Bukti Transfer Sedekah (wajib jika > 0)" value={proofs.sedekahTransferProofUrl}
            onChange={(v) => setProofs((p) => ({ ...p, sedekahTransferProofUrl: v }))} />
          {needSub && (
            <ProofInput label="URL Bukti Transfer Sub-seller (wajib)" value={proofs.subSellerTransferProofUrl}
              onChange={(v) => setProofs((p) => ({ ...p, subSellerTransferProofUrl: v }))} />
          )}
          {needSubSub && (
            <ProofInput label="URL Bukti Transfer Sub-sub-seller (wajib)" value={proofs.subSubSellerTransferProofUrl}
              onChange={(v) => setProofs((p) => ({ ...p, subSubSellerTransferProofUrl: v }))} />
          )}
          <button onClick={() => run(() => api.post(`/payout/mutations/${m.id}/complete`, proofs))} disabled={busy}
            className="text-xs px-3 py-1.5 rounded bg-green-600 hover:bg-green-700 text-white font-semibold disabled:opacity-50">
            {busy ? "…" : "Konfirmasi Selesai (terkunci)"}
          </button>
        </div>
      )}
      {err && <div className="text-red-500 text-xs mt-1">{err}</div>}
    </div>
  );
}

function ProofInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-[11px] font-semibold text-slate-600">
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="URL bukti"
        className="mt-0.5 w-full px-2 py-1.5 rounded-md border border-slate-300 text-sm font-normal" />
    </label>
  );
}
