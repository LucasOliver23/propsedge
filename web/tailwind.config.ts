import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b0f17",
        surface: "#111827",
        elevated: "#1a2233",
        line: "#243044",
        green: { DEFAULT: "#22c55e" },
        red: { DEFAULT: "#ef4444" },
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
