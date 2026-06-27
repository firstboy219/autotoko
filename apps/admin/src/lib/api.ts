import type { ApiResponse } from "@autotoko/shared";

const TOKEN_KEY = "autotoko_admin_token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const hasBody = body !== undefined;
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      // Only set JSON content-type with an actual body (Fastify rejects empty
      // body + application/json, e.g. bodyless admin POST triggers).
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 || res.status === 403) {
    if (res.status === 401) clearToken();
    if (!location.pathname.startsWith("/admin/login")) location.href = "/admin/login";
    throw new ApiError("Unauthorized", res.status);
  }
  if (res.status === 429) {
    throw new ApiError("Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.", 429);
  }
  const json = (await res.json().catch(() => null)) as
    | (ApiResponse<T> & { message?: string | string[] })
    | null;
  if (!res.ok || !json?.success) {
    // Our ApiResponse uses error.message; NestJS HttpException uses a top-level
    // `message` (string or string[]). Surface whichever is present.
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
  get: <T>(p: string) => request<T>("GET", p),
  post: <T>(p: string, b?: unknown) => request<T>("POST", p, b),
  put: <T>(p: string, b?: unknown) => request<T>("PUT", p, b),
};
