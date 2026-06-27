/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // CSS-variable driven (see index.css) so branding can be themed live.
        brand: {
          DEFAULT: "rgb(var(--c-brand) / <alpha-value>)",
          dark: "rgb(var(--c-brand-dark) / <alpha-value>)",
          light: "rgb(var(--c-brand-light) / <alpha-value>)",
        },
        navy: "rgb(var(--c-navy) / <alpha-value>)",
        onbrand: "rgb(var(--c-onbrand) / <alpha-value>)",
        teal: { DEFAULT: "#00D4AA", light: "#E6FBF7" },
      },
      fontFamily: {
        sans: ["Plus Jakarta Sans", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
