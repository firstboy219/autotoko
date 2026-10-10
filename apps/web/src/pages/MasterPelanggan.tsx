import { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { rupiah } from "../lib/fmt";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  StatTile,
  Table,
  TableWrap,
  TD,
  TH,
  THead,
  TR,
} from "../components/ui";
import { BuyerBadges, type BuyerFlags } from "../components/BuyerBadges";

interface Cust {
  key: string;
  nama: string | null;
  phone: string | null;
  alamat: string | null;
  kota: string | null;
  orders: number;
  batal: number;
  batalPra: number;
  batalKirim: number;
  codBatalKirim: number;
  cod: number;
  spend: number;
  firstOrder: string | null;
  lastOrder: string | null;
  flags: BuyerFlags;
}
interface ListResp {
  pelanggan: Cust[];
  ringkas: { totalPelanggan: number; repeatPelanggan: number; totalOrder: number };
  hasMore: boolean;
}
interface OrderRow {
  no: string | null;
  tgl: string | null;
  status: string | null;
  total: number | null;
  isCod: boolean;
  toko: string | null;
  ringkasItem: string;
}
interface DetailResp extends Cust {
  daftarOrder: OrderRow[];
  produkSering: { nama: string; qty: number; orders: number }[];
}

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  selesai: "success",
  dikirim: "info",
  dibatalkan: "danger",
  retur: "warning",
};

