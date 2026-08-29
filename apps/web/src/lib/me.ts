import { create } from "zustand";
import { api } from "./api";

export interface MeAccess {
  kind: "owner" | "staff";
  name: string | null;
  email: string | null;
  ownerName: string | null;
  permissions: string[];
  isOwner: boolean;
}

interface AccessState {
  access: MeAccess | null;
  loaded: boolean;
  load: (force?: boolean) => Promise<void>;
  can: (perm: string) => boolean;
  reset: () => void;
}

/**
 * Siapa yang sedang masuk, dan boleh membuka apa.
 *
 * Terpisah dari useAccount (yang memuat /account/me) karena keduanya menjawab
 * pertanyaan berbeda: /account/me adalah profil TENANT -- dan token karyawan
 * memakai tenant pemiliknya, jadi ia akan menjawab "kamu adalah pemilik toko"
 * untuk seorang karyawan gudang. Yang dibutuhkan menu adalah pertanyaan yang
 * lain: akun ini boleh membuka bagian mana.
 *
 * Selagi belum termuat, can() mengembalikan true. Menu yang berkedip hilang
 * lalu muncul lagi lebih mengganggu daripada satu menu yang sesaat terlihat
 * padahal tidak boleh dibuka -- dan servernya tetap menolak, jadi tidak ada
 * yang bocor karenanya.
 */
export const useMeAccess = create<AccessState>((set, get) => ({
  access: null,
  loaded: false,
  async load(force) {
    if (get().loaded && !force) return;
    try {
      const access = await api.get<MeAccess>("/me");
      set({ access, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  can(perm) {
    const a = get().access;
    if (!a) return true;
    if (a.isOwner) return true;
    return a.permissions.includes(perm);
  },
  reset() {
    set({ access: null, loaded: false });
  },
}));
