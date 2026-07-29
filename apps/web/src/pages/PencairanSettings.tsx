import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";
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
  sedekahBasis: "total_credit" | "after_subseller_split";
  sedekahBankAccount: string | null;
}

const BASIS_OPTIONS: {
  value: Settings["sedekahBasis"];
  title: string;
  desc: string;
}[] = [
  {
    value: "total_credit",
    title: "Total Kredit Awal",
    desc: "Sedekah dihitung dari nominal kredit penuh, lalu sisanya displit ke sub-seller.",
  },
  {
    value: "after_subseller_split",
    title: "Sisa Setelah Split Sub-seller",
    desc: "Sub-seller dibayar dulu (tanpa potong sedekah), sedekah diambil dari porsi seller saja.",
  },
];

export function PencairanSettings() {
  const toast = useToast();
  const { data, loading, reload } = useFetch<Settings>("/payout/settings");
  const [rate, setRate] = useState("5");
  const [basis, setBasis] = useState<Settings["sedekahBasis"]>("total_credit");
  const [bank, setBank] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      setRate((Number(data.sedekahRate) * 100).toString());
      setBasis(data.sedekahBasis);
      setBank(data.sedekahBankAccount ?? "");
    }
  }, [data]);

  const rateNum = Number(rate);
  const rateInvalid = rate !== "" && (!Number.isFinite(rateNum) || rateNum < 0 || rateNum > 100);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (rateInvalid) return;
    setBusy(true);
    setErr(null);
    try {
      await api.patch("/payout/settings", {
        sedekahRate: Number(rate) / 100,
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
        title="Pengaturan Sedekah"
        subtitle="Berlaku untuk transaksi baru. Data historis tetap memakai snapshot rate lama."
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
        <Card className="max-w-2xl">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-full mt-3" />
          <Skeleton className="h-20 w-full mt-5" />
        </Card>
      ) : (
        <form onSubmit={save} className="max-w-2xl space-y-4">
          <Card>
            <Field
              label="Rate Sedekah (%)"
              required
              error={rateInvalid ? "Isi angka antara 0 dan 100." : null}
              hint="Default 5%."
              className="max-w-[200px]"
            >
              <Input
                inputMode="decimal"
                value={rate}
                invalid={rateInvalid}
                onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))}
                className="tabular-nums"
              />
            </Field>
          </Card>

          <Card>
            <div className="text-sm font-medium text-ink mb-1">Basis Perhitungan Sedekah</div>
            <p className="text-xs text-ink-2 mb-3">
              Menentukan dari mana porsi sedekah diambil saat split dihitung.
            </p>
            <div className="space-y-2">
              {BASIS_OPTIONS.map((o) => {
                const active = basis === o.value;
                return (
                  <label
                    key={o.value}
                    className={`flex items-start gap-3 rounded-lg border p-3.5 cursor-pointer transition ${
                      active ? "border-brand bg-brand/8" : "border-line hover:bg-canvas"
                    }`}
                  >
                    <input
                      type="radio"
                      name="basis"
                      checked={active}
                      onChange={() => setBasis(o.value)}
                      className="mt-0.5 accent-brand"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink">{o.title}</span>
                      <span className="block text-xs text-ink-2 mt-0.5">{o.desc}</span>
                    </span>
                  </label>
                );
              })}
            </div>
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
            <Button variant="filled" icon="check" loading={busy} disabled={rateInvalid}>
              Simpan Pengaturan
            </Button>
          </div>
        </form>
      )}
    </Layout>
  );
}
