import { Fragment, useEffect, useState } from "react";
import { SectionTabs } from "../components/SectionTabs";
import { Link, useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";
import { dateShort, rupiah } from "../lib/fmt";
import { Icon, type IconName } from "../components/Icon";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmModal,
  EmptyState,
  InlineAlert,
  PageHeader,
  Table,
  TableWrap,
  TD,
  TH,
  THead,
  TR,
  SkeletonRows,
  useToast,
} from "../components/ui";

interface Batch {
  id: string;
  status: "berjalan" | "siap_distribusi" | "selesai";
  code: string | null;
  adminFeeAmount: string | null;
  adminFeePaidAt: string | null;
  closedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}
interface Settings {
  sedekahRate: string;
  sedekahBasis: "total_credit" | "after_subseller_split";
  sedekahBankAccount: string | null;
  materialReserveRate: string;
}

const STATUS_LABEL: Record<Batch["status"], string> = {
  berjalan: "Berjalan",
  siap_distribusi: "Siap Distribusi",
  selesai: "Selesai",
};
const STATUS_TONE: Record<Batch["status"], "info" | "warning" | "success"> = {
  berjalan: "info",
  siap_distribusi: "warning",
  selesai: "success",
};
const BASIS_LABEL: Record<Settings["sedekahBasis"], string> = {
  total_credit: "Total Kredit Awal",
  after_subseller_split: "Sisa Setelah Split Sub-seller",
};

/** Compact navigation tile — these are shortcuts, not primary actions, so they
 *  stay visually quiet compared to "Mulai Batch Baru". */
function NavTile({
  to,
  icon,
  title,
  desc,
}: {
  to: string;
  icon: IconName;
  title: string;
  desc: string;
}) {
  return (
    <Link
      to={to}
      className="group flex items-start gap-3 rounded-lg border border-line bg-white p-4 hover:bg-canvas transition"
    >
      <span className="w-9 h-9 rounded-lg bg-canvas border border-line flex items-center justify-center text-ink-2 shrink-0">
        <Icon name={icon} size={18} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="block text-xs text-ink-2 mt-0.5">{desc}</span>
      </span>
      <Icon
        name="chevronRight"
        size={16}
        className="ml-auto text-ink-3 group-hover:text-ink-2 shrink-0"
      />
    </Link>
  );
}

interface SaldoToko {
  shopId: string;
  shopName: string | null;
  currency: string | null;
  saldo: number | null;
  penghasilan?: number;
  penarikan?: number;
  penarikanDiproses?: number;
  transfer?: number;
  adaTransfer?: boolean;
  perluCutoff?: boolean;
  cutoff?: { tanggal: string; saldo: number } | null;
  deltaSejakCutoff?: number;
  transferSejakCutoff?: number;
  mutasi?: number;
  belumDicek?: boolean;
  error?: string;
}
interface SaldoResp {
  toko: SaldoToko[];
  total: number;
  diperbaruiPada: string | null;
  cached?: boolean;
}

/**
 * Saldo bisa ditarik per toko, diambil dari TikTok Finance API. TikTok tak
 * punya endpoint saldo langsung, jadi ini direkonstruksi dari mutasi
 * (Get Withdrawals): SETTLE masuk - WITHDRAW keluar. Dimuat saat diklik
 * (bukan otomatis) karena memanggil API marketplace per toko.
 */
