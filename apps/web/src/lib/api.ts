import type { ApiResponse } from "@autotoko/shared";

const TOKEN_KEY = "autotoko_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string): void {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = getToken();
  const hasBody = body !== undefined;
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      // Only declare a JSON content-type when we actually send a body — Fastify
      // rejects an empty body when content-type is application/json (e.g. the
      // bodyless POSTs: demo-login, wa-login/start).
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: hasBody ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    clearToken();
    if (!location.pathname.startsWith("/login")) location.href = "/login";
    throw new ApiError("Unauthorized", 401);
  }

  const json = (await res.json().catch(() => null)) as
    | (ApiResponse<T> & { message?: string | string[] })
    | null;
  if (!res.ok || !json?.success) {
    // Our ApiResponse uses error.message; NestJS HttpException uses a top-level
    // `message` (string or string[]). Surface whichever is present so the user
    // sees the real reason instead of a bare "HTTP 502".
    const nest = json?.message;
    const msg =
      json?.error?.message ??
      (Array.isArray(nest) ? nest.join(", ") : nest) ??
      `HTTP ${res.status}`;
    throw new ApiError(msg, res.status);
  }
  return json.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};
