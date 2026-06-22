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
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 || res.status === 403) {
    if (res.status === 401) clearToken();
    if (!location.pathname.startsWith("/admin/login")) location.href = "/admin/login";
    throw new ApiError("Unauthorized", res.status);
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
