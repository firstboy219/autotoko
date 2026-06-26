import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Toko } from "./pages/Toko";
import { Produk } from "./pages/Produk";
import { Wallet } from "./pages/Wallet";
import { Orders } from "./pages/Orders";
import { Bom } from "./pages/Bom";
import { Autopilot } from "./pages/Autopilot";
import { Laporan } from "./pages/Laporan";
import { Katalog } from "./pages/Katalog";

function Protected({ children }: { children: React.ReactNode }) {
  const authed = useAuth((s) => s.authenticated);
  return authed ? <>{children}</> : <Navigate to="/login" replace />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Protected><Dashboard /></Protected>} />
        <Route path="/toko" element={<Protected><Toko /></Protected>} />
        <Route path="/produk" element={<Protected><Produk /></Protected>} />
        <Route path="/orders" element={<Protected><Orders /></Protected>} />
        <Route path="/bom" element={<Protected><Bom /></Protected>} />
        <Route path="/autopilot" element={<Protected><Autopilot /></Protected>} />
        <Route path="/laporan" element={<Protected><Laporan /></Protected>} />
        <Route path="/katalog" element={<Protected><Katalog /></Protected>} />
        <Route path="/wallet" element={<Protected><Wallet /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
