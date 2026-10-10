import { Badge } from "./ui";

/** Harus sama dgn CustomersService.BuyerFlags (backend). */
export interface BuyerFlags {
  baru: boolean;
  riskKirim: boolean;
  riskKirimCod: boolean;
  riskPra: boolean;
  setia: boolean;
}

/**
 * Badge kebiasaan pembeli — dipakai di Master Pelanggan & halaman Order,
 * supaya packer tahu mana order berpotensi gagal dan mana yang layak disegerakan.
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
  const any = flags.baru || flags.riskKirim || flags.riskPra || flags.setia;
  if (!any) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 align-middle">
      {flags.baru && <Badge tone="info">Pelanggan baru</Badge>}
      {flags.riskKirim && (
        <Badge tone="danger" icon="warning">
          {flags.riskKirimCod ? "Sering batal COD stlh kirim" : "Sering batal stlh kirim"}
          {batalKirim ? ` (${batalKirim})` : ""}
        </Badge>
      )}
      {flags.riskPra && (
        <Badge tone="warning">Sering batal sblm kirim{batalPra ? ` (${batalPra})` : ""}</Badge>
      )}
      {flags.setia && (
        <Badge tone="success" icon="trending">
          Pelanggan setia · segerakan
        </Badge>
      )}
    </span>
  );
}
