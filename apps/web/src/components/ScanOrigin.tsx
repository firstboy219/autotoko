import { useState } from "react";
import { api } from "../lib/api";
import { useFetch } from "../lib/useFetch";
import { Badge, Button, Field, InlineAlert, Modal, Select, useToast } from "./ui";

/**
 * Setting where a parcel came from, from the web.
 *
 * The phone can only reach what it recently scanned. Everything recorded before
 * the mapping existed — and anything older than the history screen shows — is
 * only fixable here, and an unmapped parcel is invisible to every per-shop
 * figure on the dashboard. Without this the backlog would stay invisible for
 * ever, because the one tool that could fix it cannot see it.
 */

interface Shop {
  id: string;
  name: string;
  marketplace: string | null;
}

interface Options {
  shops: Shop[];
  couriers: string[];
  marketplaces: string[];
}

function useOptions() {
  return useFetch<Options>("/resi/mapping-options");
}

/** One scan. */
export function ScanOriginEditor({
  scanId,
  resi,
  current,
  onClose,
  onSaved,
}: {
  scanId: string;
  resi: string;
  current: { shopId?: string | null; courier?: string | null };
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const opts = useOptions();
  const [shopId, setShopId] = useState(current.shopId ?? "");
  const [courier, setCourier] = useState(current.courier ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!courier) {
      toast("Pilih kurirnya dulu.", "danger");
      return;
    }
    if (!shopId) {
      toast("Pilih tokonya dulu.", "danger");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/resi/scans/${scanId}/mapping`, { shopId, courier, by: "web" });
      toast("Asal paket disimpan.", "success");
      onSaved();
      onClose();
    } catch (e) {
      toast((e as Error).message, "danger");
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Asal paket — ${resi}`}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="text" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button variant="filled" onClick={save} loading={busy}>
            Simpan
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Toko">
          <Select value={shopId} onChange={(e) => setShopId(e.target.value)}>
            <option value="">— pilih toko —</option>
            {(opts.data?.shops ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.marketplace})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Kurir">
          <Select value={courier} onChange={(e) => setCourier(e.target.value)}>
            <option value="">— pilih kurir —</option>
            {(opts.data?.couriers ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <div className="text-xs text-ink-3">
          Marketplace ikut dari tokonya, jadi tidak perlu dipilih terpisah.
        </div>
      </div>
    </Modal>
  );
}

/** Many scans, for the backlog. */
export function ScanOriginBulk({
  scanIds,
  onClose,
  onSaved,
}: {
  scanIds: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const opts = useOptions();
  const [shopId, setShopId] = useState("");
  const [courier, setCourier] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!shopId || !courier) {
      toast("Pilih toko dan kurirnya dulu.", "danger");
      return;
    }
    setBusy(true);
    try {
      const r = await api.post<{ updated: number }>("/resi/scans/mapping-bulk", {
        scanIds,
        shopId,
        courier,
      });
      toast(`${r.updated} resi dipetakan.`, "success");
      onSaved();
      onClose();
    } catch (e) {
      toast((e as Error).message, "danger");
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Petakan ${scanIds.length} resi sekaligus`}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="text" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button variant="filled" onClick={save} loading={busy}>
            Petakan {scanIds.length} resi
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {/* Said plainly because the mistake is invisible afterwards: the result
            of filing a month of mixed parcels under one shop looks exactly like
            careful work. */}
        <InlineAlert tone="warning">
          Semua resi yang dicentang akan dicatat berasal dari toko dan kurir yang sama.
          Pastikan memang begitu — setelah tersimpan, hasilnya tidak bisa dibedakan dari
          pemetaan satu per satu.
        </InlineAlert>
        <Field label="Toko">
          <Select value={shopId} onChange={(e) => setShopId(e.target.value)}>
            <option value="">— pilih toko —</option>
            {(opts.data?.shops ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.marketplace})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Kurir">
          <Select value={courier} onChange={(e) => setCourier(e.target.value)}>
            <option value="">— pilih kurir —</option>
            {(opts.data?.couriers ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

/** The cell in the scan table: shows the mapping, or offers to make one. */
export function ScanOriginCell({
  scan,
  onEdit,
}: {
  scan: {
    mappedShopName?: string | null;
    marketplace?: string | null;
    courierConfirmed?: string | null;
  };
  onEdit: () => void;
}) {
  if (!scan.mappedShopName) {
    return (
      <button onClick={onEdit} className="text-left">
        <Badge tone="warning">belum dipetakan</Badge>
        <div className="mt-0.5 text-[11px] text-brand-ink underline">petakan sekarang</div>
      </button>
    );
  }
  return (
    <button onClick={onEdit} className="text-left hover:underline">
      <div className="text-[13px] text-ink">{scan.mappedShopName}</div>
      <div className="text-[11px] text-ink-2">
        {scan.marketplace ?? "-"}
        {scan.courierConfirmed ? ` · ${scan.courierConfirmed}` : ""}
      </div>
    </button>
  );
}
