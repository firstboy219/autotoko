import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { calculatePayoutSplit, type SedekahBasis } from "@autotoko/shared";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";
import { rupiah } from "../lib/fmt";
import { Icon } from "../components/Icon";
import {
  Button,
  Card,
  Field,
  InlineAlert,
  Input,
  PageHeader,
  Skeleton,
  useToast,
} from "../components/ui";

interface Settings {
  sedekahRate: string;
  defaultSubSellerRate: string;
  materialReserveRate: string;
  sedekahBasis: SedekahBasis;
  sedekahBankAccount: string | null;
  materialBankAccount: string | null;
  minTransferAmount: string;
  adminFeeEnabled: boolean;
  adminFeeAmount: string;
}

/**
 * Sedekah and the sub-seller share ONE ordering setting on purpose: whichever
 * is taken first comes off the full credit and the other necessarily comes off
 * the remainder. Two independent dropdowns would let you pick "sedekah from
 * what's left after sub-seller" AND "sub-seller from what's left after
 * sedekah", which is circular and has no answer.
 */
const BASIS_OPTIONS: {
  value: SedekahBasis;
  title: string;
  sedekahFrom: string;
  subSellerFrom: string;
}[] = [
  {
    value: "total_credit",
    title: "Sedekah dulu, lalu sub-seller",
    sedekahFrom: "Total kredit awal",
    subSellerFrom: "Sisa setelah sedekah",
  },
  {
    value: "after_subseller_split",
    title: "Sub-seller dulu, lalu sedekah",
    sedekahFrom: "Sisa setelah sub-seller",
    subSellerFrom: "Total kredit awal",
  },
  {
    value: "both_from_total",
    title: "Keduanya dari total kredit awal",
    sedekahFrom: "Total kredit awal",
    subSellerFrom: "Total kredit awal",
  },
];

const PREVIEW_CREDIT = 1_000_000;

