import { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";
import { rupiah } from "../lib/fmt";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  InlineAlert,
  Input,
  PageHeader,
  Select,
  SkeletonRows,
  Table,
  TableWrap,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from "../components/ui";

interface Shop {
  id: string;
  shopName: string | null;
  displayName?: string | null;
  marketplace: string;
}

interface Statement {
  id: string;
  shopId: string | null;
  marketplace: string;
  source: string;
  periodFrom: string | null;
  periodTo: string | null;
  fileName: string | null;
  settlementAmount: string | null;
  importedAt: string;
  lines: number;
}

interface Hasil {
  range: { from: string; to: string };
  totals: {
    manual: number;
    marketplace: number;
    selisih: number;
    manualRows: number;
    marketplaceRows: number;
  };
  cocok: { tanggal: string; nominal: number; externalRef: string | null }[];
  bedaTanggal: {
    tanggalManual: string;
    tanggalLaporan: string;
    nominal: number;
    externalRef: string | null;
  }[];
  hanyaManual: { tanggal: string; nominal: number; shopId: string }[];
  hanyaLaporan: {
    tanggal: string;
    nominal: number;
    externalRef: string | null;
    bankAccount: string | null;
  }[];
  adaPembanding: boolean;
}

const hariIni = () => new Date().toISOString().slice(0, 10);
const awalBulan = () => hariIni().slice(0, 8) + "01";

/**
 * Dua sumber untuk satu kebenaran, diadu.
 *
 * Sistem ini berjalan manual: pencairan direkam dari struk penarikan. Nanti
 * tiap toko tersambung ke API marketplace dan fakta yang sama datang dua kali.
 * Halaman ini adalah tempat keduanya bertemu — dan urutannya disengaja: yang
 * manual tetap sumber yang dipakai menghitung uang, yang dari marketplace
 * dipakai memeriksanya.
 *
 * Selama API belum menyala, "yang dari marketplace" diisi dengan mengunggah
 * berkas laporan penyelesaian. Bentuk datanya sama persis dengan yang nanti
 * dikirim API, jadi halaman ini tidak perlu ditulis ulang.
 */
export default function Rekonsiliasi() {
  const shops = useFetch<Shop[]>("/payout/shops");
  const statements = useFetch<Statement[]>("/statements");
  const toast = useToast();

  const [shopId, setShopId] = useState("");
  const [dari, setDari] = useState(awalBulan());
  const [sampai, setSampai] = useState(hariIni());
  const [hasil, setHasil] = useState<Hasil | null>(null);
  const [memuat, setMemuat] = useState(false);
  const [mengunggah, setMengunggah] = useState(false);

  const namaToko = (id: string | null) => {
    const s = (shops.data ?? []).find((x) => x.id === id);
    return s ? `${s.displayName || s.shopName || "(tanpa nama)"} (${s.marketplace})` : "—";
  };

  async function jalankan() {
    setMemuat(true);
    try {
      const q = new URLSearchParams({ from: dari, to: sampai });
      if (shopId) q.set("shopId", shopId);
      setHasil(await api.get<Hasil>(`/statements/reconcile?${q.toString()}`));
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setMemuat(false);
    }
  }

  useEffect(() => {
    void jalankan();
    // Sekali saat halaman dibuka; selebihnya lewat tombol.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function unggah(f: File) {
    setMengunggah(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("Berkas tidak terbaca."));
        r.readAsDataURL(f);
      });
      const d = await api.post<{ linesImported: number; withdrawals: number }>(
        "/statements/import",
        { fileBase64: base64, fileName: f.name, shopId: shopId || null },
      );
      toast(
        `Laporan masuk: ${d.linesImported} baris, ${d.withdrawals} di antaranya penarikan.`,
        "success",
      );
      statements.reload();
      void jalankan();
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setMengunggah(false);
    }
  }

  const t = hasil?.totals;
  const seimbang = t ? Math.abs(t.selisih) < 1 : false;

  return (
    <Layout title="Rekonsiliasi">
      <PageHeader
        title="Rekonsiliasi Manual vs Marketplace"
        subtitle="Adu catatan yang direkam sendiri dengan laporan resmi marketplace."
      />

      <InlineAlert tone="info">
        Yang direkam manual tetap menjadi angka yang dipakai sistem. Laporan
        marketplace di sini dipakai untuk <b>memeriksanya</b>, bukan
        menggantikannya — dan tidak pernah mengubah satu pun baris pencairan.
      </InlineAlert>

      <Card className="mt-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <Field label="Toko">
            <Select value={shopId} onChange={(e) => setShopId(e.target.value)}>
              <option value="">Semua toko</option>
              {(shops.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName || s.shopName} ({s.marketplace})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Dari tanggal">
            <Input type="date" value={dari} onChange={(e) => setDari(e.target.value)} />
          </Field>
          <Field label="Sampai tanggal">
            <Input type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} />
          </Field>
          <Field label="&nbsp;">
            <Button variant="filled" loading={memuat} onClick={jalankan}>
              Bandingkan
            </Button>
          </Field>
        </div>

        <div className="mt-4 border-t border-line pt-4">
          <div className="text-xs uppercase tracking-wide text-ink-3 mb-1">
            Unggah laporan marketplace
          </div>
          <p className="text-xs text-ink-3 mb-2">
            Ekspor penyelesaian pembayaran TikTok Shop (.xlsx). Pilih tokonya
            dulu di atas supaya laporannya menempel pada toko yang benar. Berkas
            yang sama tidak bisa masuk dua kali.
          </p>
          <input
            type="file"
            accept=".xlsx"
            disabled={mengunggah}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void unggah(f);
              e.target.value = "";
            }}
            className="text-sm"
          />
        </div>
      </Card>

      {hasil && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
            <Card>
              <div className="text-xs text-ink-3">Dicatat manual</div>
              <div className="text-lg text-ink tabular-nums">{rupiah(t!.manual)}</div>
              <div className="text-xs text-ink-3">{t!.manualRows} pencairan</div>
            </Card>
            <Card>
              <div className="text-xs text-ink-3">Kata marketplace</div>
              <div className="text-lg text-ink tabular-nums">{rupiah(t!.marketplace)}</div>
              <div className="text-xs text-ink-3">{t!.marketplaceRows} penarikan</div>
            </Card>
            <Card>
              <div className="text-xs text-ink-3">Selisih</div>
              <div
                className={`text-lg tabular-nums ${seimbang ? "text-emerald-700" : "text-red-600"}`}
              >
                {rupiah(t!.selisih)}
              </div>
              <div className="text-xs text-ink-3">
                {hasil.cocok.length} cocok · {hasil.bedaTanggal.length} beda tanggal
              </div>
            </Card>
          </div>

          {!hasil.adaPembanding && (
            <div className="mt-3">
              <InlineAlert tone="warning">
                Belum ada laporan marketplace untuk rentang ini, jadi tidak ada
                yang bisa dibandingkan. Selisih nol di sini bukan berarti cocok —
                berarti belum diperiksa.
              </InlineAlert>
            </div>
          )}

          {hasil.hanyaManual.length > 0 && (
            <Card className="mt-4" padded={false}>
              <CardHeader
                title={`Hanya ada di catatan manual (${hasil.hanyaManual.length})`}
                subtitle="Direkam sendiri, tapi tidak ditemukan di laporan marketplace."
              />
              <TableWrap>
                <Table>
                  <THead>
                    <TR>
                      <TH>Tanggal</TH>
                      <TH>Toko</TH>
                      <TH>Nominal</TH>
                    </TR>
                  </THead>
                  <tbody>
                    {hasil.hanyaManual.map((x, i) => (
                      <TR key={i}>
                        <TD>{x.tanggal}</TD>
                        <TD>{namaToko(x.shopId)}</TD>
                        <TD>{rupiah(x.nominal)}</TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            </Card>
          )}

          {hasil.hanyaLaporan.length > 0 && (
            <Card className="mt-4" padded={false}>
              <CardHeader
                title={`Hanya ada di laporan marketplace (${hasil.hanyaLaporan.length})`}
                subtitle="Marketplace mencatat penarikan ini, tapi belum direkam di sistem."
              />
              <TableWrap>
                <Table>
                  <THead>
                    <TR>
                      <TH>Tanggal</TH>
                      <TH>Nominal</TH>
                      <TH>Rekening</TH>
                      <TH>Ref</TH>
                    </TR>
                  </THead>
                  <tbody>
                    {hasil.hanyaLaporan.map((x, i) => (
                      <TR key={i}>
                        <TD>{x.tanggal}</TD>
                        <TD>{rupiah(x.nominal)}</TD>
                        <TD>{x.bankAccount ?? "—"}</TD>
                        <TD>
                          <span className="text-xs text-ink-3">{x.externalRef ?? "—"}</span>
                        </TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            </Card>
          )}

          {hasil.bedaTanggal.length > 0 && (
            <Card className="mt-4" padded={false}>
              <CardHeader
                title={`Nominal cocok, tanggal berbeda (${hasil.bedaTanggal.length})`}
                subtitle="Selisih wajar antara uang keluar dari saldo dan uang sampai di rekening."
              />
              <TableWrap>
                <Table>
                  <THead>
                    <TR>
                      <TH>Manual</TH>
                      <TH>Laporan</TH>
                      <TH>Nominal</TH>
                    </TR>
                  </THead>
                  <tbody>
                    {hasil.bedaTanggal.map((x, i) => (
                      <TR key={i}>
                        <TD>{x.tanggalManual}</TD>
                        <TD>{x.tanggalLaporan}</TD>
                        <TD>{rupiah(x.nominal)}</TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            </Card>
          )}

          {hasil.cocok.length > 0 && (
            <Card className="mt-4" padded={false}>
              <CardHeader title={`Cocok persis (${hasil.cocok.length})`} />
              <TableWrap>
                <Table>
                  <THead>
                    <TR>
                      <TH>Tanggal</TH>
                      <TH>Nominal</TH>
                      <TH>Ref marketplace</TH>
                    </TR>
                  </THead>
                  <tbody>
                    {hasil.cocok.map((x, i) => (
                      <TR key={i}>
                        <TD>{x.tanggal}</TD>
                        <TD>{rupiah(x.nominal)}</TD>
                        <TD>
                          <span className="text-xs text-ink-3">{x.externalRef ?? "—"}</span>
                        </TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            </Card>
          )}
        </>
      )}

      <Card className="mt-4" padded={false}>
        <CardHeader title={`Laporan Terimpor (${statements.data?.length ?? 0})`} />
        <TableWrap>
          <Table>
            <THead>
              <TR>
                <TH>Berkas</TH>
                <TH>Toko</TH>
                <TH>Periode</TH>
                <TH>Baris</TH>
                <TH>Sumber</TH>
                <TH> </TH>
              </TR>
            </THead>
            <tbody>
              {statements.loading && <SkeletonRows n={2} cols={6} />}
              {!statements.loading && (statements.data?.length ?? 0) === 0 && (
                <TR>
                  <TD colSpan={6}>
                    <span className="text-ink-3">Belum ada laporan yang diunggah.</span>
                  </TD>
                </TR>
              )}
              {(statements.data ?? []).map((s) => (
                <TR key={s.id}>
                  <TD>{s.fileName ?? "—"}</TD>
                  <TD>{namaToko(s.shopId)}</TD>
                  <TD>
                    {s.periodFrom} — {s.periodTo}
                  </TD>
                  <TD>{s.lines}</TD>
                  <TD>
                    <Badge tone={s.source === "api" ? "success" : "neutral"}>
                      {s.source === "api" ? "API" : "unggahan"}
                    </Badge>
                  </TD>
                  <TD>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={async () => {
                        try {
                          await api.del(`/statements/${s.id}`);
                          toast("Laporan dihapus. Pencairan tidak tersentuh.", "success");
                          statements.reload();
                          void jalankan();
                        } catch (e) {
                          toast((e as Error).message, "danger");
                        }
                      }}
                    >
                      Hapus
                    </Button>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </Card>
    </Layout>
  );
}
