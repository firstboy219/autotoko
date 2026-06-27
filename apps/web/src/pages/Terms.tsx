import { Link } from "react-router-dom";

export function Terms() {
  return (
    <div className="min-h-screen bg-white font-sans text-slate-700">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <Link to="/login" className="text-brand text-sm font-semibold">← Kembali</Link>
        <h1 className="text-3xl font-extrabold text-slate-900 mt-4 mb-1">Ketentuan Layanan</h1>
        <p className="text-xs text-slate-400 mb-8">AutoToko · diperbarui 28 Juni 2026</p>

        <Section title="1. Layanan">
          AutoToko adalah platform otomasi penjualan untuk seller marketplace (TikTok Shop, Shopee):
          sinkronisasi pesanan, otomasi (auto-approve, chat, review), manajemen stok (BOM), affiliate,
          laporan, dan dompet.
        </Section>
        <Section title="2. Akun">
          Login tanpa password melalui email atau WhatsApp. Kamu bertanggung jawab menjaga akses ke
          email/nomor WhatsApp yang terdaftar.
        </Section>
        <Section title="3. Koneksi Marketplace">
          Kamu memberi otorisasi AutoToko mengakses data toko via API resmi marketplace untuk
          menjalankan fitur. Kamu dapat memutus koneksi kapan saja.
        </Section>
        <Section title="4. Biaya">
          Beberapa fitur dikenakan biaya (paket langganan dan/atau fee per-transaksi) yang dipotong
          dari saldo dompet. Detail biaya tampil di aplikasi sebelum dikenakan.
        </Section>
        <Section title="5. Penggunaan yang Dilarang">
          Dilarang menyalahgunakan layanan untuk aktivitas melanggar hukum atau kebijakan marketplace.
        </Section>
        <Section title="6. Batasan Tanggung Jawab">
          Layanan disediakan "sebagaimana adanya". AutoToko berupaya menjaga ketersediaan namun tidak
          menjamin bebas gangguan dari pihak ketiga (marketplace/payment).
        </Section>
        <Section title="7. Kontak">
          <b>info@autotoko.id</b>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="font-bold text-slate-800 mb-1.5">{title}</h2>
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}
