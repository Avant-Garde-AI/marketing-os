import type { Config } from "tailwindcss";

/**
 * Avant-Garde Tailwind Configuration
 * ===================================
 * Quiet luxury meets editorial precision
 * Dark navy, warm gold, cream paper, serif typefaces, no rounded corners
 */

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      // ─── Brand Colors ──────────────────────────────────────────────
      colors: {
        brand: {
          navy: "#1B263B",
          gold: "#C4A47C",
          cream: "#FAFAF9",
          white: "#FFFFFF",
        },
        // Semantic tokens (maps to CSS vars in globals.css)
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },

      // ─── Border Radius (NO rounded corners) ─────────────────────────
      borderRadius: {
        none: "0px",
        sm: "0px",
        md: "0px",
        lg: "0px",
        xl: "0px",
        "2xl": "0px",
        "3xl": "0px",
        full: "9999px", // pill — for avatars/icons only
      },

      // ─── Typography ─────────────────────────────────────────────────
      fontFamily: {
        display: ['"Playfair Display"', "Georgia", '"Times New Roman"', "serif"],
        body: ["Lora", "Georgia", '"Times New Roman"', "serif"],
        script: ['"Pinyon Script"', "cursive"],
        sans: ["Lora", "Georgia", "serif"], // override default sans → Lora
        serif: ['"Playfair Display"', "Georgia", "serif"],
        mono: ["ui-monospace", '"Cascadia Code"', '"Source Code Pro"', "monospace"],
      },

      // ─── Letter Spacing ─────────────────────────────────────────────
      letterSpacing: {
        tightest: "-0.05em",
        tighter: "-0.025em",
        tight: "-0.015em",
        normal: "0em",
        wide: "0.025em",
        wider: "0.05em",
        widest: "0.1em",
        label: "0.2em", // eyebrow labels — brand standard
      },

      // ─── Keyframes & Animations ─────────────────────────────────────
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(40px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" },
        },
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        "reveal-info": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.95)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.6s ease-out",
        "slide-up": "slide-up 0.6s ease-out",
        float: "float 3s ease-in-out infinite",
        marquee: "marquee 60s linear infinite",
        "reveal-info": "reveal-info 0.5s ease-out",
        "scale-in": "scale-in 0.3s ease-out",
      },

      // ─── Box Shadow ─────────────────────────────────────────────────
      boxShadow: {
        card: "0 4px 20px -4px rgba(0, 0, 0, 0.05)",
        "card-lg": "0 20px 40px -8px rgba(0, 0, 0, 0.12)",
        dark: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
      },

      // ─── Max Width ──────────────────────────────────────────────────
      maxWidth: {
        "screen-xl": "1280px",
      },

      // ─── Backdrop ───────────────────────────────────────────────────
      backdropBlur: {
        sm: "4px",
      },
    },
  },
  plugins: [],
};

export default config;
