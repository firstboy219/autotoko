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
  sedekahBasis: SedekahBasis;
  sedekahBankAccount: string | null;
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
  const [basis, setBasis] = useState<SedekahBasis>("total_credit");
  const [bank, setBank] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setRate((Number(data.sedekahRate) * 100).toString());
    setSubRate((Number(data.defaultSubSellerRate) * 100).toString());
    setBasis(data.sedekahBasis);
    setBank(data.sedekahBankAccount ?? "");
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
  const preview = useMemo(() => {
    if (rateInvalid || subInvalid || overAllocated) return null;
    try {
      return calculatePayoutSplit({
        creditCents: PREVIEW_CREDIT * 100,
        sedekahRate: sedekahNum / 100,
        sedekahBasis: basis,
        subSellerRate: subNum / 100,
      });
    } catch {
      return null;
    }
  }, [sedekahNum, subNum, basis, rateInvalid, subInvalid, overAllocated]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (rateInvalid || subInvalid || overAllocated) return;
    setBusy(true);
    setErr(null);
    try {
      await api.patch("/payout/settings", {
        sedekahRate: sedekahNum / 100,
        defaultSubSellerRate: subNum / 100,
        sedekahBasis: basis,
        sedekahBankAccount: bank || undefined,
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
                  ["Seller", preview.sellerCents],
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
