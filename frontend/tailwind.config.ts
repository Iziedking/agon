import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}", "../bnb-market/src/shared/**/*.{ts,tsx}"],
  // Dark mode flips by toggling `html.dark`. Tokens for the pengu palette swap
  // under that selector in tokens.css; every surface that reads pengu-* auto-flips.
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: "var(--color-bg)",
        surface: {
          DEFAULT: "var(--color-surface)",
          raised: "var(--color-surface-2)",
        },
        border: {
          DEFAULT: "var(--color-border)",
          strong: "var(--color-border-strong)",
        },
        /* Legacy accent palette (dark-theme cyan/pink) — superseded by the
           redesign `accent` block below. Renamed so the new accent wins. */
        accentLegacy: {
          pink: "var(--color-accent-pink)",
          "pink-dim": "var(--color-accent-pink-dim)",
          cyan: "var(--color-accent-cyan)",
          "cyan-dim": "var(--color-accent-cyan-dim)",
        },
        outcome: {
          win: "var(--color-win)",
          silver: "var(--color-win-2)",
          bronze: "var(--color-win-3)",
          loss: "var(--color-loss)",
        },
        rank: {
          leader: "var(--color-rank-leader)",
          "leader-bg": "var(--color-rank-leader-bg)",
          "contender-bg": "var(--color-rank-contender-bg)",
          "back-bg": "var(--color-rank-back-bg)",
        },
        text: {
          DEFAULT: "var(--color-text)",
          muted: "var(--color-text-muted)",
          dim: "var(--color-text-dim)",
          "on-accent": "var(--color-text-on-accent)",
        },
        syndicate: {
          crimson: "var(--color-syndicate-crimson)",
          cyan: "var(--color-syndicate-cyan)",
          gold: "var(--color-syndicate-gold)",
          violet: "var(--color-syndicate-violet)",
        },
        // ArcRun palette. RGB-triplet CSS vars defined in tokens.css under
        // :root (light) and html.dark (dark). The `<alpha-value>` placeholder
        // lets every Tailwind opacity modifier (bg-pengu-blue/15 etc.) keep
        // working through a variable, so the dark-mode swap is invisible to
        // any consumer of the tokens.
        pengu: {
          bg: "rgb(var(--pengu-bg) / <alpha-value>)",
          "bg-2": "rgb(var(--pengu-bg-2) / <alpha-value>)",
          card: "rgb(var(--pengu-card) / <alpha-value>)",
          card2: "rgb(var(--pengu-card-2) / <alpha-value>)",
          blue: "rgb(var(--pengu-blue) / <alpha-value>)",
          blue2: "rgb(var(--pengu-blue-2) / <alpha-value>)",
          soft: "rgb(var(--pengu-soft) / <alpha-value>)",
          text: "rgb(var(--pengu-text) / <alpha-value>)",
          dim: "rgb(var(--pengu-dim) / <alpha-value>)",
          dark: "rgb(var(--pengu-dark) / <alpha-value>)",
        },
        /* arcrun-redesign palette */
        canvas: { DEFAULT: "var(--canvas)", 2: "var(--canvas-2)", 3: "var(--canvas-3)" },
        ink: { DEFAULT: "var(--ink)", 2: "var(--ink-2)", 3: "var(--ink-3)" },
        accent: { DEFAULT: "var(--accent)", press: "var(--accent-press)", ink: "var(--accent-ink)" },
        syn: {
          violet: "var(--syn-violet)",
          pink: "var(--syn-pink)",
          gold: "var(--syn-gold)",
          mint: "var(--syn-mint)",
          crimson: "var(--syn-crimson)",
        },
      },
      fontFamily: {
        /* Stencil display. The `display` and `bubble` names are kept as
           aliases so existing call sites continue to compile while pages
           transition; new code should use `font-stencil`. */
        stencil: ["var(--font-geist-pixel-square)", "Impact", "system-ui", "sans-serif"],
        display: ["var(--font-geist-pixel-square)", "Impact", "system-ui", "sans-serif"],
        bubble: ["var(--font-geist-pixel-square)", "Impact", "system-ui", "sans-serif"],
        sans: ["var(--font-body)"],
        mono: ["var(--font-mono)"],
      },
      fontSize: {
        display: ["var(--text-display)", { lineHeight: "var(--leading-tight)", letterSpacing: "var(--tracking-display)" }],
        h1: ["var(--text-h1)", { lineHeight: "var(--leading-tight)", letterSpacing: "var(--tracking-tight)" }],
        h2: ["var(--text-h2)", { lineHeight: "var(--leading-snug)" }],
        h3: ["var(--text-h3)", { lineHeight: "var(--leading-snug)" }],
        body: ["var(--text-body)", { lineHeight: "var(--leading-body)" }],
        small: ["var(--text-small)", { lineHeight: "var(--leading-body)" }],
        label: ["var(--text-label)", { lineHeight: "var(--leading-snug)", letterSpacing: "var(--tracking-label)" }],
        "mono-xl": ["var(--text-mono-xl)", { lineHeight: "1" }],
        "mono-lg": ["var(--text-mono-lg)", { lineHeight: "1" }],
        "mono-md": ["var(--text-mono-md)", { lineHeight: "1.1" }],
        "mono-sm": ["var(--text-mono-sm)", { lineHeight: "1.2" }],
      },
      spacing: {
        section: "var(--space-32)",
        block: "var(--space-16)",
        gutter: "var(--space-6)",
      },
      borderRadius: {
        none: "0",
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        card: "24px",
        pill: "var(--radius-pill)",
      },
      maxWidth: {
        prose: "640px",
        content: "1200px",
        wide: "1440px",
      },
      transitionTimingFunction: {
        "ease-out-arc": "var(--ease-out)",
        "ease-arc": "var(--ease-in-out)",
      },
      transitionDuration: {
        fast: "120ms",
        base: "240ms",
        slow: "600ms",
        reveal: "400ms",
      },
      zIndex: {
        base: "0",
        sticky: "10",
        ribbon: "20",
        dropdown: "30",
        modal: "40",
        toast: "50",
      },
      keyframes: {
        "pulse-live": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.5", transform: "scale(0.85)" },
        },
        "score-tick": {
          "0%": { transform: "translateY(0)", opacity: "1" },
          "50%": { transform: "translateY(-2px)", opacity: "0.85" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "rank-slide": {
          "0%": { transform: "translateY(var(--rank-from, 0))" },
          "100%": { transform: "translateY(0)" },
        },
        "settle-sweep": {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
        "stagger-in": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "pulse-live": "pulse-live 1.5s var(--ease-in-out) infinite",
        "score-tick": "score-tick 800ms var(--ease-out)",
        "rank-slide": "rank-slide var(--duration-slow) var(--ease-out)",
        "settle-sweep": "settle-sweep var(--duration-reveal) var(--ease-out) forwards",
        "stagger-in": "stagger-in 240ms var(--ease-out) forwards",
      },
    },
  },
  plugins: [],
};

export default config;
