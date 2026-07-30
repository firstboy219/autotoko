import { useState } from "react";
import { api, setToken } from "../lib/api";
import { Button, Field, InlineAlert, Input } from "./ui";

/**
 * Email + password sign-in. Sits alongside the OTP tabs rather than replacing
 * them — an account only has a password if its owner set one, and OTP remains
 * the recovery path when they forget it.
 */
export function PasswordLogin({ onDone }: { onDone: (token: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { accessToken } = await api.post<{ accessToken: string }>("/auth/password/login", {
        email: email.trim(),
        password,
      });
      setToken(accessToken);
      onDone(accessToken);
    } catch (e) {
      setError((e as Error).message);
      setPassword("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Field label="Email" className="mb-3">
        <Input
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="kamu@email.com"
        />
      </Field>

      <Field label="Password" className="mb-3">
        <div className="relative">
          <Input
            type={show ? "text" : "password"}
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
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

      {error && (
        <div className="mb-3">
          <InlineAlert tone="danger">{error}</InlineAlert>
        </div>
      )}

      <Button
        variant="filled"
        loading={loading}
        disabled={!email.trim() || !password}
        className="w-full"
      >
        Masuk
      </Button>

      <p className="text-xs text-ink-3 mt-3 text-center">
        Belum punya password? Masuk lewat WhatsApp atau Email OTP dulu, lalu atur password di
        halaman Akun.
      </p>
    </form>
  );
}
