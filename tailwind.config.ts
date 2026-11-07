import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        charcoal: {
          DEFAULT: "#1c1d1f",
          surface: "#232426",
          elevated: "#2a2b2e",
          hairline: "rgba(239, 235, 227, 0.18)",
          hairlineSubtle: "rgba(239, 235, 227, 0.08)",
        },
        cream: {
          DEFAULT: "#efebe3",
          muted: "#8d8b86",
          dim: "#5c5b57",
        },
        burnt: {
          DEFAULT: "#e8741f",
          hover: "#f5832e",
          glow: "rgba(232, 116, 31, 0.25)",
        },
        sev: {
          critical: "#ef4444",
          high: "#f59e0b",
          medium: "#eab308",
          low: "#9ca3af",
          info: "#67e8f9",
        },
        night: {
          950: "#1c1d1f",
          900: "#1c1d1f",
          800: "#232426",
          700: "#2a2b2e",
          600: "rgba(239, 235, 227, 0.18)",
        },
        base: {
          DEFAULT: "#e8741f",
          glow: "#f5832e",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Oswald", "sans-serif"],
        sans: ["var(--font-sans)", "Inter", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
