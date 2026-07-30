import { useState } from "react";
import { api } from "../lib/api";
import { useFetch } from "../lib/useFetch";
import { Badge, Button, Card, CardHeader, Field, InlineAlert, Input, useToast } from "./ui";

const MIN = 8;

/**
 * Lets a signed-in seller set or replace their password. There is no
 * "forgot password" email flow by design — OTP login already proves ownership
 * of the address and is the recovery path.
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
      await api.post("/auth/password/set", {
        newPassword: next,
        ...(has ? { currentPassword: current } : {}),
      });
      toast(has ? "Password diganti" : "Password dibuat", "success");
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
