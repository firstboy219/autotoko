/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#FF6B35", dark: "#E55A27", light: "#FFF1EB" },
        navy: "#1A1A2E",
        teal: { DEFAULT: "#00D4AA", light: "#E6FBF7" },
      },
      fontFamily: {
        sans: ["Plus Jakarta Sans", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
