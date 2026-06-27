import { Link } from "react-router-dom";

const FEATURES = [
  { icon: "🤖", title: "AI Autopilot", desc: "Auto-approve order, auto-balas chat pembeli & affiliator, balas review — semua dijalankan AI." },
  { icon: "🛒", title: "Multi-Marketplace", desc: "Hubungkan TikTok Shop & Shopee. Order & produk tersinkron otomatis di satu dashboard." },
  { icon: "🧪", title: "BOM & Auto-Restock", desc: "Stok bahan baku berkurang otomatis tiap order, alert restock saat menipis." },
  { icon: "📈", title: "Laporan Otomatis", desc: "Rekap harian, mingguan, bulanan dikirim ke email. Skor kesehatan katalog tiap minggu." },
  { icon: "🤝", title: "Affiliate Management", desc: "Cari, undang, dan negosiasi komisi dengan kreator — dibantu AI." },
  { icon: "💳", title: "Wallet & Billing", desc: "Top-up saldo via Midtrans, fee per-transaksi transparan." },
];

export function Landing() {
  return (
    <div className="min-h-screen bg-white font-sans text-slate-800">
      <header className="flex items-center justify-between px-6 py-4 max-w-5xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-brand text-white font-extrabold flex items-center justify-center">A</div>
          <span className="font-extrabold text-lg">AutoToko</span>
        </div>
        <Link to="/login" className="px-4 py-2 rounded-md bg-brand hover:bg-brand-dark text-white text-sm font-semibold">Masuk</Link>
      </header>

      <section className="max-w-3xl mx-auto text-center px-6 pt-12 pb-16">
        <div className="inline-block text-[11px] font-semibold text-brand bg-brand/10 rounded-full px-3 py-1 mb-4">Autopilot Seller untuk TikTok Shop & Shopee</div>
        <h1 className="text-4xl md:text-5xl font-extrabold leading-tight">Jualan online <span className="text-brand">otomatis</span>, kamu tinggal pantau.</h1>
        <p className="text-slate-500 mt-4 text-lg">AutoToko menjalankan operasional toko-mu dengan AI: approve order, balas chat & review, kelola stok, affiliate, dan laporan — full-auto, bisa dipantau kapan saja.</p>
        <div className="flex gap-3 justify-center mt-7">
          <Link to="/login" className="px-6 py-3 rounded-lg bg-brand hover:bg-brand-dark text-white font-semibold">Mulai Gratis</Link>
          <a href="#fitur" className="px-6 py-3 rounded-lg border border-slate-200 hover:bg-slate-50 font-semibold">Lihat Fitur</a>
        </div>
        <p className="text-[12px] text-slate-400 mt-3">Tanpa password — login pakai WhatsApp atau email. Akun baru otomatis dibuat saat login pertama.</p>
      </section>

      <section id="fitur" className="bg-[#F0F4F8] py-16">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-2xl font-bold text-center mb-10">Semua yang toko-mu butuhkan</h2>
          <div className="grid md:grid-cols-3 gap-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="text-2xl mb-2">{f.icon}</div>
                <div className="font-bold text-slate-800">{f.title}</div>
                <div className="text-[13px] text-slate-500 mt-1">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-3xl mx-auto text-center px-6 py-16">
        <h2 className="text-2xl font-bold">Siap autopilot-kan toko-mu?</h2>
        <Link to="/login" className="inline-block mt-5 px-6 py-3 rounded-lg bg-brand hover:bg-brand-dark text-white font-semibold">Masuk / Daftar</Link>
      </section>

      <footer className="border-t border-slate-100 py-6 text-center text-[12px] text-slate-400">© {new Date().getFullYear()} AutoToko · Autopilot Seller</footer>
    </div>
  );
}
