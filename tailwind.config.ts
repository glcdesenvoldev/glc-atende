import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Paleta PetshopCam — azul/verde água profissional
        brand: {
          50:  "#f0fdfa",
          100: "#ccfbf1",
          200: "#99f6e4",
          300: "#5eead4",
          400: "#2dd4bf",
          500: "#14b8a6",  // teal principal
          600: "#0d9488",
          700: "#0f766e",
          800: "#115e59",
          900: "#134e4a",
        },
        sky: {
          400: "#38bdf8",
          500: "#0ea5e9",
          600: "#0284c7",
        },
        dark: {
          50:  "#e2f0f7",
          100: "#b3d4e8",
          200: "#6fa8c9",
          300: "#3b82a6",
          400: "#1e5f85",
          500: "#0f3d5c",
          600: "#0a2a42",
          700: "#071e30",
          800: "#040f1c",
          900: "#020810",
          950: "#010408",
        },
      },
    },
  },
  plugins: [],
};

export default config;