function SaldoTiktokCard() {
  const [data, setData] = useState<SaldoResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editShop, setEditShop] = useState<string | null>(null);
  const [fTanggal, setFTanggal] = useState("");
  const [fSaldo, setFSaldo] = useState("");
  const [saving, setSaving] = useState(false);

  const muat = async (live: boolean) => {
    setLoading(true);
    setErr(null);
    try {
      setData(await api.get<SaldoResp>(`/marketplace-sync/saldo-tiktok${live ? "?live=1" : ""}`));
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  };
  // Langsung tampil dari data tersimpan saat halaman dibuka (tanpa panggil API).
  useEffect(() => { void muat(false); }, []);

  const bukaForm = (t: SaldoToko) => {
    setEditShop(t.shopId);
    setFTanggal(t.cutoff?.tanggal ?? new Date().toISOString().slice(0, 10));
    setFSaldo(t.cutoff ? String(t.cutoff.saldo) : "");
  };
  const simpanCutoff = async (shopId: string) => {
    setSaving(true);
    setErr(null);
    try {
      await api.post("/marketplace-sync/saldo-cutoff", {
        shopId, tanggal: fTanggal, saldo: Number(fSaldo.replace(/[^0-9.-]/g, "")) || 0,
      });
      setEditShop(null);
      await muat(true);
    } catch (e) { setErr((e as Error).message); }
    finally { setSaving(false); }
  };
  const hapusCutoff = async (shopId: string) => {
    setSaving(true);
    try {
      await api.post("/marketplace-sync/saldo-cutoff", { shopId, tanggal: null, saldo: null });
      setEditShop(null);
      await muat(true);
    } catch (e) { setErr((e as Error).message); }
    finally { setSaving(false); }
  };

  const rows = data?.toko ?? [];
  return (
    <Card className="mb-4" padded={false}>
      <CardHeader
        title="Saldo bisa ditarik (TikTok)"
        subtitle="Penghasilan (SETTLE) − penarikan sukses & yang sedang diproses (WITHDRAW). Angka tersimpan; klik “Update saldo” untuk cek terkini dari TikTok."
        action={
          <Button size="sm" variant="filled" loading={loading} onClick={() => muat(true)}>
            Update saldo
          </Button>
        }
      />
      <div className="p-4">
        {err && (
          <div className="mb-2">
            <InlineAlert tone="danger">{err}</InlineAlert>
          </div>
        )}
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <div className="text-xs text-ink-3">Total saldo bisa ditarik (semua toko)</div>
            <div className="text-2xl font-semibold text-emerald-700 tabular-nums">{rupiah(data?.total ?? 0)}</div>
          </div>
          {data?.diperbaruiPada && (
            <div className="text-[11px] text-ink-3 whitespace-nowrap">diperbarui {dateShort(data.diperbaruiPada)}</div>
          )}
        </div>
        <TableWrap>
          <Table>
            <THead>
              <TR>
                <TH>Toko</TH>
                <TH>Rincian</TH>
                <TH align="right">Saldo</TH>
              </TR>
            </THead>
            <tbody>
              {loading && !data ? (
                <SkeletonRows n={3} cols={3} />
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-sm text-ink-3">
                    Tidak ada toko TikTok yang tersambung API.
                  </td>
                </tr>
              ) : (
                rows.map((t) => (
                  <Fragment key={t.shopId}>
                    <TR>
                      <TD className="text-sm text-ink">{t.shopName ?? t.shopId}</TD>
                      <TD>
                        {t.error ? (
                          <span className="text-[11px] text-red-600">{t.error}</span>
                        ) : t.belumDicek ? (
                          <span className="text-[11px] text-ink-3">belum dicek — klik “Update saldo”</span>
                        ) : t.cutoff ? (
                          <span className="text-[11px] text-ink-3 tabular-nums">
                            cutoff {t.cutoff.tanggal} {rupiah(t.cutoff.saldo)} · Δ {rupiah(t.deltaSejakCutoff ?? 0)}
                            {(t.penarikanDiproses ?? 0) > 0 && (
                              <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-amber-700" title="Penarikan yang sedang diproses TikTok — sudah ikut dikurangi dari saldo bisa ditarik.">diproses {rupiah(t.penarikanDiproses ?? 0)}</span>
                            )}
                            <button type="button" onClick={() => bukaForm(t)} className="ml-1 text-brand hover:underline">ubah</button>
                            {(t.transferSejakCutoff ?? 0) > 0 && (
                              <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-amber-700" title="Transfer saldo keluar (mis. top-up Saldo Iklan) sejak cutoff — sudah ikut dikurangi dari saldo bisa ditarik.">transfer keluar {rupiah(t.transferSejakCutoff ?? 0)}</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-[11px] text-ink-3 tabular-nums">
                            penghasilan {rupiah(t.penghasilan ?? 0)} · penarikan {rupiah(t.penarikan ?? 0)}
                            {(t.penarikanDiproses ?? 0) > 0 && (
                              <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-amber-700" title="Penarikan yang sedang diproses TikTok — sudah ikut dikurangi dari saldo bisa ditarik.">diproses {rupiah(t.penarikanDiproses ?? 0)}</span>
                            )}
                            {t.perluCutoff && (
                              <button type="button" onClick={() => bukaForm(t)} className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-amber-700 hover:bg-amber-200" title="Toko pakai Saldo Cepat; API tak beri arah mutasinya. Matikan Saldo Cepat di Seller Center, lalu isi saldo saat ini sebagai cutoff.">pakai Saldo Cepat — set cutoff</button>
                            )}
                          </span>
                        )}
                      </TD>
                      <TD align="right" className="tabular-nums whitespace-nowrap">
                        {t.saldo == null ? (
                          <span className="text-ink-3">—</span>
                        ) : (
                          <span className="font-semibold text-emerald-700">{rupiah(t.saldo)}</span>
                        )}
                      </TD>
                    </TR>
                    {editShop === t.shopId && (
                      <tr>
                        <td colSpan={3} className="px-3 pb-2">
                          <div className="rounded bg-ink/[0.03] p-2">
                            <div className="mb-1 text-[11px] text-ink-3">
                              Isi saldo cutoff dari Seller Center (“Nominal yang Bisa Ditarik”) SETELAH Saldo Cepat dimatikan. Saldo berikutnya = cutoff + penghasilan − penarikan − transfer keluar sejak tanggal ini. Isi dengan saldo PER AKHIR tanggal tsb (bukan saldo hari ini bila tanggalnya lampau).
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <input type="date" value={fTanggal} onChange={(e) => setFTanggal(e.target.value)} className="rounded border border-line px-2 py-1 text-xs" />
                              <input type="text" inputMode="numeric" placeholder="saldo (Rp)" value={fSaldo} onChange={(e) => setFSaldo(e.target.value)} className="w-32 rounded border border-line px-2 py-1 text-xs tabular-nums" />
                              <Button size="sm" variant="filled" loading={saving} onClick={() => simpanCutoff(t.shopId)}>Simpan</Button>
                              <button type="button" onClick={() => setEditShop(null)} className="text-xs text-ink-3 hover:text-ink">Batal</button>
                              {t.cutoff && (
                                <button type="button" onClick={() => hapusCutoff(t.shopId)} className="ml-auto text-xs text-red-600 hover:underline">Hapus cutoff</button>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))
              )}
            </tbody>
          </Table>
        </TableWrap>
      </div>
    </Card>
  );
}

export function Pencairan() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: batches, loading, reload } = useFetch<Batch[]>("/payout/batches");
  const { data: settings } = useFetch<Settings>("/payout/settings");
  const [busy, setBusy] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /**
   * Every batch still taking input, not "the" one.
   *
   * Several can run at once — a batch is entered by id and every payout is
   * recorded against that id, so two open batches never compete for a
   * mutation. What used to stop it was this page assuming there could only be
   * one, and hiding the "start" button behind it.
   */
  const openBatches = (batches ?? []).filter((b) => b.status === "berjalan");

  async function startBatch() {
    setBusy(true);
    setErr(null);
    try {
      const created = await api.post<{ id: string }>("/payout/batches");
      toast("Batch baru dimulai", "success");
      if (created?.id) navigate(`/pencairan/batch/${created.id}`);
      else reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelBatch(id: string) {
    setCancelBusy(true);
    setErr(null);
    try {
      await api.del(`/payout/batches/${id}`);
      toast("Batch dibatalkan", "success");
      reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCancelBusy(false);
      setCancelId(null);
    }
  }

  return (
    <Layout title="Pencairan Dana">
      <SectionTabs tabs={[{ to: "/pencairan", label: "Pencairan" }, { to: "/rekonsiliasi", label: "Rekonsiliasi" }]} />
      <PageHeader
        title="Pencairan Dana"
        subtitle="Rekam pencairan tiap toko, lalu distribusikan ke sedekah dan sub-seller."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* Kept as a shortcut, not as a gate. With more than one running
                there is no single "the" batch to continue, so the shortcut
                only appears when it is unambiguous. */}
            {openBatches.length === 1 && (
              <Button
                variant="outline"
                iconRight="arrowRight"
                onClick={() => navigate(`/pencairan/batch/${openBatches[0]!.id}`)}
              >
                Lanjutkan Batch Berjalan
              </Button>
            )}
            <Button variant="filled" icon="plus" loading={busy} onClick={startBatch}>
              Mulai Batch Baru
            </Button>
          </div>
        }
      />

      <SaldoTiktokCard />

      {err && (
        <div className="mb-4">
          <InlineAlert tone="danger">{err}</InlineAlert>
        </div>
      )}

      {/* Keterangan, bukan larangan. Batch berjalan lebih dari satu itu wajar:
          pencairan tiap marketplace datang di hari yang berbeda dan tidak
          harus saling menunggu. */}
      {openBatches.length > 0 && (
        <div className="mb-4">
          <InlineAlert tone="info">
            {openBatches.length === 1
              ? "Ada 1 batch yang masih berjalan. Boleh dilanjutkan, boleh juga mulai batch baru di sebelahnya — pencairan yang direkam selalu masuk ke batch yang sedang dibuka."
              : `Ada ${openBatches.length} batch berjalan sekaligus. Setiap pencairan masuk ke batch yang sedang dibuka, jadi pastikan membuka batch yang benar sebelum merekam.`}
            {openBatches.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {openBatches.map((b, i) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => navigate(`/pencairan/batch/${b.id}`)}
                    className="rounded border border-line px-2 py-1 text-xs text-ink-2 hover:text-brand"
                  >
                    Batch {b.code ? `#${b.code}` : b.id.slice(0, 8)}
                  </button>
                ))}
              </div>
            )}
          </InlineAlert>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
        <NavTile
          to="/pencairan/pengaturan"
          icon="settings"
          title="Pengaturan Sedekah"
          desc={
            settings
              ? `${(Number(settings.sedekahRate) * 100).toFixed(1)}% · ${BASIS_LABEL[settings.sedekahBasis]}` +
                (Number(settings.materialReserveRate ?? 0) > 0
                  ? ` · bahan baku ${(Number(settings.materialReserveRate) * 100).toFixed(1)}% dari seller`
                  : "")
              : "Memuat…"
          }
        />
        <NavTile
          to="/pencairan/sub-seller"
          icon="users"
          title="Sub-seller"
          desc="Kelola sub-seller, sub-sub-seller, dan penugasan toko"
        />
        <NavTile
          to="/pencairan/mapping"
          icon="link"
          title="Mapping Toko"
          desc="Kepemilikan tiap toko dan rekening tujuannya"
        />
      </div>

      <Card padded={false}>
        <CardHeader
          title="Daftar Batch"
          action={
            <Link
              to="/pencairan/mutasi"
              className="inline-flex items-center gap-1 text-sm text-brand-ink hover:underline"
            >
              Lihat semua mutasi <Icon name="arrowRight" size={14} />
            </Link>
          }
        />
        <TableWrap>
          <Table>
            <THead>
              <TR className="border-t-0">
                <TH>Kode</TH>
                <TH>Fee admin</TH>
                <TH>Dibuat</TH>
                <TH>Status</TH>
                <TH>Input Ditutup</TH>
                <TH>Batch Selesai</TH>
                <TH align="right" />
              </TR>
            </THead>
            <tbody>
              {loading ? (
                <SkeletonRows n={3} cols={7} />
              ) : !batches?.length ? (
                <TR>
                  <TD colSpan={7} className="p-0">
                    <EmptyState
                      icon="banknote"
                      title="Belum ada batch"
                      description="Mulai batch baru untuk mencatat pencairan dari tiap toko."
                      action={
                        <Button variant="filled" icon="plus" loading={busy} onClick={startBatch}>
                          Mulai Batch Baru
                        </Button>
                      }
                    />
                  </TD>
                </TR>
              ) : (
                batches.map((b) => (
                  <TR key={b.id}>
                    {/* Monospace: three characters read back over the phone are
                        easier to check against when the glyphs line up. */}
                    <TD className="font-mono text-ink">
                      {b.code ? `#${b.code}` : "—"}
                    </TD>
                    {/* Kenapa ada tiga keadaan, bukan dua: batch yang dibuat
                        sebelum fitur ini menyala tidak punya fee sama sekali,
                        dan itu bukan hal yang sama dengan fee yang belum
                        dibayar. */}
                    <TD>
                      {b.adminFeeAmount == null ? (
                        <span className="text-ink-3">—</span>
                      ) : b.adminFeePaidAt ? (
                        <Badge tone="success">sudah</Badge>
                      ) : (
                        <Badge tone="warning">belum</Badge>
                      )}
                    </TD>
                    <TD className="text-ink">{dateShort(b.createdAt)}</TD>
                    <TD>
                      <Badge tone={STATUS_TONE[b.status]}>{STATUS_LABEL[b.status]}</Badge>
                    </TD>
                    <TD className="text-ink-2">{b.closedAt ? dateShort(b.closedAt) : "—"}</TD>
                    <TD className="text-ink-2">{b.completedAt ? dateShort(b.completedAt) : "—"}</TD>
                    <TD align="right">
                      <div className="flex items-center justify-end gap-3">
                        {b.status !== "selesai" && (
                          <button
                            onClick={() => setCancelId(b.id)}
                            className="text-sm text-red-600 hover:underline"
                          >
                            Batalkan
                          </button>
                        )}
                        <Link
                          to={`/pencairan/batch/${b.id}`}
                          className="inline-flex items-center gap-1 text-sm text-brand-ink hover:underline"
                        >
                          Detail <Icon name="chevronRight" size={14} />
                        </Link>
                      </div>
                    </TD>
                  </TR>
                ))
              )}
            </tbody>
          </Table>
        </TableWrap>
      </Card>

      <ConfirmModal
        open={cancelId !== null}
        onClose={() => setCancelId(null)}
        onConfirm={() => cancelId && cancelBatch(cancelId)}
        loading={cancelBusy}
        title="Batalkan batch ini?"
        confirmLabel="Batalkan Batch"
        description="Semua mutasi & rekap transfer di dalamnya akan terhapus permanen dan tidak bisa dikembalikan."
      />
    </Layout>
  );
}
