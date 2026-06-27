import { Link } from "react-router-dom";
import { useBranding } from "../lib/branding";

export function NotFound() {
  const brand = useBranding((s) => s.branding);
  const brandName = brand?.name ?? "AutoToko";
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F0F4F8] font-sans p-4">
      <div className="text-center">
        <div className="inline-flex items-center gap-2 mb-4">
          {brand?.logoUrl ? (
            <img src={brand.logoUrl} alt={brandName} className="w-9 h-9 rounded-lg object-contain" />
          ) : (
            <div className="w-9 h-9 rounded-lg bg-brand font-extrabold flex items-center justify-center">{brandName.charAt(0).toUpperCase()}</div>
          )}
          <span className="font-extrabold text-lg">{brandName}</span>
        </div>
        <div className="text-6xl font-extrabold text-slate-300">404</div>
        <p className="text-slate-500 mt-2 mb-6">Halaman tidak ditemukan.</p>
        <Link to="/" className="px-5 py-2.5 rounded-lg bg-brand hover:bg-brand-dark text-white font-semibold">
          Kembali ke Dashboard
        </Link>
      </div>
    </div>
  );
}
