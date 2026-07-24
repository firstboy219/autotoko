import { useRef, useState } from "react";
import { api } from "../lib/api";

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Uploads an image to our own server (POST /uploads → { url }) and reports the
 * stored URL path via onChange. Shows a thumbnail once set. Replaces the old
 * paste-a-URL inputs for payout proof screenshots.
 */
export function FileUpload({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (url: string) => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = EXT[file.type];
    if (!ext) {
      setErr("Hanya JPG, PNG, atau WebP.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(new Error("Gagal membaca file"));
        r.readAsDataURL(file);
      });
      const { url } = await api.post<{ url: string }>("/uploads", { base64, ext });
      onChange(url);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  }

  return (
    <div className="text-[11px] font-semibold text-slate-600">
      {label}
      <div className="mt-0.5 flex items-center gap-2">
        {value ? (
          <>
            <a href={value} target="_blank" rel="noreferrer">
              <img src={value} alt="bukti" className="w-12 h-12 rounded-md object-cover border border-slate-200" />
            </a>
            <button type="button" onClick={() => ref.current?.click()} disabled={busy}
              className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 font-medium">
              {busy ? "…" : "Ganti"}
            </button>
            <button type="button" onClick={() => onChange("")}
              className="text-xs text-red-500 hover:underline">Hapus</button>
          </>
        ) : (
          <button type="button" onClick={() => ref.current?.click()} disabled={busy}
            className="text-xs px-3 py-1.5 rounded-md border border-dashed border-slate-300 hover:bg-slate-50 font-medium text-slate-500">
            {busy ? "Mengunggah…" : "📎 Pilih gambar"}
          </button>
        )}
        <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" onChange={onPick} className="hidden" />
      </div>
      {err && <div className="text-red-500 text-[11px] mt-0.5 font-normal">{err}</div>}
    </div>
  );
}
