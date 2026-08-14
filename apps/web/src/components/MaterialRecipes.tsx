import { useFetch } from "../lib/useFetch";
import { Badge, InlineAlert, Modal } from "./ui";

/**
 * Which products use this material, and which of them is actually draining it.
 *
 * The catalogue's "6 produk" is not actionable on its own. A material in six
 * recipes where one product ships daily and five never ship is a completely
 * different stock problem from the same material spread evenly across six — and
 * the count cannot tell them apart. So the recipes are listed with what each
 * one took out of the warehouse over the same window the "Terpakai" column uses.
 */

interface Usage {
  products: {
    id: string;
    name: string;
    quantity: number;
    unit: string | null;
    orders: number;
    unitsShipped: number;
  }[];
  usageDays: number;
  packingLines: number;
  purchaseLines: number;
  inUse: boolean;
}

export function MaterialRecipes({
  material,
  onClose,
}: {
  material: { id: string; name: string; unit: string | null };
  onClose: () => void;
}) {
  const usage = useFetch<Usage>(`/materials/${material.id}/usage`);
  const u = usage.data;

  return (
    <Modal open onClose={onClose} title={`Dipakai untuk — ${material.name}`} width="max-w-2xl">
      {!u ? (
        <div className="py-8 text-center text-sm text-ink-3">
          {usage.error ? String(usage.error) : "Memuat…"}
        </div>
      ) : (
        <div className="space-y-3">
          {u.packingLines > 0 && (
            <InlineAlert tone="info">
              Bahan ini juga terdaftar sebagai <strong>bahan packing</strong>, jadi
              terpakai satu kali di setiap resi berapapun isinya — di luar resep di
              bawah.
            </InlineAlert>
          )}

          {u.products.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-ink-3">
              Belum ada resep produk yang memakai bahan ini.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[460px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-ink-3">
                      <th className="py-2 pr-3 font-medium">Produk</th>
                      <th className="py-2 pr-3 text-right font-medium">Per 1 pcs</th>
                      <th className="py-2 pr-3 text-right font-medium">
                        Terkirim {u.usageDays} hari
                      </th>
                      <th className="py-2 text-right font-medium">Keluar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {u.products.map((p) => (
                      <tr key={p.id} className="border-b border-line/60 last:border-0">
                        <td className="py-2 pr-3 text-ink">
                          {p.name}
                          {p.unitsShipped === 0 && (
                            <span className="ml-1.5 inline-block align-middle">
                              <Badge>belum terkirim</Badge>
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-ink-2">
                          {p.quantity} {p.unit ?? material.unit ?? ""}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-ink-2">
                          {p.unitsShipped} pcs
                          <div className="text-[10px] text-ink-3">{p.orders} order</div>
                        </td>
                        <td className="py-2 text-right tabular-nums text-ink">
                          {Math.round(p.quantity * p.unitsShipped * 100) / 100}{" "}
                          {p.unit ?? material.unit ?? ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="text-[11px] text-ink-3">
                Urut dari yang paling banyak keluar. Kolom <strong>Keluar</strong> adalah
                per-pcs dikali yang terkirim — dalam satuan resepnya, yang tidak selalu
                sama dengan satuan master
                {material.unit ? ` (${material.unit})` : ""}. Kalau satuannya berbeda dan
                tidak bisa dikonversi, angkanya tidak ikut dipotong dari stok.
              </div>
            </>
          )}

          {u.purchaseLines > 0 && (
            <div className="text-[11px] text-ink-3">
              Tercatat di {u.purchaseLines} baris pembelian stok.
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
