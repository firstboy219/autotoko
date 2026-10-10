import { Badge } from "./ui";

/** Harus sama dgn CustomersService.BuyerFlags (backend). */
export interface BuyerFlags {
  baru: boolean;
  batalKirim1: boolean;
  riskKirim: boolean;
  riskKirimCod: boolean;
  batalPra1: boolean;
  riskPra: boolean;
  setia: boolean;
}

/**
 * Badge kebiasaan pembeli — dipakai di Master Pelanggan & halaman Order.
 * Bertingkat: "sering" (>=2x, merah/amber) menonjol, "pernah" (1x) lebih kalem,
 * supaya packer tahu SETIAP riwayat pembatalan tanpa kehilangan sinyal yg parah.
 */
export function BuyerBadges({
  flags,
  batalKirim,
  batalPra,
}: {
  flags?: BuyerFlags | null;
  batalKirim?: number;
  batalPra?: number;
}) {
  if (!flags) return null;
  const cod = flags.riskKirimCod ? "COD " : "";
  const bk = batalKirim ?? (flags.riskKirim ? 2 : flags.batalKirim1 ? 1 : 0);
  const bp = batalPra ?? (flags.riskPra ? 2 : flags.batalPra1 ? 1 : 0);
  const any =
    flags.baru || flags.riskKirim || flags.batalKirim1 || flags.riskPra || flags.batalPra1 || flags.setia;
  if (!any) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 align-middle">
      {flags.baru && <Badge tone="info">Pelanggan baru</Badge>}
      {flags.riskKirim ? (
        <Badge tone="danger" icon="warning">
          Sering batal {cod}stlh kirim ({bk})
        </Badge>
      ) : flags.batalKirim1 ? (
        <Badge tone="warning" icon="warning">
          Pernah batal {cod}stlh kirim (1)
        </Badge>
      ) : null}
      {flags.riskPra ? (
        <Badge tone="warning">Sering batal sblm kirim ({bp})</Badge>
      ) : flags.batalPra1 ? (
        <Badge tone="neutral">Pernah batal sblm kirim (1)</Badge>
      ) : null}
      {flags.setia && (
        <Badge tone="success" icon="trending">
          Pelanggan setia · segerakan
        </Badge>
      )}
    </span>
  );
}
