import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, waLogin, emailLogin } from "../lib/auth";

type Tab = "wa" | "email";

export function Login() {
  const navigate = useNavigate();
  const applyToken = useAuth((s) => s.applyToken);
  const [tab, setTab] = useState<Tab>("wa");

  return (
    <div className="min-h-screen flex items-center justify-center font-sans bg-[#F0F4F8]">
      <div className="bg-white rounded-xl border border-slate-200 p-8 w-[380px] shadow-sm">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-9 h-9 rounded-lg bg-brand text-white font-extrabold flex items-center justify-center">
            A
          </div>
          <div>
            <div className="font-extrabold text-lg leading-none">AutoToko</div>
            <div className="text-[10px] uppercase tracking-wide text-slate-400">
              Autopilot Seller
            </div>
          </div>
        </div>

        <div className="flex mb-5 rounded-lg bg-slate-100 p-1 text-sm font-semibold">
          <button
            onClick={() => setTab("wa")}
            className={`flex-1 py-1.5 rounded-md ${tab === "wa" ? "bg-white shadow-sm text-brand" : "text-slate-500"}`}
          >
            WhatsApp
          </button>
          <button
            onClick={() => setTab("email")}
            className={`flex-1 py-1.5 rounded-md ${tab === "email" ? "bg-white shadow-sm text-brand" : "text-slate-500"}`}
          >
            Email
          </button>
        </div>

        {tab === "wa" ? (
          <WaLogin onDone={(t) => { applyToken(t); navigate("/"); }} />
        ) : (
          <EmailLogin onDone={(t) => { applyToken(t); navigate("/"); }} />
        )}

        <DevLogin />
      </div>
    </div>
  );
}

function WaLogin({ onDone }: { onDone: (token: string) => void }) {
  const [session, setSession] = useState<{ waLink: string; code: string; token: string } | null>(null);
  const [status, setStatus] = useState<"idle" | "waiting" | "expired" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  async function start() {
    setError(null);
    setStatus("waiting");
    try {
      const s = await waLogin.start();
      setSession({ waLink: s.waLink, code: s.code, token: s.callbackToken });
      window.open(s.waLink, "_blank");
      const deadline = Date.now() + s.expiresInSec * 1000;
      timer.current = setInterval(async () => {
        if (Date.now() > deadline) {
          if (timer.current) clearInterval(timer.current);
          setStatus("expired");
          return;
        }
        try {
          const r = await waLogin.status(s.callbackToken);
          if (r.status === "verified" && r.accessToken) {
            if (timer.current) clearInterval(timer.current);
            onDone(r.accessToken);
          }
        } catch {
          /* token not yet known / transient — keep polling */
        }
      }, 3000);
    } catch (e) {
      setStatus("error");
      setError((e as Error).message);
    }
  }

  if (status === "idle") {
    return (
      <div>
        <p className="text-xs text-slate-500 mb-4 leading-relaxed">
          Login tanpa password. Kami akan membuka WhatsApp dengan kode unik —
          cukup <b>kirim pesannya</b>, lalu halaman ini otomatis masuk.
        </p>
        <button
          onClick={start}
          className="w-full py-2 rounded-md bg-brand hover:bg-brand-dark text-white text-sm font-semibold"
        >
          Masuk via WhatsApp
        </button>
      </div>
    );
  }

  return (
    <div>
      {session && (
        <div className="mb-3 rounded-md bg-slate-50 border border-slate-200 p-3 text-center">
          <div className="text-[11px] text-slate-400 uppercase tracking-wide mb-1">Kode login</div>
          <div className="font-mono font-bold text-brand">{session.code}</div>
        </div>
      )}
      {status === "waiting" && (
        <p className="text-xs text-slate-500 mb-3 text-center">
          Menunggu pesan WhatsApp Anda… jangan tutup halaman ini.
        </p>
      )}
      {status === "expired" && (
        <p className="text-xs text-amber-600 mb-3 text-center">Kode kedaluwarsa. Coba lagi.</p>
      )}
      {error && <div className="text-red-500 text-xs mb-3 text-center">{error}</div>}
      {session && status === "waiting" && (
        <a
          href={session.waLink}
          target="_blank"
          rel="noreferrer"
          className="block text-center w-full py-2 mb-2 rounded-md bg-[#25D366] hover:opacity-90 text-white text-sm font-semibold"
        >
          Buka WhatsApp lagi
        </a>
      )}
      <button
        onClick={start}
        className="w-full py-2 rounded-md border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50"
      >
        Mulai ulang
      </button>
    </div>
  );
}

function EmailLogin({ onDone }: { onDone: (token: string) => void }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      await emailLogin.start(email.trim());
      setStep("code");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const { accessToken } = await emailLogin.verify(email.trim(), code.trim());
      onDone(accessToken);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={step === "email" ? sendOtp : verify}>
      <label className="block text-xs font-semibold text-slate-500 mb-1">Email</label>
      <input
        type="email"
        required
        disabled={step === "code"}
        className="w-full mb-3 px-3 py-2 rounded-md border border-slate-200 text-sm focus:outline-none focus:border-brand disabled:bg-slate-50"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="kamu@email.com"
      />
      {step === "code" && (
        <>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Kode OTP (6 digit)</label>
          <input
            inputMode="numeric"
            maxLength={6}
            required
            className="w-full mb-3 px-3 py-2 rounded-md border border-slate-200 text-sm tracking-[0.5em] text-center font-mono focus:outline-none focus:border-brand"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="000000"
          />
          <p className="text-[11px] text-slate-400 mb-2">Kode dikirim ke {email}. Berlaku 5 menit.</p>
        </>
      )}
      {error && <div className="text-red-500 text-xs mb-3">{error}</div>}
      <button
        disabled={loading}
        className="w-full py-2 rounded-md bg-brand hover:bg-brand-dark text-white text-sm font-semibold disabled:opacity-60"
      >
        {loading ? "Memproses…" : step === "email" ? "Kirim OTP" : "Masuk"}
      </button>
    </form>
  );
}

/** Username/password login — only works in non-production (backend rejects in prod). */
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
    <div className="mt-5 pt-4 border-t border-slate-100">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-[11px] text-slate-400 hover:text-slate-600"
      >
        {open ? "▾" : "▸"} Login developer
      </button>
      {open && (
        <form onSubmit={submit} className="mt-2">
          <input
            className="w-full mb-2 px-3 py-1.5 rounded-md border border-slate-200 text-sm"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="username"
          />
          <input
            type="password"
            className="w-full mb-2 px-3 py-1.5 rounded-md border border-slate-200 text-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="password"
          />
          {error && <div className="text-red-500 text-xs mb-2">{error}</div>}
          <button
            disabled={loading}
            className="w-full py-1.5 rounded-md bg-slate-700 hover:bg-slate-800 text-white text-xs font-semibold disabled:opacity-60"
          >
            {loading ? "Masuk…" : "Masuk (dev)"}
          </button>
        </form>
      )}
    </div>
  );
}
