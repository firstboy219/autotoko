/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  safelist: [
    // TH/TD build their alignment class from a prop (text-${align}).
    "text-left",
    "text-right",
    "text-center",
  ],
  theme: {
    extend: {
      colors: {
        // CSS-variable driven so branding (colour) can be changed live from
        // the Admin CMS. Channels are "R G B" so Tailwind opacity works.
        brand: {
          DEFAULT: "rgb(var(--c-brand) / <alpha-value>)",
          dark: "rgb(var(--c-brand-dark) / <alpha-value>)",
          light: "rgb(var(--c-brand-light) / <alpha-value>)",
          ink: "rgb(var(--c-brand-ink) / <alpha-value>)",
        },
        navy: "rgb(var(--c-navy) / <alpha-value>)",
        onbrand: "rgb(var(--c-onbrand) / <alpha-value>)",
        canvas: "rgb(var(--c-canvas) / <alpha-value>)",
        line: "rgb(var(--c-line) / <alpha-value>)",
        ink: {
          DEFAULT: "rgb(var(--c-ink) / <alpha-value>)",
          2: "rgb(var(--c-ink-2) / <alpha-value>)",
          3: "rgb(var(--c-ink-3) / <alpha-value>)",
        },
        // MeetNippon's status palette. Each tone is a soft tint for the
        // background plus a darkened variant for text — the solid colours
        // (e.g. green #3fa34d) only reach ~3:1 on their own tint, which is
        // too low for 12px badge text.
        mn: {
          teal: { DEFAULT: "#0e6e55", dark: "#0a5443", tint: "#e4f2ed" },
          amber: { DEFAULT: "#f2a93b", tint: "#fcf1dd", ink: "#8a5a10" },
          coral: { DEFAULT: "#e4572e", tint: "#fdeae3", ink: "#b3401f" },
          green: { DEFAULT: "#3fa34d", tint: "#e7f5e9", ink: "#2f7d3a" },
          red: { DEFAULT: "#d64550", tint: "#fbe7e8", ink: "#a8323c" },
          stone: "#f0eeea",
        },
        teal: { DEFAULT: "#00D4AA", light: "#E6FBF7" },
        shopee: "#EE4D2D",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        display: ["Space Grotesk", "Inter", "system-ui", "sans-serif"],
      },
      borderRadius: {
        // Overridden rather than added: every component already uses
        // rounded-lg, so bumping the key lifts the whole app to MeetNippon's
        // softer corner in one place.
        lg: "12px",
        xl: "16px",
      },
      boxShadow: {
        e1: "0 1px 2px 0 rgba(32,36,43,.06), 0 1px 3px 1px rgba(32,36,43,.05)",
        e2: "0 2px 6px 0 rgba(32,36,43,.10), 0 8px 24px 2px rgba(32,36,43,.08)",
      },
    },
  },
  plugins: [],
};
