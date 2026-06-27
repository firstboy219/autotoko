import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { Login } from "./pages/Login";
import { Settings } from "./pages/Settings";
import { Pricing } from "./pages/Pricing";
import { AiAutopilot } from "./pages/AiAutopilot";
import { Branding } from "./pages/Branding";

function Protected({ children }: { children: React.ReactNode }) {
  const authed = useAuth((s) => s.authenticated);
  return authed ? <>{children}</> : <Navigate to="/login" replace />;
}

export function App() {
  return (
    <BrowserRouter basename="/admin">
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/settings" element={<Protected><Settings /></Protected>} />
        <Route path="/pricing" element={<Protected><Pricing /></Protected>} />
        <Route path="/ai" element={<Protected><AiAutopilot /></Protected>} />
        <Route path="/branding" element={<Protected><Branding /></Protected>} />
        <Route path="*" element={<Navigate to="/settings" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
