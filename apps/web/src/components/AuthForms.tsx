import { useEffect, useRef, useState } from "react";
import { waLogin, emailLogin } from "../lib/auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_COOLDOWN_SEC = 30;

function Spinner({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function fmtCountdown(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** WhatsApp receive-only OTP login/signup. Shared by Login & Signup pages. */
export function WaLogin({ onDone, ctaLabel = "Masuk via WhatsApp" }: { onDone: (token: string) => void; ctaLabel?: string }) {
  const [session, setSession] = useState<{ waLink: string; code: string; token: string } | null>(null);
  const [status, setStatus] = useState<"idle" | "waiting" | "expired" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [remainingSec, setRemainingSec] = useState(0);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  async function start() {
    setError(null);
    setStarting(true);
    try {
      const s = await waLogin.start();
      setSession({ waLink: s.waLink, code: s.code, token: s.callbackToken });
      setStatus("waiting");
      setRemainingSec(s.expiresInSec);
      window.open(s.waLink, "_blank");
      const deadline = Date.now() + s.expiresInSec * 1000;
      timer.current = setInterval(async () => {
        const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
        setRemainingSec(left);
        if (left <= 0) {
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
          /* keep polling */
        }
      }, 3000);
    } catch (e) {
      setStatus("error");
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  async function copyCode() {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op, code is already visible */
    }
  }

  if (status === "idle") {
    return (
      <div>
        <p className="text-[13px] text-slate-500 mb-4 leading-relaxed">
          Tanpa password. Kami buka WhatsApp dengan kode unik — cukup <b>kirim pesannya</b>, halaman ini otomatis lanjut.
        </p>
        <button
          onClick={start}
          disabled={starting}
          className="w-full py-2.5 rounded-lg bg-[#25D366] hover:brightness-95 active:brightness-90 text-white text-sm font-semibold shadow-sm shadow-emerald-900/10 transition disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {starting ? <Spinner /> : <span className="text-base">💬</span>}
          {starting ? "Menyiapkan…" : ctaLabel}
        </button>
      </div>
    );
  }

  return (
    <div>
      {session && (
        <div className="mb-3 rounded-lg bg-slate-50 border border-slate-200 p-3.5 text-center">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1.5">Kode verifikasi</div>
          <div className="flex items-center justify-center gap-2">
            <div className="font-mono font-bold text-lg text-brand tracking-wider">{session.code}</div>
            <button
              type="button"
              onClick={copyCode}
              title="Salin kode"
              className="text-[10px] px-1.5 py-1 rounded border border-slate-200 text-slate-400 hover:text-brand hover:border-brand transition"
            >
              {copied ? "✓" : "⧉"}
            </button>
          </div>
        </div>
      )}
      {status === "waiting" && (
        <div className="text-center mb-3">
          <p className="text-[13px] text-slate-500">Menunggu pesan WhatsApp Anda…</p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Jangan tutup halaman ini · kedaluwarsa dalam <span className="font-mono font-semibold text-slate-500">{fmtCountdown(remainingSec)}</span>
          </p>
          <div className="mt-2 h-1 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand transition-all duration-1000 ease-linear"
              style={{ width: `${Math.max(0, Math.min(100, (remainingSec / 300) * 100))}%` }}
            />
          </div>
        </div>
      )}
      {status === "expired" && <p className="text-xs text-amber-600 mb-3 text-center">⏱ Kode kedaluwarsa. Coba lagi ya.</p>}
      {error && <div className="text-red-500 text-xs mb-3 text-center">{error}</div>}
      {session && status === "waiting" && (
        <a href={session.waLink} target="_blank" rel="noreferrer" className="block text-center w-full py-2 mb-2 rounded-lg bg-[#25D366] hover:brightness-95 text-white text-sm font-semibold transition">
          Buka WhatsApp lagi
        </a>
      )}
      <button onClick={start} disabled={starting} className="w-full py-2 rounded-lg border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition disabled:opacity-60 flex items-center justify-center gap-2">
        {starting && <Spinner className="w-3.5 h-3.5" />}
        Mulai ulang
      </button>
    </div>
  );
}

/** Email OTP login/signup. `verifyLabel` lets the Signup page say "Daftar". */
export function EmailLogin({ onDone, verifyLabel = "Masuk" }: { onDone: (token: string, email: string) => void; verifyLabel?: string }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (cooldownTimer.current) clearInterval(cooldownTimer.current); }, []);
  useEffect(() => {
    if (step === "code") setTimeout(() => codeRef.current?.focus(), 50);
  }, [step]);

  const emailValid = EMAIL_RE.test(email.trim());
  const showEmailError = emailTouched && email.length > 0 && !emailValid;

  function startCooldown() {
    setResendCooldown(RESEND_COOLDOWN_SEC);
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    cooldownTimer.current = setInterval(() => {
      setResendCooldown((s) => {
        if (s <= 1) {
          if (cooldownTimer.current) clearInterval(cooldownTimer.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  async function sendOtp() {
    setEmailTouched(true);
    if (!emailValid) return;
    setLoading(true); setError(null);
    try {
      await emailLogin.start(email.trim());
      setStep("code");
      startCooldown();
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  async function verify(codeOverride?: string) {
    const useCode = (codeOverride ?? code).trim();
    if (useCode.length !== 6 || loading) return;
    setLoading(true); setError(null);
    try {
      const { accessToken } = await emailLogin.verify(email.trim(), useCode);
      onDone(accessToken, email.trim());
    } catch (e) {
      setError((e as Error).message);
      setCode("");
    } finally { setLoading(false); }
  }

  function onCodeChange(v: string) {
    const digits = v.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    // Interactive touch: submit automatically once all 6 digits are in,
    // no need to press the button.
    if (digits.length === 6) void verify(digits);
  }

  function changeEmail() {
    setStep("email");
    setCode("");
    setError(null);
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void (step === "email" ? sendOtp() : verify()); }}>
      <label className="block text-xs font-semibold text-slate-500 mb-1">Email</label>
      <input
        type="email"
        required
        disabled={step === "code"}
        className={`w-full px-3 py-2.5 rounded-lg border text-sm transition focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-slate-50 disabled:text-slate-500 ${
          showEmailError ? "border-red-300 focus:border-red-400" : "border-slate-200 focus:border-brand"
        }`}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onBlur={() => setEmailTouched(true)}
        placeholder="kamu@email.com"
        autoFocus
      />
      {showEmailError ? (
        <p className="text-[11px] text-red-500 mt-1 mb-2">Format email belum valid.</p>
      ) : (
        <div className="mb-3" />
      )}

      {step === "code" && (
        <>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-semibold text-slate-500">Kode OTP (6 digit)</label>
            <button type="button" onClick={changeEmail} className="text-[11px] text-brand hover:underline font-medium">
              Ganti email
            </button>
          </div>
          <input
            ref={codeRef}
            inputMode="numeric"
            maxLength={6}
            required
            disabled={loading}
            className="w-full mb-1 px-3 py-2.5 rounded-lg border border-slate-200 text-sm tracking-[0.6em] text-center font-mono font-semibold focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand disabled:bg-slate-50"
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            placeholder="000000"
          />
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] text-slate-400">Dikirim ke {email}. Berlaku 5 menit.</p>
            <button
              type="button"
              onClick={() => void sendOtp()}
              disabled={resendCooldown > 0 || loading}
              className="text-[11px] text-brand font-medium hover:underline disabled:text-slate-400 disabled:no-underline disabled:cursor-default"
            >
              {resendCooldown > 0 ? `Kirim ulang (${resendCooldown}s)` : "Kirim ulang"}
            </button>
          </div>
        </>
      )}
      {error && <div className="text-red-500 text-xs mb-3 flex items-center gap-1"><span>⚠</span>{error}</div>}
      <button
        disabled={loading || (step === "email" && email.length > 0 && !emailValid)}
        className="w-full py-2.5 rounded-lg bg-brand hover:bg-brand-dark active:brightness-95 text-white text-sm font-semibold transition disabled:opacity-60 flex items-center justify-center gap-2"
      >
        {loading && <Spinner />}
        {loading ? "Memproses…" : step === "email" ? "Kirim Kode OTP" : verifyLabel}
      </button>
    </form>
  );
}
