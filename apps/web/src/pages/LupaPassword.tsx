import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useBranding } from "../lib/branding";
import { Icon } from "../components/Icon";
import { Button, Field, InlineAlert, Input } from "../components/ui";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LupaPassword() {
  const brand = useBranding((s) => s.branding);
  const brandName = brand?.name ?? "AutoToko";
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid = EMAIL_RE.test(email.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post("/auth/password/forgot", { email: email.trim() });
      setSent(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center font-sans bg-canvas p-4">
      <div className="w-full max-w-[420px]">
        <div className="bg-white rounded-xl border border-line p-7">
          <div className="flex items-center gap-2.5 mb-6">
            {brand?.logoUrl ? (
              <img src={brand.logoUrl} alt={brandName} className="w-10 h-10 rounded-lg object-contain" />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-brand text-onbrand font-display font-semibold flex items-center justify-center">
                {brandName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="font-display font-semibold text-lg text-ink">{brandName}</div>
          </div>

          {sent ? (
            <>
              <h1 className="font-display text-xl font-semibold text-ink mb-1">Cek email kamu</h1>
              <p className="text-sm text-ink-2 mb-4">
                Kalau <b>{email.trim()}</b> terdaftar, kami sudah mengirim tautan untuk mengatur
                password baru. Tautannya berlaku 60 menit dan hanya bisa dipakai sekali.
              </p>
              <InlineAlert tone="info">
                Tidak menerima email? Cek folder spam, atau masuk dengan WhatsApp / Email OTP lalu
                atur password dari halaman Akun.
              </InlineAlert>
              <div className="mt-5">
                <Link to="/login">
                  <Button variant="outline" icon="arrowLeft" className="w-full">
                    Kembali ke Masuk
                  </Button>
                </Link>
              </div>
            </>
          ) : (
            <>
              <h1 className="font-display text-xl font-semibold text-ink mb-1">Lupa Password</h1>
              <p className="text-sm text-ink-2 mb-5">
                Masukkan email akunmu. Kami kirimkan tautan untuk mengatur password baru.
              </p>

              <form onSubmit={submit}>
                <Field
                  label="Email"
                  error={touched && email.length > 0 && !valid ? "Format email belum valid." : null}
                  className="mb-4"
                >
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={() => setTouched(true)}
                    placeholder="kamu@email.com"
                    autoFocus
                    invalid={touched && email.length > 0 && !valid}
                  />
                </Field>

                {err && (
                  <div className="mb-3">
                    <InlineAlert tone="danger">{err}</InlineAlert>
                  </div>
                )}

                <Button variant="filled" loading={busy} disabled={!valid} className="w-full">
                  Kirim Tautan Reset
                </Button>
              </form>

              <Link
                to="/login"
                className="flex items-center justify-center gap-1 text-sm text-ink-2 hover:text-ink mt-4"
              >
                <Icon name="arrowLeft" size={15} /> Kembali ke Masuk
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
