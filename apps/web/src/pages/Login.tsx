import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useBranding } from "../lib/branding";
import { WaLogin, EmailLogin } from "../components/AuthForms";
import { PasswordLogin } from "../components/PasswordLogin";
import { Icon, type IconName } from "../components/Icon";
import { Button } from "../components/ui";

type Tab = "wa" | "email" | "password";

const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: "wa", label: "WhatsApp", icon: "whatsapp" },
  { key: "email", label: "Email OTP", icon: "mail" },
  { key: "password", label: "Password", icon: "lock" },
];

export function Login() {
  const navigate = useNavigate();
  const applyToken = useAuth((s) => s.applyToken);
  const demoLogin = useAuth((s) => s.demoLogin);
  const demoLoading = useAuth((s) => s.loading);
  const brand = useBranding((s) => s.branding);
  const brandName = brand?.name ?? "AutoToko";
  const [tab, setTab] = useState<Tab>("wa");

  const done = (t: string) => {
    applyToken(t);
    navigate("/");
  };

  async function reviewerDemo() {
    if (await demoLogin()) navigate("/");
  }

  return (
    <div className="min-h-screen flex items-center justify-center font-sans bg-canvas p-4">
      <div className="w-full max-w-[420px]">
        <div className="bg-white rounded-xl border border-line p-7">
          <div className="flex items-center gap-2.5 mb-6">
            {brand?.logoUrl ? (
              <img
                src={brand.logoUrl}
                alt={brandName}
                className="w-10 h-10 rounded-lg object-contain"
              />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-brand text-onbrand font-display font-semibold flex items-center justify-center">
                {brandName.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <div className="font-display font-semibold text-lg leading-none text-ink">
                {brandName}
              </div>
              <div className="text-xs text-ink-3 mt-1">Autopilot Seller</div>
            </div>
          </div>

          <h1 className="font-display text-xl font-semibold text-ink mb-1">
            Selamat datang kembali
          </h1>
          <p className="text-sm text-ink-2 mb-5">Pilih cara masuk yang kamu pakai.</p>

          <div className="flex gap-1 mb-5 rounded-lg bg-canvas border border-line p-1 text-sm">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md transition ${
                  tab === t.key
                    ? "bg-white text-ink font-medium shadow-e1"
                    : "text-ink-2 hover:text-ink"
                }`}
              >
                <Icon name={t.icon} size={15} />
                <span className="truncate">{t.label}</span>
              </button>
            ))}
          </div>

          {tab === "wa" && <WaLogin onDone={done} />}
          {tab === "email" && <EmailLogin onDone={done} />}
          {tab === "password" && <PasswordLogin onDone={done} />}

          <p className="text-sm text-ink-2 text-center mt-5">
            Belum punya akun?{" "}
            <Link to="/signup" className="text-brand-ink font-medium hover:underline">
              Daftar di sini
            </Link>
          </p>

          <div className="mt-5 pt-4 border-t border-line text-center">
            <p className="text-xs text-ink-3 mb-2">Untuk TikTok App Reviewer:</p>
            <Button
              variant="outline"
              icon="search"
              loading={demoLoading}
              onClick={reviewerDemo}
              className="w-full"
            >
              Masuk sebagai Demo Reviewer
            </Button>
          </div>

          <div className="text-center mt-4 text-xs text-ink-3">
            <Link to="/terms" className="hover:underline">
              Ketentuan
            </Link>{" "}
            ·{" "}
            <Link to="/privacy" className="hover:underline">
              Privasi
            </Link>
          </div>

          <DevLogin />
        </div>
      </div>
    </div>
  );
}

/** Username/password login against ADMIN_/DEV_ env creds — distinct from the
 *  per-user password login above, which authenticates a real seller account. */
function DevLogin() {
  const { login, loading, error } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("user");
  const [password, setPassword] = useState("user");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (await login(username, password)) navigate("/");
  }

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-xs text-ink-3 hover:text-ink-2"
      >
        <Icon name={open ? "chevronDown" : "chevronRight"} size={12} /> Login developer
      </button>
      {open && (
        <form onSubmit={submit} className="mt-2 space-y-2">
          <input
            className="w-full h-9 px-3 rounded-lg border border-line text-sm"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="username"
          />
          <input
            type="password"
            className="w-full h-9 px-3 rounded-lg border border-line text-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="password"
          />
          {error && <div className="text-xs text-mn-red-ink">{error}</div>}
          <Button variant="outline" size="sm" loading={loading} className="w-full">
            Masuk (dev)
          </Button>
        </form>
      )}
    </div>
  );
}
