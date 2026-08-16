import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";
import { dateShort } from "../lib/fmt";
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
                <TH>Dibuat</TH>
                <TH>Status</TH>
                <TH>Input Ditutup</TH>
                <TH>Batch Selesai</TH>
                <TH align="right" />
              </TR>
            </THead>
            <tbody>
              {loading ? (
                <SkeletonRows n={3} cols={5} />
              ) : !batches?.length ? (
                <TR>
                  <TD colSpan={5} className="p-0">
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
