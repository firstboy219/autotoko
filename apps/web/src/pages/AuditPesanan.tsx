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

interface Audit {
  totals: {
    discan: number;
    bisaDiaudit: number;
    cocok: number;
    belumCair: number;
    belumDiscan: number;
    tanpaOrderId: number;
    nilaiCocok: number;
    nilaiBelumDiscan: number;
    umurTertua: number;
    umurRata: number;
  };
  adaPembanding: boolean;
  /**
   * Berapa persen yang sebenarnya dipotong marketplace pada TIAP pesanan.
   *
   * persen null berarti pesanannya batal atau retur -- berpendapatan nol, jadi
   * tidak punya persentase. Bukan nol: nol terbaca sebagai "tidak dipotong
   * sama sekali", yang justru kesimpulan yang salah.
   */
  biayaPesanan: {
    ringkas: {
      pesanan: number;
      tanpaPendapatan: number;
      pendapatan: number;
      biaya: number;
      cair: number;
      persenTertimbang: number;
      persenMedian: number;
      persenTerendah: number;
      persenTertinggi: number;
      ambangCuriga: number;
      mencurigakan: number;
    };
    baris: {
      orderNo: string;
      tanggal: string;
      sumber: string;
      pendapatan: number;
      biaya: number;
      cair: number;
      persen: number | null;
      mencurigakan: boolean;
    }[];
  };
  cocok: {
    resi: string;
    orderNo: string;
    tanggalCair: string;
    nominal: number;
    hariSampaiCair: number;
  }[];
  belumCair: { resi: string; orderNo: string; scannedAt: string; umurHari: number }[];
  belumDiscan: { orderNo: string; tanggalCair: string; nominal: number }[];
  tanpaOrderId: {
    resi: string;
    scannedAt: string;
    umurHari: number;
    tersimpanTapiTidakSah: string | null;
  }[];
}

/** Satu angka di belakang koma: dua sudah lebih presisi daripada artinya. */
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

const hariIni = () => new Date().toISOString().slice(0, 10);
const awalBulan = () => hariIni().slice(0, 8) + "01";

/** Makin tua makin keras warnanya — umur adalah inti halaman ini. */
function Umur({ hari }: { hari: number }) {
  const tone = hari >= 14 ? "danger" : hari >= 7 ? "warning" : "neutral";
  return <Badge tone={tone}>{hari} hari</Badge>;
}

/**
 * Pesanan yang sudah diserahkan ke kurir, lawan pesanan yang sudah dibayar.
 *
 * Scan resi packing berarti picker sudah menyiapkan pesanan dan menyerahkannya
 * ke kurir. Sejak saat itu marketplace berutang. Halaman ini menghitung
 * utangnya: mana yang belum dibayar, dan sudah berapa lama.
 *
 * Kuncinya order id di label. Resi yang order id-nya tidak terbaca sengaja
 * dipisahkan ke daftarnya sendiri, bukan dimasukkan ke "belum dibayar" —
 * menuduh marketplace atas kegagalan OCR kita sendiri akan membuat seluruh
 * halaman ini tidak bisa dipercaya.
 */
