/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ['"Inter Variable"', "Inter", "system-ui", "sans-serif"] },
      colors: {
        ink: { 950: "#07080C", 900: "#0B0D13", 850: "#0F1119", 800: "#131622", 700: "#1B1F2E", 600: "#262B3D" },
        line: "#1C2030",
        mute: "#8B93A7",
        soft: "#C9CEDB",
        violet: { 300: "#B6A6FF", 400: "#9A84FF", 500: "#7C5CFF", 600: "#6644F5", 700: "#4F33C9" },
        amber: { 400: "#FBBF4D", 500: "#F5A524" },
        up: "#22C55E",
        down: "#F43F5E",
      },
      boxShadow: { card: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 20px 40px -24px rgba(0,0,0,0.6)" },
    },
  },
  plugins: [],
};
