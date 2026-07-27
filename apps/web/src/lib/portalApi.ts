import type { ApiResponse } from "@autotoko/shared";

// Deliberately a SEPARATE storage key from the main app's "autotoko_token" —
// the portal is a different principal (sub-seller/sub-sub-seller), not the
// tenant user, and someone could plausibly have both open at once.
const TOKEN_KEY = "autotoko_portal_token";

export function getPortalToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setPortalToken(t: string): void {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearPortalToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class PortalApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getPortalToken();
  const hasBody = body !== undefined;
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: hasBody ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    clearPortalToken();
    if (!location.pathname.startsWith("/portal/login")) location.href = "/portal/login";
    throw new PortalApiError("Sesi berakhir, silakan masuk lagi.", 401);
  }

  const json = (await res.json().catch(() => null)) as
    | (ApiResponse<T> & { message?: string | string[] })
    | null;
  if (!res.ok || !json?.success) {
    const nest = json?.message;
    const msg =
      json?.error?.message ??
      (Array.isArray(nest) ? nest.join(", ") : nest) ??
      `HTTP ${res.status}`;
    throw new PortalApiError(msg, res.status);
  }
  return json.data as T;
}

export const portalApi = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
};
