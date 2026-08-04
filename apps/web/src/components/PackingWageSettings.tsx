import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Settings {
  feePerResi: number;
}

/**
 * What the packer is paid per parcel handed to the courier.
 *
 * Kept separate from the HPP packing cost on purpose. That one is set per
 * product, covers box, tape, bubble wrap AND labour, and exists to price the
 * product. This one is only the labour — the amount that actually leaves your
 * hand per parcel. Paying out the HPP figure would overpay by the cost of the
 * materials, and there is no single HPP number to fold this into anyway, since
 * it varies product by product.
 */
export function PackingWageSettings() {
  const [fee, setFee] = useState("");
  const [saved, setSaved] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Settings>("/resi/packing-settings")
      .then((s) => {
        setSaved(s.feePerResi);
        setFee(s.feePerResi ? String(s.feePerResi) : "");
      })
      .catch(() => {});
  }, []);

  const value = Number(fee.replace(/[^\d.]/g, ""));
  const valid = fee.trim() !== "" && Number.isFinite(value) && value >= 0;
  const dirty = valid && value !== saved;

  async function save() {
    if (!valid) return;
    setBusy(true);
    setErr(null);
    setOk(false);
    try {
      const r = await api.patch<Settings>("/resi/packing-settings", { feePerResi: value });
      setSaved(r.feePerResi);
      setOk(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="text-sm font-semibold text-slate-700 mb-1">Upah Packing per Resi</div>
      <p className="text-xs text-slate-500 mb-3">
        Dibayarkan ke petugas yang mengemas dan menyerahkan paket ke kurir. Dipakai di menu
        Produksi &amp; Packing untuk menghitung upah harian.
      </p>

      <label className="block text-xs text-slate-500 mb-1">Rupiah per resi</label>
      <div className="flex gap-2">
        <input
          className="flex-1 px-3 py-2 rounded-md border border-slate-200 text-sm"
          inputMode="numeric"
          placeholder="contoh: 2000"
          value={fee}
          onChange={(e) => {
            setFee(e.target.value);
            setOk(false);
          }}
        />
        <button
          onClick={save}
          disabled={busy || !dirty}
          className="px-3 rounded-md bg-brand hover:bg-brand-dark text-white text-xs font-semibold disabled:opacity-40"
        >
          {busy ? "…" : "Simpan"}
        </button>
      </div>

      {ok && <div className="text-green-600 text-xs mt-2">✓ Tersimpan</div>}
      {err && <div className="text-red-500 text-xs mt-2">{err}</div>}

      <div className="text-[11px] text-slate-500 mt-3 leading-relaxed border-t border-slate-100 pt-2">
        Berbeda dengan &quot;biaya packing per resi&quot; di halaman HPP: angka di sana diatur
        per produk dan mencakup bahan (kardus, lakban, bubble wrap) <em>dan</em> tenaga, karena
        dipakai untuk menentukan harga jual. Yang di atas ini khusus upah orangnya.
      </div>
    </div>
  );
}
