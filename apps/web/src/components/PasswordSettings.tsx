import { useState } from "react";
import { api, setToken } from "../lib/api";
import { useFetch } from "../lib/useFetch";
import { Badge, Button, Card, CardHeader, Field, InlineAlert, Input, useToast } from "./ui";

const MIN = 8;

/**
 * Lets a signed-in seller set or replace their password.
 *
 * Replacing one stamps a server-side session epoch, so every other device is
 * signed out. The backend hands back a freshly signed token for THIS tab and
 * we swap it in below — otherwise the user would be kicked out of the very
 * page they just used, which reads as a bug rather than as security.
 *
 * Recovery for someone who cannot get in at all lives at /lupa-password.
 */
export function PasswordSettings() {
  const toast = useToast();
  const { data, loading, reload } = useFetch<{ hasPassword: boolean }>("/auth/password/status");
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const has = data?.hasPassword ?? false;
  const tooShort = next.length > 0 && next.length < MIN;
  const mismatch = confirm.length > 0 && confirm !== next;
  const valid = next.length >= MIN && confirm === next && (!has || current.length > 0);

  function reset() {
    setCurrent("");
    setNext("");
    setConfirm("");
    setErr(null);
    setOpen(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ ok: true; accessToken?: string }>("/auth/password/set", {
        newPassword: next,
        ...(has ? { currentPassword: current } : {}),
      });
      // Swap in the replacement token before anything else fires a request:
      // the one in localStorage was just invalidated server-side.
      if (r.accessToken) setToken(r.accessToken);
      toast(
        has ? "Password diganti — perangkat lain otomatis keluar" : "Password dibuat",
        "success",
      );
      reset();
      reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card padded={false}>
      <CardHeader
        title="Password"
        subtitle="Opsional — kamu tetap bisa masuk lewat WhatsApp atau Email OTP."
        action={
          loading ? null : has ? (
            <Badge tone="success" icon="check">
              Sudah diatur
            </Badge>
          ) : (
            <Badge tone="neutral">Belum diatur</Badge>
          )
        }
      />
      <div className="p-5">
        {!open ? (
          <Button variant="outline" icon="lock" onClick={() => setOpen(true)} disabled={loading}>
            {has ? "Ganti Password" : "Buat Password"}
          </Button>
        ) : (
          <form onSubmit={submit} className="max-w-sm space-y-3">
            {has && (
              <Field label="Password Lama" required>
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                />
              </Field>
            )}
            <Field
              label="Password Baru"
              required
              error={tooShort ? `Minimal ${MIN} karakter.` : null}
              hint={!tooShort ? `Minimal ${MIN} karakter.` : undefined}
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={next}
                invalid={tooShort}
                onChange={(e) => setNext(e.target.value)}
              />
            </Field>
            <Field
              label="Ulangi Password Baru"
              required
              error={mismatch ? "Password tidak sama." : null}
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={confirm}
                invalid={mismatch}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>

            {err && <InlineAlert tone="danger">{err}</InlineAlert>}

            <div className="flex gap-2 pt-1">
              <Button variant="filled" icon="check" loading={busy} disabled={!valid}>
                Simpan
              </Button>
              <Button type="button" variant="text" onClick={reset} disabled={busy}>
                Batal
              </Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}
