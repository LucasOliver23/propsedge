import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0a0b",
        surface: "#131315",
        elevated: "#1c1c1f",
        line: "#28282c",
        green: { DEFAULT: "#22c55e" },
        red: { DEFAULT: "#ef4444" },
        // Verde vibrante no estilo PropsBR (cor de marca/destaque, no lugar do azul "sky").
        brand: {
          100: "#d2ffe3",
          200: "#9bffc5",
          300: "#5dfa9e",
          400: "#22e072",
          500: "#14b858",
          600: "#0d9447",
        },
      },
      fontFamily: { sans: ["var(--font-inter)", "system-ui", "sans-serif"] },
      keyframes: {
        flash: { "0%": { backgroundColor: "rgba(34,197,94,.25)" }, "100%": { backgroundColor: "transparent" } },
      },
      animation: { flash: "flash 1.2s ease-out" },
    },
  },
  plugins: [],
} satisfies Config;
