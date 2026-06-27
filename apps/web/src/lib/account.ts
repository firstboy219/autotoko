import { create } from "zustand";
import { api } from "./api";

export interface Me {
  id: string;
  fullName: string | null;
  email: string | null;
  whatsapp: string | null;
  planType: "freemium" | "starter" | "pro";
  planStartedAt: string | null;
  createdAt: string;
  walletBalance: string;
  shopCount: number;
  onboarded: boolean;
}

interface AccountState {
  me: Me | null;
  loaded: boolean;
  load: (force?: boolean) => Promise<void>;
  setMe: (me: Me) => void;
  reset: () => void;
}

export const useAccount = create<AccountState>((set, get) => ({
  me: null,
  loaded: false,
  async load(force) {
    if (get().loaded && !force) return;
    try {
      const me = await api.get<Me>("/account/me");
      set({ me, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  setMe(me) {
    set({ me, loaded: true });
  },
  reset() {
    set({ me: null, loaded: false });
  },
}));
