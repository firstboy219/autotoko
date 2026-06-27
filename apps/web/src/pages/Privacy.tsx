import { Link } from "react-router-dom";

export function Privacy() {
  return (
    <div className="min-h-screen bg-white font-sans text-slate-700">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <Link to="/login" className="text-brand text-sm font-semibold">← Kembali</Link>
        <h1 className="text-3xl font-extrabold text-slate-900 mt-4 mb-1">Kebijakan Privasi</h1>
        <p className="text-xs text-slate-400 mb-8">AutoToko · diperbarui 28 Juni 2026</p>

        <Section title="1. Data yang Kami Kumpulkan">
          <ul className="list-disc pl-5 space-y-1">
            <li>Identitas akun: alamat email dan/atau nomor WhatsApp (untuk login tanpa password).</li>
            <li>Nama toko/usaha yang kamu isi.</li>
            <li>Data toko & pesanan dari marketplace yang kamu hubungkan (TikTok Shop, Shopee): pesanan, produk, status, dan informasi pengiriman terkait pemrosesan order.</li>
            <li>Token akses marketplace (disimpan terenkripsi) untuk sinkronisasi atas izinmu.</li>
            <li>Data transaksi dompet/billing.</li>
          </ul>
        </Section>

        <Section title="2. Penggunaan Data">
          Data dipakai semata untuk menjalankan layanan: sinkronisasi & otomasi pesanan, laporan,
          manajemen stok/affiliate, dan penagihan. Kami tidak menjual data kamu.
        </Section>

        <Section title="3. Penyimpanan & Keamanan">
          Data disimpan di server di Indonesia. Token marketplace dienkripsi (AES-256) saat disimpan.
          Akses antar-pengguna diisolasi (multi-tenant). Koneksi memakai HTTPS.
        </Section>

        <Section title="4. Berbagi ke Pihak Ketiga">
          Kami berbagi data hanya dengan layanan yang diperlukan untuk fungsi platform: marketplace
          yang kamu hubungkan (via API resmi), payment gateway (Midtrans), dan penyedia email. Tidak
          ada penjualan data ke pihak lain.
        </Section>

        <Section title="5. Hak Kamu">
          Kamu dapat memutus koneksi toko kapan saja (menu Toko Saya), dan meminta penghapusan akun &
          data dengan menghubungi kami. Pemutusan koneksi menghapus token akses marketplace.
        </Section>

        <Section title="6. Kontak">
          Pertanyaan privasi: <b>info@autotoko.id</b>
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
