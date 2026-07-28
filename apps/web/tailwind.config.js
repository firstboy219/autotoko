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
        teal: { DEFAULT: "#00D4AA", light: "#E6FBF7" },
        shopee: "#EE4D2D",
      },
      fontFamily: {
        sans: ["Roboto", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      boxShadow: {
        // Google elevation ramp.
        e1: "0 1px 2px 0 rgba(60,64,67,.30), 0 1px 3px 1px rgba(60,64,67,.15)",
        e2: "0 1px 3px 0 rgba(60,64,67,.30), 0 4px 8px 3px rgba(60,64,67,.15)",
      },
    },
  },
  plugins: [],
};
