import { create } from "zustand";
import { api, setToken, clearToken, getToken } from "./api";

interface WaStart {
  code: string;
  callbackToken: string;
  waLink: string;
  expiresInSec: number;
}

interface AuthState {
  authenticated: boolean;
  loading: boolean;
  error: string | null;
  /** Dev-only username/password login (rejected by the backend in production). */
  login: (username: string, password: string) => Promise<boolean>;
  /** Apply a freshly issued access token (e.g. after WA/email OTP verify). */
  applyToken: (token: string) => void;
  logout: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  authenticated: Boolean(getToken()),
  loading: false,
  error: null,
  async login(username, password) {
    set({ loading: true, error: null });
    try {
      const { accessToken } = await api.post<{ accessToken: string }>(
        "/auth/login",
        { username, password },
      );
      setToken(accessToken);
      set({ authenticated: true, loading: false });
      return true;
    } catch (e) {
      set({ loading: false, error: (e as Error).message, authenticated: false });
      return false;
    }
  },
  applyToken(token) {
    setToken(token);
    set({ authenticated: true, error: null });
  },
  logout() {
    clearToken();
    void import("./realtime").then((m) => m.disconnectSocket());
    set({ authenticated: false });
  },
}));

// --- WhatsApp login (RECEIVE-ONLY OTP) -------------------------------------
export const waLogin = {
  start: () => api.post<WaStart>("/auth/wa-login/start"),
  /** Poll status by callback token. Returns accessToken once verified. */
  status: (token: string) =>
    api.get<{ status: string; accessToken?: string }>(
      `/auth/wa-login/status?token=${encodeURIComponent(token)}`,
    ),
};

// --- Email OTP login --------------------------------------------------------
export const emailLogin = {
  start: (email: string) => api.post<{ ok: true }>("/auth/email/start", { email }),
  verify: (email: string, code: string) =>
    api.post<{ accessToken: string }>("/auth/email/verify", { email, code }),
};
