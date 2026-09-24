import { Component, lazy, Suspense, useEffect, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./lib/auth";

/*
 * Route-level code splitting: tiap halaman dimuat saat dibuka (React.lazy),
 * bukan sekaligus di bundle awal. Bundle pertama jadi jauh lebih kecil → UI
 * ringan & cepat tampil. Halaman named-export dibungkus ke { default }.
 */
const Login = lazy(() => import("./pages/Login").then((m) => ({ default: m.Login })));
const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const Toko = lazy(() => import("./pages/Toko").then((m) => ({ default: m.Toko })));
const Produk = lazy(() => import("./pages/Produk").then((m) => ({ default: m.Produk })));
const MasterPostingan = lazy(() => import("./pages/MasterPostingan").then((m) => ({ default: m.MasterPostingan })));
const Wallet = lazy(() => import("./pages/Wallet").then((m) => ({ default: m.Wallet })));
const Orders = lazy(() => import("./pages/Orders").then((m) => ({ default: m.Orders })));
const ProduksiPacking = lazy(() => import("./pages/ProduksiPacking").then((m) => ({ default: m.ProduksiPacking })));
const Bom = lazy(() => import("./pages/Bom").then((m) => ({ default: m.Bom })));
const AplikasiVersi = lazy(() => import("./pages/AplikasiVersi").then((m) => ({ default: m.AplikasiVersi })));
const PendingPage = lazy(() => import("./pages/PendingPage").then((m) => ({ default: m.PendingPage })));
const Pembelian = lazy(() => import("./pages/Pembelian").then((m) => ({ default: m.Pembelian })));
const Hpp = lazy(() => import("./pages/Hpp").then((m) => ({ default: m.Hpp })));
const HppDetail = lazy(() => import("./pages/HppDetail").then((m) => ({ default: m.HppDetail })));
const Autopilot = lazy(() => import("./pages/Autopilot").then((m) => ({ default: m.Autopilot })));
const Laporan = lazy(() => import("./pages/Laporan").then((m) => ({ default: m.Laporan })));
const Katalog = lazy(() => import("./pages/Katalog").then((m) => ({ default: m.Katalog })));
const Affiliate = lazy(() => import("./pages/Affiliate").then((m) => ({ default: m.Affiliate })));
const Onboarding = lazy(() => import("./pages/Onboarding").then((m) => ({ default: m.Onboarding })));
const Akun = lazy(() => import("./pages/Akun").then((m) => ({ default: m.Akun })));
const Karyawan = lazy(() => import("./pages/Karyawan"));
const Rekonsiliasi = lazy(() => import("./pages/Rekonsiliasi"));
const AuditPesanan = lazy(() => import("./pages/AuditPesanan"));
const DashboardV2 = lazy(() => import("./pages/DashboardV2"));
const Paket = lazy(() => import("./pages/Paket").then((m) => ({ default: m.Paket })));
const Notifikasi = lazy(() => import("./pages/Notifikasi").then((m) => ({ default: m.Notifikasi })));
const Landing = lazy(() => import("./pages/Landing").then((m) => ({ default: m.Landing })));
const Signup = lazy(() => import("./pages/Signup").then((m) => ({ default: m.Signup })));
const LupaPassword = lazy(() => import("./pages/LupaPassword").then((m) => ({ default: m.LupaPassword })));
const ResetPassword = lazy(() => import("./pages/ResetPassword").then((m) => ({ default: m.ResetPassword })));
const Terms = lazy(() => import("./pages/Terms").then((m) => ({ default: m.Terms })));
const Privacy = lazy(() => import("./pages/Privacy").then((m) => ({ default: m.Privacy })));
const NotFound = lazy(() => import("./pages/NotFound").then((m) => ({ default: m.NotFound })));
const PortalLogin = lazy(() => import("./pages/PortalLogin").then((m) => ({ default: m.PortalLogin })));
const PortalDashboard = lazy(() => import("./pages/PortalDashboard").then((m) => ({ default: m.PortalDashboard })));
const Pencairan = lazy(() => import("./pages/Pencairan").then((m) => ({ default: m.Pencairan })));
const PencairanBatch = lazy(() => import("./pages/PencairanBatch").then((m) => ({ default: m.PencairanBatch })));
const PencairanSubSeller = lazy(() => import("./pages/PencairanSubSeller").then((m) => ({ default: m.PencairanSubSeller })));
const PencairanSettings = lazy(() => import("./pages/PencairanSettings").then((m) => ({ default: m.PencairanSettings })));
const PencairanMutasi = lazy(() => import("./pages/PencairanMutasi").then((m) => ({ default: m.PencairanMutasi })));
const PencairanMapping = lazy(() => import("./pages/PencairanMapping").then((m) => ({ default: m.PencairanMapping })));
const PencairanProfit = lazy(() => import("./pages/PencairanProfit").then((m) => ({ default: m.PencairanProfit })));
const RequestStok = lazy(() => import("./pages/RequestStok").then((m) => ({ default: m.RequestStok })));
const KesehatanPesanan = lazy(() => import("./pages/KesehatanPesanan").then((m) => ({ default: m.KesehatanPesanan })));
const Chat = lazy(() => import("./pages/Chat").then((m) => ({ default: m.Chat })));
const Kb = lazy(() => import("./pages/Kb").then((m) => ({ default: m.Kb })));
const Promotion = lazy(() => import("./pages/Promotion").then((m) => ({ default: m.Promotion })));
const Retur = lazy(() => import("./pages/Retur").then((m) => ({ default: m.Retur })));
const StokOmnichannel = lazy(() => import("./pages/StokOmnichannel").then((m) => ({ default: m.StokOmnichannel })));

function Protected({ children }: { children: ReactNode }) {
  const authed = useAuth((s) => s.authenticated);
  return authed ? <>{children}</> : <Navigate to="/login" replace />;
}

function PageLoader() {
  return (
    <div className="h-screen flex items-center justify-center bg-canvas">
      <div className="h-6 w-6 rounded-full border-2 border-line border-t-brand animate-spin" aria-label="Memuat" />
    </div>
  );
}

/**
 * Chunk lazy bisa 404 bila tab lama masih terbuka saat deploy baru (nama file
 * ber-hash berubah). Tangkap, lalu reload sekali otomatis — sesudahnya
 * index.html baru menunjuk chunk yang benar.
 */
class ChunkBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(err: unknown) {
    const msg = String((err as Error)?.message || err);
    if (/dynamically imported module|Loading chunk|Failed to fetch|module script failed/i.test(msg)) {
      if (!sessionStorage.getItem("chunk_reloaded")) {
        sessionStorage.setItem("chunk_reloaded", "1");
        window.location.reload();
      }
    }
  }
  override render() {
    if (this.state.failed) {
      return (
        <div className="h-screen flex flex-col items-center justify-center gap-3 bg-canvas text-ink-2 text-sm">
          <div>Gagal memuat halaman.</div>
          <button
            className="px-4 py-2 rounded-lg bg-brand text-onbrand font-medium"
            onClick={() => { sessionStorage.removeItem("chunk_reloaded"); window.location.reload(); }}
          >
            Muat ulang
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  // Setelah halaman berhasil dimuat, izinkan reload-otomatis lagi untuk deploy berikutnya.
  useEffect(() => {
    sessionStorage.removeItem("chunk_reloaded");
  }, []);
  return (
    <BrowserRouter>
      <ChunkBoundary>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/welcome" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/lupa-password" element={<LupaPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/onboarding" element={<Protected><Onboarding /></Protected>} />
          <Route path="/akun" element={<Protected><Akun /></Protected>} />
          <Route path="/karyawan" element={<Protected><Karyawan /></Protected>} />
          <Route path="/rekonsiliasi" element={<Protected><Rekonsiliasi /></Protected>} />
          <Route path="/audit-pesanan" element={<Protected><AuditPesanan /></Protected>} />
          <Route path="/dashboard-v2" element={<Protected><DashboardV2 /></Protected>} />
          <Route path="/dashboard-ringkas" element={<Protected><Dashboard /></Protected>} />
          <Route path="/paket" element={<Protected><Paket /></Protected>} />
          <Route path="/notifikasi" element={<Protected><Notifikasi /></Protected>} />
          <Route path="/" element={<Protected><DashboardV2 /></Protected>} />
          <Route path="/toko" element={<Protected><Toko /></Protected>} />
          <Route path="/produk" element={<Protected><Produk /></Protected>} />
          <Route path="/master-postingan" element={<Protected><MasterPostingan /></Protected>} />
          <Route path="/stok-omnichannel" element={<Protected><StokOmnichannel /></Protected>} />
          <Route path="/orders" element={<Protected><Orders /></Protected>} />
          <Route path="/kesehatan-pesanan" element={<Protected><KesehatanPesanan /></Protected>} />
          <Route path="/chat" element={<Protected><Chat /></Protected>} />
          <Route path="/kb" element={<Protected><Kb /></Protected>} />
          <Route path="/retur" element={<Protected><Retur /></Protected>} />
          <Route path="/produksi-packing" element={<Protected><ProduksiPacking /></Protected>} />
          <Route path="/bom" element={<Protected><Bom /></Protected>} />
          <Route path="/aplikasi" element={<Protected><AplikasiVersi /></Protected>} />
          <Route path="/pending" element={<Protected><PendingPage /></Protected>} />
          <Route path="/pembelian" element={<Protected><Pembelian /></Protected>} />
          <Route path="/request-stok" element={<Protected><RequestStok /></Protected>} />
          <Route path="/hpp" element={<Protected><Hpp /></Protected>} />
          <Route path="/hpp/:id" element={<Protected><HppDetail /></Protected>} />
          <Route path="/autopilot" element={<Protected><Autopilot /></Protected>} />
          <Route path="/laporan" element={<Protected><Laporan /></Protected>} />
          <Route path="/katalog" element={<Protected><Katalog /></Protected>} />
          <Route path="/affiliate" element={<Protected><Affiliate /></Protected>} />
          <Route path="/promo" element={<Protected><Promotion /></Protected>} />
          <Route path="/wallet" element={<Protected><Wallet /></Protected>} />
          <Route path="/pencairan" element={<Protected><Pencairan /></Protected>} />
          <Route path="/pencairan/batch/:id" element={<Protected><PencairanBatch /></Protected>} />
          <Route path="/pencairan/sub-seller" element={<Protected><PencairanSubSeller /></Protected>} />
          <Route path="/pencairan/pengaturan" element={<Protected><PencairanSettings /></Protected>} />
          <Route path="/pencairan/mutasi" element={<Protected><PencairanMutasi /></Protected>} />
          <Route path="/pencairan/mapping" element={<Protected><PencairanMapping /></Protected>} />
          <Route path="/laporan-bagian" element={<Protected><PencairanProfit /></Protected>} />
          <Route path="/portal/login" element={<PortalLogin />} />
          <Route path="/portal" element={<PortalDashboard />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      </ChunkBoundary>
    </BrowserRouter>
  );
}
