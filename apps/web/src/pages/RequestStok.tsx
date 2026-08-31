import { useEffect, useMemo, useState } from "react";
import { Layout } from "../components/Layout";
import { FileUpload } from "../components/FileUpload";
import { api } from "../lib/api";
import { useFetch } from "../lib/useFetch";
import { rupiah } from "../lib/fmt";
import {
  Button,
  Card,
  CardHeader,
  Field,
  InlineAlert,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from "../components/ui";

/**
 * Permintaan pembelian stok, dikirim ke pemasok lewat WhatsApp.
 *
 * MENGGANTIKAN rekap stok. Rekap menjawab "apa yang ada di rak"; yang
 * dibutuhkan justru langkah sesudahnya -- "apa yang harus dibeli, berapa
 * banyak, berapa harganya" -- dan itu berakhir di WhatsApp pemasok, bukan di
 * layar.
 *
 * DUA SATUAN DI SETIAP BARIS, dan itu inti halamannya. Pemasok menjual "2
 * botol"; rak menghitung "2.000 ml". Selama ini terjemahan itu dikerjakan
 * orang di kepalanya ke dalam kolom yang hanya berlabel "ml" -- dan mengetik 2
 * untuk dua botol satu liter adalah pembacaan yang wajar, yang mengkredit rak
 * dengan seperseribu dari yang datang. Di sini keduanya diketik dan
 * terjemahannya diperlihatkan sambil mengetik.
 */

interface Material {
  id: string;
  name: string;
  unit: string | null;
}

interface ItemRow {
  materialId: string;
  rawName: string;
  qtyPack: string;
  packLabel: string;
  contentPerPack: string;
  contentUnit: string;
  unitPrice: string;
}

interface RequestRow {
  id: string;
  screenshotUrl: string;
  note: string | null;
  status: string;
  totalCost: string;
  sentAt: string | null;
  createdAt: string;
}

const BARIS_KOSONG: ItemRow = {
  materialId: "",
  rawName: "",
  qtyPack: "1",
  packLabel: "pcs",
  contentPerPack: "",
  contentUnit: "",
  unitPrice: "",
};

/**
 * Satuan isi yang ditawarkan.
 *
 * Sengaja pendek. Daftar panjang membuat orang mencari; yang benar-benar
 * dipakai pemasok bahan baku toko ini cuma segelintir, dan yang tidak ada
 * tinggal diketik ke kolomnya.
 */
const SATUAN_ISI = ["", "ml", "liter", "gram", "kg", "pcs", "lembar", "meter"];

export function RequestStok() {
  const toast = useToast();
  const materials = useFetch<Material[]>("/materials");
  const daftar = useFetch<RequestRow[]>("/stock-requests");

  const [screenshot, setScreenshot] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<ItemRow[]>([{ ...BARIS_KOSONG }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** Id draft yang sedang disunting, atau null untuk permintaan baru. */
  const [sunting, setSunting] = useState<string | null>(null);

  const bahanById = useMemo(
    () => new Map((materials.data ?? []).map((m) => [m.id, m])),
    [materials.data],
  );

  function ubah(i: number, patch: Partial<ItemRow>) {
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }

  /**
   * Terjemahan yang diperlihatkan sambil mengetik.
   *
   * Dihitung di layar HANYA untuk diperlihatkan; yang disimpan tetap hitungan
   * server. Dua penghitung untuk satu angka akan berbeda suatu saat, dan yang
   * benar adalah yang tersimpan.
   */
  function terjemahan(row: ItemRow): { teks: string; ragu: boolean } {
    const m = row.materialId ? bahanById.get(row.materialId) : null;
    const qty = Number(row.qtyPack) || 0;
    if (!m?.unit) return { teks: "", ragu: false };
    if (!row.contentPerPack || !row.contentUnit) {
      return { teks: `${qty} ${m.unit}`, ragu: false };
    }
    const isi = Number(row.contentPerPack) || 0;
    const FAKTOR: Record<string, [string, number]> = {
      ml: ["ml", 1], liter: ["ml", 1000], l: ["ml", 1000],
      gram: ["gram", 1], gr: ["gram", 1], g: ["gram", 1], kg: ["gram", 1000],
      pcs: ["pcs", 1], lembar: ["pcs", 1], meter: ["meter", 1],
    };
    const a = FAKTOR[row.contentUnit.toLowerCase()];
    const b = FAKTOR[m.unit.toLowerCase()];
    if (!a || !b || a[0] !== b[0]) {
      // Tidak sepadan: liter untuk bahan yang dicatat per pcs. Ditandai, bukan
      // dihitung jadi nol -- nol akan tersimpan sebagai "tidak ada yang datang".
      return { teks: `satuan "${row.contentUnit}" tidak sepadan dengan "${m.unit}"`, ragu: true };
    }
    const hasil = (qty * isi * a[1]) / b[1];
    return { teks: `${hasil.toLocaleString("id-ID")} ${m.unit}`, ragu: false };
  }

  const total = rows.reduce(
    (a, r) => a + (Number(r.unitPrice) || 0) * (Number(r.qtyPack) || 0),
    0,
  );
  const adaIsi = rows.some((r) => r.materialId || r.rawName.trim());
  const bisaSimpan = screenshot.trim() !== "" && adaIsi && !busy;

  async function simpan(kirim: boolean) {
    setBusy(true);
    setErr(null);
    try {
      const body = {
        screenshotUrl: screenshot,
        note: note || undefined,
        items: rows
          .filter((r) => r.materialId || r.rawName.trim())
          .map((r) => ({
            materialId: r.materialId || undefined,
            rawName: r.rawName || undefined,
            qtyPack: Number(r.qtyPack) || 0,
            packLabel: r.packLabel || undefined,
            contentPerPack: r.contentPerPack ? Number(r.contentPerPack) : undefined,
            contentUnit: r.contentUnit || undefined,
            unitPrice: r.unitPrice ? Number(r.unitPrice) : undefined,
          })),
      };
      // PATCH saat menyunting, POST saat baru. Tanpa ini "Simpan saja"
      // menumpuk draft baru setiap kali disimpan, dan yang lama tertinggal
      // sebagai sampah yang mirip satu sama lain.
      const dibuat = sunting
        ? await api.patch<{ id: string }>(`/stock-requests/${sunting}`, body)
        : await api.post<{ id: string }>("/stock-requests", body);
      if (!kirim) {
        toast("Permintaan tersimpan", "success");
      } else {
        // Teks diminta ke server, bukan disusun di sini: satu sumber kebenaran
        // untuk yang akan terkirim ke pemasok.
        const wa = await api.get<{ teks: string }>(`/stock-requests/${dibuat.id}/wa?tandai=1`);
        window.open(`https://wa.me/?text=${encodeURIComponent(wa.teks)}`, "_blank");
        toast("Permintaan dikirim lewat WhatsApp", "success");
      }
      batalSunting();
      daftar.reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Membuka draft ke dalam form.
   *
   * Hanya draft. Yang sudah dikirim tidak dibuka untuk disunting -- pemasok
   * sudah memegang versinya, dan mengubah catatan di sini akan membuat kedua
   * pihak memegang daftar yang berbeda tanpa ada yang tahu.
   */
  async function bukaDraft(id: string) {
    setErr(null);
    try {
      const d = await api.get<{
        screenshotUrl: string;
        note: string | null;
        status: string;
        items: {
          materialId: string | null;
          rawName: string | null;
          qtyPack: string;
          packLabel: string | null;
          contentPerPack: string | null;
          contentUnit: string | null;
          unitPrice: string | null;
        }[];
      }>(`/stock-requests/${id}`);
      if (d.status === "dikirim") {
        toast("Permintaan ini sudah dikirim — buat yang baru untuk perubahan.", "warning");
        return;
      }
      setSunting(id);
      setScreenshot(d.screenshotUrl ?? "");
      setNote(d.note ?? "");
      setRows(
        d.items.length
          ? d.items.map((i) => ({
              materialId: i.materialId ?? "",
              rawName: i.rawName ?? "",
              qtyPack: String(Number(i.qtyPack) || 0),
              packLabel: i.packLabel ?? "pcs",
              contentPerPack: i.contentPerPack == null ? "" : String(Number(i.contentPerPack)),
              contentUnit: i.contentUnit ?? "",
              unitPrice: i.unitPrice == null ? "" : String(Math.round(Number(i.unitPrice))),
            }))
          : [{ ...BARIS_KOSONG }],
      );
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  function batalSunting() {
    setSunting(null);
    setScreenshot("");
    setNote("");
    setRows([{ ...BARIS_KOSONG }]);
  }

  async function bagikanUlang(id: string) {
    try {
      const wa = await api.get<{ teks: string }>(`/stock-requests/${id}/wa`);
      window.open(`https://wa.me/?text=${encodeURIComponent(wa.teks)}`, "_blank");
    } catch (e) {
      toast((e as Error).message, "danger");
    }
  }

  return (
    <Layout title="Request Pembelian Stok">
      <PageHeader
        title="Request Pembelian Stok"
        subtitle="Unggah tangkapan layar marketplace, petakan ke master bahan baku, lalu kirim ke pemasok lewat WhatsApp. Pembayaran transfer (non-COD)."
      />

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title={sunting ? "Menyunting draft" : "Permintaan baru"}
            subtitle="Satu permintaan boleh memuat banyak bahan."
            action={
              sunting ? (
                <Button type="button" size="sm" variant="text" onClick={batalSunting}>
                  Batal, buat baru
                </Button>
              ) : undefined
            }
          />
          <div className="p-5 space-y-4">
            <Field
              label="Tangkapan layar marketplace"
              hint="Wajib. Tanpa ini permintaannya tidak bisa diperiksa ulang oleh siapa pun sesudahnya."
            >
              <FileUpload
                value={screenshot}
                onChange={setScreenshot}
                label="Unggah tangkapan layar Shopee"
              />
            </Field>

            <div className="space-y-3">
              {rows.map((row, i) => {
                const t = terjemahan(row);
                return (
                  <div key={i} className="rounded-lg border border-line p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 grid gap-2 sm:grid-cols-2">
                        <Field label="Bahan baku" hint="Kosongkan bila belum ada di master">
                          <Select
                            value={row.materialId}
                            onChange={(e) => ubah(i, { materialId: e.target.value })}
                          >
                            <option value="">— belum dipetakan —</option>
                            {(materials.data ?? []).map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name} ({m.unit ?? "-"})
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Nama di marketplace">
                          <Input
                            value={row.rawName}
                            onChange={(e) => ubah(i, { rawName: e.target.value })}
                            placeholder="seperti tertulis di tangkapan layar"
                          />
                        </Field>
                      </div>
                      {rows.length > 1 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="text"
                          onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
                        >
                          Hapus
                        </Button>
                      )}
                    </div>

                    <div className="grid gap-2 sm:grid-cols-5">
                      <Field label="Jumlah">
                        <Input
                          inputMode="decimal"
                          value={row.qtyPack}
                          onChange={(e) => ubah(i, { qtyPack: e.target.value.replace(/[^\d.]/g, "") })}
                          className="tabular-nums"
                        />
                      </Field>
                      <Field label="Kemasan">
                        <Input
                          value={row.packLabel}
                          onChange={(e) => ubah(i, { packLabel: e.target.value })}
                          placeholder="botol"
                        />
                      </Field>
                      <Field label="Isi per kemasan">
                        <Input
                          inputMode="decimal"
                          value={row.contentPerPack}
                          onChange={(e) =>
                            ubah(i, { contentPerPack: e.target.value.replace(/[^\d.]/g, "") })
                          }
                          className="tabular-nums"
                          placeholder="1"
                        />
                      </Field>
                      <Field label="Satuan isi">
                        <Select
                          value={row.contentUnit}
                          onChange={(e) => ubah(i, { contentUnit: e.target.value })}
                        >
                          {SATUAN_ISI.map((u) => (
                            <option key={u} value={u}>
                              {u || "—"}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Harga per kemasan">
                        <Input
                          inputMode="numeric"
                          value={row.unitPrice}
                          onChange={(e) => ubah(i, { unitPrice: e.target.value.replace(/\D/g, "") })}
                          className="tabular-nums"
                          placeholder="0"
                        />
                      </Field>
                    </div>

                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                      {t.teks ? (
                        <span className={t.ragu ? "text-amber-700" : "text-ink-2"}>
                          Masuk ke stok sebagai <strong>{t.teks}</strong>
                        </span>
                      ) : (
                        <span className="text-ink-3">Pilih bahan baku untuk melihat terjemahannya</span>
                      )}
                      <span className="tabular-nums text-ink-2">
                        {rupiah((Number(row.unitPrice) || 0) * (Number(row.qtyPack) || 0))}
                      </span>
                    </div>
                  </div>
                );
              })}

              <Button
                type="button"
                variant="outline"
                icon="plus"
                onClick={() => setRows((r) => [...r, { ...BARIS_KOSONG }])}
              >
                Tambah bahan
              </Button>
            </div>

            <Field label="Catatan untuk pemasok" hint="Opsional">
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>

            {err && <InlineAlert tone="danger">{err}</InlineAlert>}
            {screenshot.trim() === "" && (
              <InlineAlert tone="warning">
                Tangkapan layar belum diunggah — permintaan belum bisa dikirim.
              </InlineAlert>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                Total: <strong className="tabular-nums">{rupiah(total)}</strong>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  loading={busy}
                  disabled={!bisaSimpan}
                  onClick={() => simpan(false)}
                >
                  Simpan saja
                </Button>
                <Button
                  type="button"
                  variant="filled"
                  icon="whatsapp"
                  loading={busy}
                  disabled={!bisaSimpan}
                  onClick={() => simpan(true)}
                >
                  Request via WhatsApp
                </Button>
              </div>
            </div>
          </div>
        </Card>

        <Card padded={false}>
          <CardHeader title="Permintaan sebelumnya" />
          <div className="p-4">
            {daftar.loading ? (
              <Skeleton className="h-24" />
            ) : (daftar.data ?? []).length === 0 ? (
              <p className="text-xs text-ink-3">Belum ada permintaan.</p>
            ) : (
              <ul className="space-y-2">
                {(daftar.data ?? []).map((r) => (
                  <li key={r.id} className="rounded-lg border border-line p-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs text-ink-2">
                        {new Date(r.createdAt).toLocaleDateString("id-ID")}
                      </span>
                      <span className="text-xs text-ink-3">
                        {r.status === "dikirim" ? "sudah dikirim" : "draft"}
                      </span>
                    </div>
                    <div className="mt-0.5 text-sm font-medium text-ink tabular-nums">
                      {rupiah(Number(r.totalCost))}
                    </div>
                    <div className="flex gap-1">
                      {r.status !== "dikirim" && (
                        <Button
                          type="button"
                          size="sm"
                          variant="text"
                          onClick={() => bukaDraft(r.id)}
                        >
                          Sunting
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="text"
                        onClick={() => bagikanUlang(r.id)}
                      >
                        Bagikan lagi
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </Layout>
  );
}
