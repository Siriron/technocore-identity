/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#FAF9F6",
        parchment: "#F1EEE7",
        panel: "#FFFFFF",
        ink: "#1C1E21",
        stone: "#6B6459",
        "stone-light": "#A39C8F",
        "stone-faint": "#C9C2B4",
        hairline: "#E8E4DB",
        "hairline-strong": "#D8D2C4",
        seal: {
          DEFAULT: "#B8433A",
          dark: "#8F332C",
          light: "#FBEEEC",
        },
        verified: {
          DEFAULT: "#2D5F4F",
          dark: "#234B3E",
          light: "#E9F1EC",
          muted: "#A8BDB2",
        },
        amber: {
          DEFAULT: "#9C6B1F",
          light: "#FBF3E4",
        },
      },
      fontFamily: {
        serif: [
          "Georgia",
          "'Source Serif 4'",
          "'Times New Roman'",
          "serif",
        ],
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "'Segoe UI'",
          "Inter",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "'SF Mono'",
          "'Menlo'",
          "monospace",
        ],
      },
      boxShadow: {
        soft: "0 1px 2px rgba(28, 30, 33, 0.04), 0 4px 12px rgba(28, 30, 33, 0.04)",
        lifted: "0 2px 6px rgba(28, 30, 33, 0.06), 0 8px 24px rgba(28, 30, 33, 0.06)",
      },
      borderRadius: {
        card: "18px",
        control: "14px",
      },
      transitionTimingFunction: {
        fluid: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      keyframes: {
        "seal-stamp": {
          "0%": { transform: "scale(0.85)", opacity: "0" },
          "60%": { transform: "scale(1.04)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        "fade-up": {
          "0%": { transform: "translateY(6px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        "seal-stamp": "seal-stamp 0.4s cubic-bezier(0.22, 1, 0.36, 1)",
        "fade-up": "fade-up 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
        "fade-in": "fade-in 0.25s ease-out",
      },
    },
  },
  plugins: [],
};
