import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useBranding } from "../lib/branding";
import { Button, Field, InlineAlert, Input, Skeleton } from "../components/ui";

const MIN = 8;

export function ResetPassword() {
  const navigate = useNavigate();
  const brand = useBranding((s) => s.branding);
  const brandName = brand?.name ?? "AutoToko";
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const [checking, setChecking] = useState(true);
  const [invalidReason, setInvalidReason] = useState<string | null>(null);
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Validate before rendering the form, so an expired link says so up front
  // instead of after the user has typed a new password twice.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setInvalidReason("Tautan tidak lengkap.");
        setChecking(false);
        return;
      }
      try {
        const r = await api.get<{ valid: boolean; reason?: string }>(
          `/auth/password/reset/check?token=${encodeURIComponent(token)}`,
        );
        if (cancelled) return;
        if (!r.valid) setInvalidReason(r.reason ?? "Tautan tidak valid.");
      } catch (e) {
        if (!cancelled) setInvalidReason((e as Error).message);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const tooShort = next.length > 0 && next.length < MIN;
  const mismatch = confirm.length > 0 && confirm !== next;
  const valid = next.length >= MIN && confirm === next;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post("/auth/password/reset", { token, newPassword: next });
      setDone(true);
      setTimeout(() => navigate("/login"), 2500);
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

          {checking ? (
            <>
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-full mt-3" />
              <Skeleton className="h-9 w-full mt-5" />
            </>
          ) : done ? (
            <>
              <h1 className="font-display text-xl font-semibold text-ink mb-1">Password diperbarui</h1>
              <p className="text-sm text-ink-2 mb-4">
                Silakan masuk dengan password barumu. Mengalihkan ke halaman masuk…
              </p>
              <Link to="/login">
                <Button variant="filled" className="w-full">
                  Masuk Sekarang
                </Button>
              </Link>
            </>
          ) : invalidReason ? (
            <>
              <h1 className="font-display text-xl font-semibold text-ink mb-1">Tautan tidak berlaku</h1>
              <div className="my-4">
                <InlineAlert tone="warning">{invalidReason}</InlineAlert>
              </div>
              <p className="text-sm text-ink-2 mb-4">
                Tautan reset berlaku 60 menit dan hanya bisa dipakai sekali. Minta yang baru untuk
                melanjutkan.
              </p>
              <Link to="/lupa-password">
                <Button variant="filled" className="w-full">
                  Minta Tautan Baru
                </Button>
              </Link>
            </>
          ) : (
            <>
              <h1 className="font-display text-xl font-semibold text-ink mb-1">Atur Password Baru</h1>
              <p className="text-sm text-ink-2 mb-5">Minimal {MIN} karakter.</p>

              <form onSubmit={submit}>
                <Field
                  label="Password Baru"
                  error={tooShort ? `Minimal ${MIN} karakter.` : null}
                  className="mb-3"
                >
                  <div className="relative">
                    <Input
                      type={show ? "text" : "password"}
                      value={next}
                      onChange={(e) => setNext(e.target.value)}
                      autoComplete="new-password"
                      invalid={tooShort}
                      autoFocus
                      className="pr-16"
                    />
                    <button
                      type="button"
                      onClick={() => setShow((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-ink-2 hover:text-ink"
                    >
                      {show ? "Sembunyi" : "Lihat"}
                    </button>
                  </div>
                </Field>

                <Field
                  label="Ulangi Password Baru"
                  error={mismatch ? "Password tidak sama." : null}
                  className="mb-4"
                >
                  <Input
                    type={show ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="new-password"
                    invalid={mismatch}
                  />
                </Field>

                {err && (
                  <div className="mb-3">
                    <InlineAlert tone="danger">{err}</InlineAlert>
                  </div>
                )}

                <Button variant="filled" loading={busy} disabled={!valid} className="w-full">
                  Simpan Password Baru
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
