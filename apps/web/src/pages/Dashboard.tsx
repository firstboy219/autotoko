import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { rupiah } from "../lib/fmt";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="text-2xl font-extrabold mt-1">{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}

export function Dashboard() {
  const wallet = useFetch<{ balance: string }>("/wallet");
  const summary = useFetch<{ total: number; revenue: string; feeCharged: string }>(
    "/orders/summary",
  );
  const shops = useFetch<unknown[]>("/shops");
  const products = useFetch<unknown[]>("/products");

  return (
    <Layout title="Dashboard">
      <div className="grid grid-cols-4 gap-3">
        <Stat label="Saldo Wallet" value={rupiah(wallet.data?.balance)} sub="AutoToko balance" />
        <Stat label="Total Order" value={String(summary.data?.total ?? 0)} sub="semua waktu" />
        <Stat label="Revenue" value={rupiah(summary.data?.revenue)} sub="dari order" />
        <Stat
          label="Toko / Produk"
          value={`${shops.data?.length ?? 0} / ${products.data?.length ?? 0}`}
          sub="terhubung / master"
        />
      </div>

      <div className="mt-4 bg-white rounded-xl border border-slate-200 p-5">
        <div className="font-bold mb-1">Selamat datang 👋</div>
        <p className="text-sm text-slate-500">
          Dashboard ini terhubung langsung ke API AutoToko. Mulai dengan{" "}
          <b>menghubungkan toko</b> di menu Toko Saya, lalu buat <b>Master Produk</b> dan
          hubungkan postingan via SKU.
        </p>
      </div>
    </Layout>
  );
}