export function PencairanSettings() {
  const toast = useToast();
  const { data, loading, reload } = useFetch<Settings>("/payout/settings");
  const [rate, setRate] = useState("5");
  const [subRate, setSubRate] = useState("20");
  const [materialRate, setMaterialRate] = useState("0");
  const [basis, setBasis] = useState<SedekahBasis>("total_credit");
  const [bank, setBank] = useState("");
  const [materialBank, setMaterialBank] = useState("");
  const [minTransfer, setMinTransfer] = useState("10000");
  const [feeAktif, setFeeAktif] = useState(false);
  const [feeNominal, setFeeNominal] = useState("20000");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setRate((Number(data.sedekahRate) * 100).toString());
    setSubRate((Number(data.defaultSubSellerRate) * 100).toString());
    setMaterialRate((Number(data.materialReserveRate ?? 0) * 100).toString());
    setBasis(data.sedekahBasis);
    setBank(data.sedekahBankAccount ?? "");
    setMaterialBank(data.materialBankAccount ?? "");
    setMinTransfer(String(Number(data.minTransferAmount ?? 10000)));
    setFeeAktif(Boolean(data.adminFeeEnabled));
    setFeeNominal(String(Number(data.adminFeeAmount ?? 20000)));
  }, [data]);

  const sedekahNum = Number(rate);
  const subNum = Number(subRate);
  const rateInvalid = rate !== "" && (!Number.isFinite(sedekahNum) || sedekahNum < 0 || sedekahNum > 100);
  const subInvalid = subRate !== "" && (!Number.isFinite(subNum) || subNum < 0 || subNum > 100);
  // Only the parallel mode can over-allocate; the other two always take a
  // fraction of what is still left.
  const overAllocated = basis === "both_from_total" && sedekahNum + subNum > 100;

  /** Live worked example on Rp 1.000.000, using the very same shared calculator
   *  the backend will use — so the preview cannot drift from reality. */
  const materialNum = Number(materialRate);
  const materialInvalid =
    materialRate.trim() === "" || !Number.isFinite(materialNum) || materialNum < 0 || materialNum > 100;

  const preview = useMemo(() => {
    if (rateInvalid || subInvalid || overAllocated) return null;
    try {
      return calculatePayoutSplit({
        creditCents: PREVIEW_CREDIT * 100,
        sedekahRate: sedekahNum / 100,
        sedekahBasis: basis,
        subSellerRate: subNum / 100,
        materialReserveRate: materialInvalid ? 0 : materialNum / 100,
      });
    } catch {
      return null;
    }
  }, [sedekahNum, subNum, materialNum, materialInvalid, basis, rateInvalid, subInvalid, overAllocated]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (rateInvalid || subInvalid || materialInvalid || overAllocated) return;
    setBusy(true);
    setErr(null);
    try {
      await api.patch("/payout/settings", {
        sedekahRate: sedekahNum / 100,
        defaultSubSellerRate: subNum / 100,
        materialReserveRate: materialNum / 100,
        sedekahBasis: basis,
        sedekahBankAccount: bank || undefined,
        materialBankAccount: materialBank || undefined,
        minTransferAmount: Number(minTransfer) || 0,
        adminFeeEnabled: feeAktif,
        adminFeeAmount: Number(feeNominal) || 0,
      });
      toast("Pengaturan tersimpan", "success");
      reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout title="Pengaturan Payout">
      <PageHeader
        title="Pengaturan Pembagian"
        subtitle="Berlaku untuk transaksi baru. Data historis tetap memakai snapshot pengaturan lama."
        back={
          <Link
            to="/pencairan"
            className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink mb-3"
          >
            <Icon name="arrowLeft" size={16} /> Kembali
          </Link>
        }
      />

      {loading ? (
        <Card className="max-w-3xl">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-full mt-3" />
          <Skeleton className="h-24 w-full mt-5" />
        </Card>
      ) : (
        <form onSubmit={save} className="max-w-3xl space-y-4">
          <Card>
            <div className="text-sm font-medium text-ink mb-1">Persentase</div>
            <p className="text-xs text-ink-2 mb-4">
              Sub-seller di sini adalah nilai <b>default</b> — tiap sub-seller masih bisa punya
              rate sendiri, dan tiap toko bisa menimpanya lagi.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field
                label="Sedekah"
                required
                error={rateInvalid ? "Isi angka antara 0 dan 100." : null}
                hint={!rateInvalid ? "Default 5%." : undefined}
              >
                <div className="relative">
                  <Input
                    inputMode="decimal"
                    value={rate}
                    invalid={rateInvalid}
                    onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))}
                    className="pr-7 tabular-nums"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-3">%</span>
                </div>
              </Field>
              <Field
                label="Sub-seller (default)"
                required
                error={subInvalid ? "Isi angka antara 0 dan 100." : null}
                hint={!subInvalid ? "Diwarisi sub-seller baru. Default 20%." : undefined}
              >
                <div className="relative">
                  <Input
                    inputMode="decimal"
                    value={subRate}
                    invalid={subInvalid}
                    onChange={(e) => setSubRate(e.target.value.replace(/[^\d.]/g, ""))}
                    className="pr-7 tabular-nums"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-3">%</span>
                </div>
              </Field>
            </div>
          </Card>

          <Card>
            <div className="text-sm font-medium text-ink mb-1">Sisihkan untuk Bahan Baku</div>
            <p className="text-xs text-ink-2 mb-4">
              Bagian dari <b>hasil seller</b> yang disisihkan untuk membeli bahan baku. Ini bukan
              potongan ke pihak lain &mdash; uangnya tetap milik Anda, hanya dipisahkan supaya
              modal restock sudah teralokasi sebelum sisanya dihitung sebagai keuntungan. Isi 0
              untuk mematikan.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field
                label="Porsi Bahan Baku"
                error={materialInvalid ? "Isi angka antara 0 dan 100." : null}
                hint={!materialInvalid ? "Dihitung dari hasil seller, bukan dari kredit awal." : undefined}
              >
                <div className="relative">
                  <Input
                    inputMode="decimal"
                    value={materialRate}
                    invalid={materialInvalid}
                    onChange={(e) => setMaterialRate(e.target.value.replace(/[^\d.]/g, ""))}
                    className="pr-7 tabular-nums"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-3">%</span>
                </div>
              </Field>
            </div>
          </Card>

          <Card>
            <div className="text-sm font-medium text-ink mb-1">Urutan Pemotongan</div>
            <p className="text-xs text-ink-2 mb-3">
              Menentukan <b>dari mana</b> masing-masing potongan dihitung. Sedekah dan sub-seller
              memakai satu pengaturan yang sama, karena yang dipotong lebih dulu otomatis diambil
              dari total kredit awal dan sisanya jadi dasar bagi yang berikutnya.
            </p>
            <div className="space-y-2">
              {BASIS_OPTIONS.map((o) => {
                const active = basis === o.value;
                return (
                  <label
                    key={o.value}
                    className={`block rounded-lg border p-3.5 cursor-pointer transition ${
                      active ? "border-brand bg-brand/8" : "border-line hover:bg-canvas"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="radio"
                        name="basis"
                        checked={active}
                        onChange={() => setBasis(o.value)}
                        className="mt-0.5 accent-brand"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-ink">{o.title}</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mt-2">
                          <div className="text-xs">
                            <span className="text-ink-3">Sedekah dari:</span>{" "}
                            <span className="text-ink">{o.sedekahFrom}</span>
                          </div>
                          <div className="text-xs">
                            <span className="text-ink-3">Sub-seller dari:</span>{" "}
                            <span className="text-ink">{o.subSellerFrom}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            {overAllocated && (
              <div className="mt-3">
                <InlineAlert tone="danger">
                  Sedekah {sedekahNum}% + sub-seller {subNum}% melebihi 100%. Kombinasi ini mustahil
                  bila keduanya dihitung dari total kredit awal — turunkan salah satu, atau pilih
                  urutan yang lain.
                </InlineAlert>
              </div>
            )}
          </Card>

          {/* Worked example — the fastest way to see what the choice actually does. */}
          <Card>
            <div className="text-sm font-medium text-ink mb-1">
              Contoh: pencairan {rupiah(PREVIEW_CREDIT)}
            </div>
            <p className="text-xs text-ink-2 mb-3">
              Dihitung dengan rumus yang sama persis dengan yang dipakai saat merekam pencairan.
            </p>
            {!preview ? (
              <div className="text-sm text-ink-3">
                Perbaiki persentase di atas untuk melihat contoh perhitungan.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  ["Sedekah", preview.sedekahCents],
                  ["Sub-seller", preview.subSellerCents],
                  ["Seller (total)", preview.sellerCents],
                  ["  - Bahan baku", preview.sellerMaterialCents],
                  ["  - Sisa seller", preview.sellerNetCents],
                ].map(([label, cents]) => (
                  <div key={label as string} className="rounded-lg border border-line bg-canvas px-3 py-2.5">
                    <div className="text-xs text-ink-3">{label}</div>
                    <div className="text-sm text-ink tabular-nums mt-0.5">
                      {rupiah((cents as number) / 100)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Rekening Tujuan Sedekah"
                hint="Dipakai sebagai rekening tujuan pada rekap transfer sedekah."
              >
                <Input
                  value={bank}
                  onChange={(e) => setBank(e.target.value)}
                  placeholder="Nomor rekening + bank"
                  className="font-mono"
                />
              </Field>
              <Field
                label="Minimum Transfer"
                hint="Di bawah ini transfer tidak dibuat — nominalnya ditahan dan ikut batch berikutnya. Bank umumnya menolak di bawah 10.000."
              >
                <Input
                  inputMode="numeric"
                  value={minTransfer ? Number(minTransfer).toLocaleString("id-ID") : ""}
                  onChange={(e) => setMinTransfer(e.target.value.replace(/\D/g, ""))}
                  className="tabular-nums"
                />
              </Field>
              {/* Ongkos, bukan potongan. Sedekah dan sub-seller diambil DARI
                  kredit yang cair; fee admin dibayar terpisah, satu kali per
                  batch — itu sebabnya ia tidak ikut ke perhitungan pembagian
                  manapun, dan kenapa buktinya berdiri sendiri. */}
              <Field
                label="Fee Admin per Batch"
                hint="Ongkos tetap yang dibayar sekali tiap batch, di luar pembagian pencairan. Nominal yang berlaku direkam ke batch saat batch dibuat, jadi mengubahnya di sini tidak mengubah batch yang sudah jalan."
              >
                <label className="flex items-center gap-2 text-sm text-ink-2">
                  <input
                    type="checkbox"
                    checked={feeAktif}
                    onChange={(e) => setFeeAktif(e.target.checked)}
                  />
                  Aktifkan fee admin
                </label>
                {feeAktif && (
                  <Input
                    inputMode="numeric"
                    value={feeNominal ? Number(feeNominal).toLocaleString("id-ID") : ""}
                    onChange={(e) => setFeeNominal(e.target.value.replace(/\D/g, ""))}
                    className="tabular-nums mt-2"
                  />
                )}
              </Field>
              <Field
                label="Rekening Tujuan Bahan Baku"
                hint="Porsi bahan baku ditransfer ke sini, satu kali per batch, dengan bukti transfer seperti sedekah."
              >
                <Input
                  value={materialBank}
                  onChange={(e) => setMaterialBank(e.target.value)}
                  placeholder="Nomor rekening + bank"
                  className="font-mono"
                />
              </Field>
            </div>
          </Card>

          {err && <InlineAlert tone="danger">{err}</InlineAlert>}

          <div>
            <Button
              variant="filled"
              icon="check"
              loading={busy}
              disabled={rateInvalid || subInvalid || overAllocated}
            >
              Simpan Pengaturan
            </Button>
          </div>
        </form>
      )}
    </Layout>
  );
}