export default function AuditPesanan() {
  const shops = useFetch<Shop[]>("/payout/shops");
  const toast = useToast();

  const [shopId, setShopId] = useState("");
  const [dari, setDari] = useState(awalBulan());
  const [sampai, setSampai] = useState(hariIni());
  const [data, setData] = useState<Audit | null>(null);
  const [memuat, setMemuat] = useState(false);
  const [mengunggah, setMengunggah] = useState(false);

  async function jalankan() {
    setMemuat(true);
    try {
      const q = new URLSearchParams({ from: dari, to: sampai });
      if (shopId) q.set("shopId", shopId);
      setData(await api.get<Audit>(`/statements/audit-orders?${q.toString()}`));
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setMemuat(false);
    }
  }

  useEffect(() => {
    void jalankan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function unggah(f: File) {
    if (!shopId) {
      toast("Pilih tokonya dulu, supaya laporan menempel pada toko yang benar.", "warning");
      return;
    }
    setMengunggah(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("Berkas tidak terbaca."));
        r.readAsDataURL(f);
      });
      const d = await api.post<{ orders: number; withdrawals: number; linesSkipped: number }>(
        "/statements/import",
        { fileBase64: base64, fileName: f.name, shopId },
      );
      toast(
        `Laporan masuk: ${d.orders} pesanan, ${d.withdrawals} penarikan`
          + (d.linesSkipped ? `, ${d.linesSkipped} sudah ada sebelumnya.` : "."),
        "success",
      );
      void jalankan();
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setMengunggah(false);
    }
  }

  const t = data?.totals;

  return (
    <Layout title="Audit Pesanan">
      <PageHeader
        title="Audit Pesanan"
        subtitle="Yang sudah diserahkan ke kurir, lawan yang sudah dibayar marketplace."
      />

      <InlineAlert tone="info">
        Umur dihitung sejak <b>resi discan</b> — saat picker menyerahkan paket ke
        kurir. Sejak saat itulah marketplace berutang.
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
              Jalankan Audit
            </Button>
          </Field>
        </div>

        <div className="mt-4 border-t border-line pt-4">
          <div className="text-xs uppercase tracking-wide text-ink-3 mb-1">
            Unggah laporan marketplace toko ini
          </div>
          <p className="text-xs text-ink-3 mb-2">
            Berkas <code>income_…….xlsx</code> dari TikTok Shop. Pilih tokonya
            dulu di atas. Berkas yang sama tidak bisa masuk dua kali, dan pesanan
            yang sudah tercatat tidak digandakan meski periodenya tumpang tindih.
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

      {data && !data.adaPembanding && (
        <div className="mt-4">
          <InlineAlert tone="warning">
            Belum ada laporan marketplace untuk rentang ini. Semua pesanan akan
            terlihat “belum cair” bukan karena bermasalah, tapi karena belum ada
            pembandingnya — unggah dulu laporannya.
          </InlineAlert>
        </div>
      )}

      {t && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
            <Card>
              <div className="text-xs text-ink-3">Discan (diserahkan ke kurir)</div>
              <div className="text-lg text-ink tabular-nums">{t.discan}</div>
              <div className="text-xs text-ink-3">{t.bisaDiaudit} bisa diaudit</div>
            </Card>
            <Card>
              <div className="text-xs text-ink-3">Sudah dibayar</div>
              <div className="text-lg text-emerald-700 tabular-nums">{t.cocok}</div>
              <div className="text-xs text-ink-3">{rupiah(t.nilaiCocok)}</div>
            </Card>
            <Card>
              <div className="text-xs text-ink-3">Belum dibayar</div>
              <div
                className={`text-lg tabular-nums ${t.belumCair ? "text-amber-700" : "text-ink"}`}
              >
                {t.belumCair}
              </div>
              <div className="text-xs text-ink-3">
                tertua {t.umurTertua} hari · rata {t.umurRata} hari
              </div>
            </Card>
            <Card>
              <div className="text-xs text-ink-3">Dibayar tapi tak ada scannya</div>
              <div className={`text-lg tabular-nums ${t.belumDiscan ? "text-red-600" : "text-ink"}`}>
                {t.belumDiscan}
              </div>
              <div className="text-xs text-ink-3">{rupiah(t.nilaiBelumDiscan)}</div>
            </Card>
          </div>

          {data.biayaPesanan && data.biayaPesanan.ringkas.pesanan > 0 && (
              <Card className="mt-4" padded={false}>
                <CardHeader
                  title={`Potongan marketplace per pesanan (${data.biayaPesanan.ringkas.pesanan})`}
                  subtitle={
                    `Biasanya ${pct(data.biayaPesanan.ringkas.persenMedian)} dari harga jual. `
                    + `Rentang ${pct(data.biayaPesanan.ringkas.persenTerendah)}–`
                    + `${pct(data.biayaPesanan.ringkas.persenTertinggi)}. `
                    + `${data.biayaPesanan.ringkas.mencurigakan} pesanan dipotong di atas `
                    + `${pct(data.biayaPesanan.ringkas.ambangCuriga)}.`
                  }
                />
                <div className="px-5 pb-3 grid gap-2 sm:grid-cols-3 text-xs">
                  <div>
                    <div className="text-ink-3">Harga jual</div>
                    <div className="tabular-nums text-ink">
                      {rupiah(data.biayaPesanan.ringkas.pendapatan)}
                    </div>
                  </div>
                  <div>
                    <div className="text-ink-3">Dipotong marketplace</div>
                    <div className="tabular-nums text-ink">
                      {rupiah(data.biayaPesanan.ringkas.biaya)}{" "}
                      <span className="text-ink-3">
                        ({pct(data.biayaPesanan.ringkas.persenTertimbang)})
                      </span>
                    </div>
                  </div>
                  <div>
                    <div className="text-ink-3">Benar-benar cair</div>
                    <div className="tabular-nums text-ink">
                      {rupiah(data.biayaPesanan.ringkas.cair)}
                    </div>
                  </div>
                </div>
                {data.biayaPesanan.ringkas.tanpaPendapatan > 0 && (
                  <p className="px-5 pb-3 text-xs text-ink-3">
                    {data.biayaPesanan.ringkas.tanpaPendapatan} pesanan berpendapatan nol
                    (batal atau retur) tidak punya persentase — ditampilkan di bagian bawah
                    daftar tanpa angka.
                  </p>
                )}
                <TableWrap>
                  <Table>
                    <THead>
                      <TR>
                        <TH>Order ID</TH>
                        <TH>Sumber</TH>
                        <TH align="right">Harga jual</TH>
                        <TH align="right">Dipotong</TH>
                        <TH align="right">Cair</TH>
                        <TH align="right">Potongan</TH>
                      </TR>
                    </THead>
                    <tbody>
                      {data.biayaPesanan.baris.map((x) => (
                        <TR key={x.orderNo || `${x.tanggal}-${x.cair}`}>
                          <TD className="font-mono text-xs">{x.orderNo || "-"}</TD>
                          <TD className="text-xs text-ink-2">{x.sumber}</TD>
                          <TD align="right" className="tabular-nums">{rupiah(x.pendapatan)}</TD>
                          <TD align="right" className="tabular-nums">{rupiah(x.biaya)}</TD>
                          <TD align="right" className="tabular-nums">{rupiah(x.cair)}</TD>
                          <TD align="right" className="tabular-nums">
                            {x.persen == null ? (
                              // Bukan "0%". Pesanan yang dibatalkan tidak
                              // dipotong nol persen -- ia tidak punya
                              // persentase sama sekali.
                              <span className="text-ink-3" title="Batal atau retur">—</span>
                            ) : x.mencurigakan ? (
                              <Badge tone="danger">{pct(x.persen)}</Badge>
                            ) : (
                              <span>{pct(x.persen)}</span>
                            )}
                          </TD>
                        </TR>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
              </Card>
          )}

          {data.belumCair.length > 0 && (
            <Card className="mt-4" padded={false}>
              <CardHeader
                title={`Sudah dikirim, belum dibayar (${data.belumCair.length})`}
                subtitle="Diurut dari yang paling lama menggantung."
              />
              <TableWrap>
                <Table>
                  <THead>
                    <TR>
                      <TH>Umur</TH>
                      <TH>Order ID</TH>
                      <TH>Resi</TH>
                      <TH>Discan</TH>
                    </TR>
                  </THead>
                  <tbody>
                    {[...data.belumCair]
                      .sort((a, b) => b.umurHari - a.umurHari)
                      .map((x) => (
                        <TR key={x.resi}>
                          <TD>
                            <Umur hari={x.umurHari} />
                          </TD>
                          <TD>{x.orderNo}</TD>
                          <TD>{x.resi}</TD>
                          <TD>{new Date(x.scannedAt).toLocaleDateString("id-ID")}</TD>
                        </TR>
                      ))}
                  </tbody>
                </Table>
              </TableWrap>
            </Card>
          )}

          {data.belumDiscan.length > 0 && (
            <Card className="mt-4" padded={false}>
              <CardHeader
                title={`Dibayar marketplace, tapi tidak ada scannya (${data.belumDiscan.length})`}
                subtitle="Bisa berarti paket lolos dari meja packing, atau resinya belum dipetakan ke toko ini."
              />
              <TableWrap>
                <Table>
                  <THead>
                    <TR>
                      <TH>Order ID</TH>
                      <TH>Tanggal cair</TH>
                      <TH>Nominal</TH>
                    </TR>
                  </THead>
                  <tbody>
                    {data.belumDiscan.map((x) => (
                      <TR key={x.orderNo}>
                        <TD>{x.orderNo}</TD>
                        <TD>{x.tanggalCair}</TD>
                        <TD>{rupiah(x.nominal)}</TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            </Card>
          )}

          {data.tanpaOrderId.length > 0 && (
            <Card className="mt-4" padded={false}>
              <CardHeader
                title={`Tidak bisa diaudit — order id tak terbaca (${data.tanpaOrderId.length})`}
                subtitle="Bukan berarti bermasalah. Labelnya tidak terbaca, jadi tidak ada kuncinya untuk dipasangkan."
              />
              <TableWrap>
                <Table>
                  <THead>
                    <TR>
                      <TH>Resi</TH>
                      <TH>Discan</TH>
                      <TH>Umur</TH>
                      <TH>Terbaca sebagai</TH>
                    </TR>
                  </THead>
                  <tbody>
                    {data.tanpaOrderId.map((x) => (
                      <TR key={x.resi}>
                        <TD>{x.resi}</TD>
                        <TD>{new Date(x.scannedAt).toLocaleDateString("id-ID")}</TD>
                        <TD>
                          <Umur hari={x.umurHari} />
                        </TD>
                        <TD>
                          <span className="text-xs text-ink-3">
                            {x.tersimpanTapiTidakSah ?? "tidak terbaca sama sekali"}
                          </span>
                        </TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            </Card>
          )}

          {data.cocok.length > 0 && (
            <Card className="mt-4" padded={false}>
              <CardHeader
                title={`Sudah dibayar (${data.cocok.length})`}
                subtitle="Berapa hari dari diserahkan ke kurir sampai uangnya masuk."
              />
              <TableWrap>
                <Table>
                  <THead>
                    <TR>
                      <TH>Order ID</TH>
                      <TH>Resi</TH>
                      <TH>Cair</TH>
                      <TH>Lama</TH>
                      <TH>Nominal</TH>
                    </TR>
                  </THead>
                  <tbody>
                    {data.cocok.map((x) => (
                      <TR key={x.orderNo}>
                        <TD>{x.orderNo}</TD>
                        <TD>{x.resi}</TD>
                        <TD>{x.tanggalCair}</TD>
                        <TD>{x.hariSampaiCair} hari</TD>
                        <TD>{rupiah(x.nominal)}</TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            </Card>
          )}
        </>
      )}
    </Layout>
  );
}
