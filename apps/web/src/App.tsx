import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Toko } from "./pages/Toko";
import { Produk } from "./pages/Produk";
import { Wallet } from "./pages/Wallet";
import { Orders } from "./pages/Orders";
import { ProduksiPacking } from "./pages/ProduksiPacking";
import { Bom } from "./pages/Bom";
import { AplikasiVersi } from "./pages/AplikasiVersi";
import { PendingPage } from "./pages/PendingPage";
import { Pembelian } from "./pages/Pembelian";
import { Hpp } from "./pages/Hpp";
import { HppDetail } from "./pages/HppDetail";
import { Autopilot } from "./pages/Autopilot";
import { Laporan } from "./pages/Laporan";
import { Katalog } from "./pages/Katalog";
import { Affiliate } from "./pages/Affiliate";
import { Onboarding } from "./pages/Onboarding";
import { Akun } from "./pages/Akun";
import Karyawan from "./pages/Karyawan";
import Rekonsiliasi from "./pages/Rekonsiliasi";
import { Paket } from "./pages/Paket";
import { Notifikasi } from "./pages/Notifikasi";
import { Landing } from "./pages/Landing";
import { Signup } from "./pages/Signup";
import { LupaPassword } from "./pages/LupaPassword";
import { ResetPassword } from "./pages/ResetPassword";
import { Terms } from "./pages/Terms";
import { Privacy } from "./pages/Privacy";
import { NotFound } from "./pages/NotFound";
import { PortalLogin } from "./pages/PortalLogin";
import { PortalDashboard } from "./pages/PortalDashboard";
import { Pencairan } from "./pages/Pencairan";
import { PencairanBatch } from "./pages/PencairanBatch";
import { PencairanSubSeller } from "./pages/PencairanSubSeller";
import { PencairanSettings } from "./pages/PencairanSettings";
import { PencairanMutasi } from "./pages/PencairanMutasi";
import { PencairanMapping } from "./pages/PencairanMapping";
import { PencairanProfit } from "./pages/PencairanProfit";

function Protected({ children }: { children: React.ReactNode }) {
  const authed = useAuth((s) => s.authenticated);
  return authed ? <>{children}</> : <Navigate to="/login" replace />;
}

export function App() {
  return (
    <BrowserRouter>
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
        <Route path="/paket" element={<Protected><Paket /></Protected>} />
        <Route path="/notifikasi" element={<Protected><Notifikasi /></Protected>} />
        <Route path="/" element={<Protected><Dashboard /></Protected>} />
        <Route path="/toko" element={<Protected><Toko /></Protected>} />
        <Route path="/produk" element={<Protected><Produk /></Protected>} />
        <Route path="/orders" element={<Protected><Orders /></Protected>} />
        <Route path="/produksi-packing" element={<Protected><ProduksiPacking /></Protected>} />
        <Route path="/bom" element={<Protected><Bom /></Protected>} />
        <Route path="/aplikasi" element={<Protected><AplikasiVersi /></Protected>} />
        <Route path="/pending" element={<Protected><PendingPage /></Protected>} />
        <Route path="/pembelian" element={<Protected><Pembelian /></Protected>} />
        <Route path="/hpp" element={<Protected><Hpp /></Protected>} />
        <Route path="/hpp/:id" element={<Protected><HppDetail /></Protected>} />
        <Route path="/autopilot" element={<Protected><Autopilot /></Protected>} />
        <Route path="/laporan" element={<Protected><Laporan /></Protected>} />
        <Route path="/katalog" element={<Protected><Katalog /></Protected>} />
        <Route path="/affiliate" element={<Protected><Affiliate /></Protected>} />
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
    </BrowserRouter>
  );
}
