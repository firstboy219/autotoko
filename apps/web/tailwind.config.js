/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // CSS-variable driven so branding (color) can be changed live from the
        // Admin CMS. Channels are "R G B" so Tailwind opacity (bg-brand/10) works.
        brand: {
          DEFAULT: "rgb(var(--c-brand) / <alpha-value>)",
          dark: "rgb(var(--c-brand-dark) / <alpha-value>)",
          light: "rgb(var(--c-brand-light) / <alpha-value>)",
        },
        navy: "rgb(var(--c-navy) / <alpha-value>)",
        onbrand: "rgb(var(--c-onbrand) / <alpha-value>)",
        teal: { DEFAULT: "#00D4AA", light: "#E6FBF7" },
        shopee: "#EE4D2D",
      },
      fontFamily: {
        sans: ["Plus Jakarta Sans", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