function fmtTgl(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

export default function MasterPelanggan() {
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("orders");
  const [repeat, setRepeat] = useState(false);
  const [limit, setLimit] = useState(50);
  const [sel, setSel] = useState<string | null>(null);

  // debounce pencarian
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(qInput.trim());
      setLimit(50);
    }, 400);
    return () => clearTimeout(t);
  }, [qInput]);

  const path = `/customers?sort=${sort}&limit=${limit}${repeat ? "&repeat=1" : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const resp = useFetch<ListResp>(path);
  const data = resp.data;
  const rows = data?.pelanggan ?? [];

  return (
    <Layout title="Master Pelanggan">
      <PageHeader
        title="Master Pelanggan"
        subtitle="Siapa yang belanja, berapa kali dia repeat order, dan produk apa saja yang sering dia beli."
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Total pelanggan" value={(data?.ringkas.totalPelanggan ?? 0).toLocaleString("id-ID")} icon="users" />
        <StatTile
          label="Pelanggan repeat (>1 order)"
          value={(data?.ringkas.repeatPelanggan ?? 0).toLocaleString("id-ID")}
          sub={
            data && data.ringkas.totalPelanggan > 0
              ? `${Math.round((data.ringkas.repeatPelanggan / data.ringkas.totalPelanggan) * 100)}% dari total`
              : undefined
          }
          icon="trending"
        />
        <StatTile label="Total order teridentifikasi" value={(data?.ringkas.totalOrder ?? 0).toLocaleString("id-ID")} icon="cart" />
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <Input
            placeholder="Cari nama / nomor HP…"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            className="w-full sm:w-64"
          />
          <Select value={sort} onChange={(e) => { setSort(e.target.value); setLimit(50); }} className="w-auto">
            <option value="orders">Paling sering order</option>
            <option value="spend">Paling banyak belanja</option>
            <option value="recent">Order terakhir terbaru</option>
            <option value="risk">Paling berisiko (sering batal)</option>
          </Select>
          <label className="flex items-center gap-1.5 text-xs text-ink-2">
            <input type="checkbox" checked={repeat} onChange={(e) => { setRepeat(e.target.checked); setLimit(50); }} />
            Hanya pelanggan repeat
          </label>
          {resp.loading && <Spinner size={14} />}
        </div>

        <TableWrap>
          <Table>
            <THead>
              <TR>
                <TH>Pelanggan</TH>
                <TH>Kota</TH>
                <TH align="right">Order</TH>
                <TH align="right">COD</TH>
                <TH align="right">Batal</TH>
                <TH align="right">Total belanja</TH>
                <TH align="right">Order terakhir</TH>
              </TR>
            </THead>
            <tbody>
              {rows.map((c) => (
                <TR
                  key={c.key}
                  onClick={() => setSel(c.key)}
                  className="cursor-pointer hover:bg-canvas"
                >
                  <TD>
                    <div className="font-medium text-ink">{c.nama ?? "(tanpa nama)"}</div>
                    <div className="text-[11px] text-ink-3">{c.phone ?? c.key}</div>
                    <div className="mt-0.5"><BuyerBadges flags={c.flags} batalKirim={c.batalKirim} batalPra={c.batalPra} /></div>
                  </TD>
                  <TD className="text-ink-2">{c.kota ?? "—"}</TD>
                  <TD align="right">
                    <span className="tabular-nums font-semibold text-ink">{c.orders}×</span>
                    {c.orders > 1 && <span className="ml-1"><Badge tone="success">repeat</Badge></span>}
                  </TD>
                  <TD align="right" className="tabular-nums text-amber-700">{c.cod || "—"}</TD>
                  <TD align="right" className={`tabular-nums ${c.batal > 0 ? "text-red-600" : "text-ink-3"}`}>{c.batal || "—"}</TD>
                  <TD align="right" className="tabular-nums text-ink">{rupiah(c.spend)}</TD>
                  <TD align="right" className="tabular-nums text-ink-2">{fmtTgl(c.lastOrder)}</TD>
                </TR>
              ))}
              {resp.loading && rows.length === 0 && (
                Array.from({ length: 6 }).map((_, r) => (
                  <tr key={r} className="border-t border-line">
                    {Array.from({ length: 7 }).map((_, c) => (
                      <td key={c} className="px-4 py-3.5"><div className="h-3.5 w-20 animate-pulse rounded bg-slate-200/70" /></td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </TableWrap>

        {!resp.loading && rows.length === 0 && (
          <EmptyState title="Belum ada pelanggan" description={q ? "Tidak ada yang cocok dengan pencarian." : "Order yang masuk akan dikelompokkan per pembeli di sini."} />
        )}

        {data?.hasMore && (
          <div className="flex justify-center border-t border-line px-4 py-3">
            <Button variant="outline" onClick={() => setLimit((n) => n + 50)}>Muat lebih banyak</Button>
          </div>
        )}
      </Card>

      <Modal open={sel != null} onClose={() => setSel(null)} title="Detail pelanggan" width="max-w-2xl">
        {sel && <CustomerDetail custKey={sel} />}
      </Modal>
    </Layout>
  );
}

function CustomerDetail({ custKey }: { custKey: string }) {
  const resp = useFetch<DetailResp>(`/customers/${encodeURIComponent(custKey)}`);
  const d = resp.data;
  if (resp.loading || !d) return <div className="flex items-center gap-2 py-6 text-ink-3"><Spinner size={16} /> Memuat…</div>;
  const maxQty = Math.max(1, ...d.produkSering.map((p) => p.qty));

  return (
    <div className="space-y-4">
      <div>
        <div className="text-base font-semibold text-ink">{d.nama ?? "(tanpa nama)"}</div>
        <div className="text-xs text-ink-3">{d.phone ?? "—"}{d.kota ? ` · ${d.kota}` : ""}</div>
        {d.alamat && <div className="mt-0.5 text-[11px] text-ink-3">{d.alamat}</div>}
        <div className="mt-1.5"><BuyerBadges flags={d.flags} batalKirim={d.batalKirim} batalPra={d.batalPra} /></div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-line bg-canvas px-3 py-2">
          <div className="text-[11px] text-ink-3">Order</div>
          <div className="text-lg font-semibold text-ink tabular-nums">{d.orders}×</div>
        </div>
        <div className="rounded-lg border border-line bg-canvas px-3 py-2">
          <div className="text-[11px] text-ink-3">Total belanja</div>
          <div className="text-lg font-semibold text-ink tabular-nums">{rupiah(d.spend)}</div>
        </div>
        <div className="rounded-lg border border-line bg-canvas px-3 py-2">
          <div className="text-[11px] text-ink-3">COD / Batal</div>
          <div className="text-lg font-semibold tabular-nums"><span className="text-amber-700">{d.cod}</span> <span className="text-ink-3">/</span> <span className={d.batal > 0 ? "text-red-600" : "text-ink"}>{d.batal}</span></div>
        </div>
        <div className="rounded-lg border border-line bg-canvas px-3 py-2">
          <div className="text-[11px] text-ink-3">Pelanggan sejak</div>
          <div className="text-sm font-semibold text-ink">{fmtTgl(d.firstOrder)}</div>
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-medium text-ink-2">Produk yang sering dibeli</div>
        {d.produkSering.length === 0 ? (
          <div className="text-[11px] text-ink-3">Belum ada rincian item.</div>
        ) : (
          <div className="space-y-1.5">
            {d.produkSering.slice(0, 10).map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] text-ink">{p.nama}</div>
                  <div className="mt-0.5 h-1.5 rounded-full bg-slate-100">
                    <div className="h-1.5 rounded-full bg-[#2a78d6]" style={{ width: `${Math.max(4, (p.qty / maxQty) * 100)}%` }} />
                  </div>
                </div>
                <div className="whitespace-nowrap text-[11px] tabular-nums text-ink-2">{p.qty} pcs · {p.orders}×</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-1.5 text-xs font-medium text-ink-2">Riwayat order ({d.daftarOrder.length})</div>
        <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
          {d.daftarOrder.map((o, i) => (
            <div key={i} className="flex items-center justify-between gap-2 border-b border-line/70 pb-1 text-[11px]">
              <div className="min-w-0">
                <span className="text-ink-2">{fmtTgl(o.tgl)}</span>
                {o.isCod && <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold text-amber-700">COD</span>}
                <span className="ml-1"><Badge tone={STATUS_TONE[o.status ?? ""] ?? "neutral"}>{o.status ?? "—"}</Badge></span>
                <span className="ml-1 text-ink-3">{o.toko ?? ""}</span>
                {o.ringkasItem && <div className="truncate text-ink-3">{o.ringkasItem}</div>}
              </div>
              <div className="whitespace-nowrap tabular-nums text-ink">{o.total != null ? rupiah(o.total) : "—"}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
