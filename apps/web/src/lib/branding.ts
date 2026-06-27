import { create } from "zustand";
import { api } from "./api";

export interface Branding {
  name: string;
  logoUrl: string | null;
  primary: string;
  primaryDark: string;
  navy: string;
}

interface BrandingState {
  branding: Branding | null;
  load: () => Promise<void>;
}

/** "#A3E00B" → "163 224 11" (R G B channels for Tailwind alpha support). */
function hexToChannels(hex: string): string | null {
  const m = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(m)) return null;
  const n = parseInt(m, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** Relative luminance (0..1) to decide dark/light text on the brand color. */
function luminance(hex: string): number {
  const ch = hexToChannels(hex);
  if (!ch) return 1;
  const [r, g, b] = ch.split(" ").map((x) => Number(x) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function applyBranding(b: Branding): void {
  const root = document.documentElement.style;
  const set = (v: string, hex: string) => {
    const ch = hexToChannels(hex);
    if (ch) root.setProperty(v, ch);
  };
  set("--c-brand", b.primary);
  set("--c-brand-dark", b.primaryDark);
  set("--c-navy", b.navy);
  // Dark text on a light brand color, white text on a dark one.
  root.setProperty("--c-onbrand", luminance(b.primary) > 0.45 ? "11 27 46" : "255 255 255");
  if (b.name) document.title = b.name;
}

export const useBranding = create<BrandingState>((set) => ({
  branding: null,
  async load() {
    try {
      const b = await api.get<Branding>("/branding");
      applyBranding(b);
      set({ branding: b });
    } catch {
      /* keep CSS defaults */
    }
  },
}));
