import { create } from "zustand";
import { api, setToken, clearToken, getToken } from "./api";

interface AuthState {
  authenticated: boolean;
  loading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<boolean>;
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
  logout() {
    clearToken();
    set({ authenticated: false });
  },
}));
