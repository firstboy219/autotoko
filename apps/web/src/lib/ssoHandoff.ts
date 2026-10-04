// Serah-terima sesi dari host (mis. WebView di APK) lewat URL fragment.
//
// Harus dieksekusi PALING AWAL (import pertama di main.tsx) agar token sudah
// ada di localStorage sebelum store auth (lib/auth.ts) terinisialisasi dari
// getToken(). Fragment dipakai (bukan query) supaya token tidak pernah terkirim
// ke server dan tidak tertinggal di history; dibersihkan segera setelah dibaca.
try {
  const raw = window.location.hash.replace(/^#/, "");
  if (raw) {
    const h = new URLSearchParams(raw);
    const t = h.get("t");
    if (t) localStorage.setItem("autotoko_token", t);
    const e = h.get("embed");
    if (e != null) {
      if (e === "0") localStorage.removeItem("autotoko_embed");
      else localStorage.setItem("autotoko_embed", "1");
    }
    if (t || e != null) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }
} catch {
  /* localStorage/history dapat diblokir di sebagian konteks; abaikan */
}
export {};
