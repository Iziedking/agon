import { lightTheme, type Theme } from "@rainbow-me/rainbowkit";

/// RainbowKit theme tuned to the ArcRun redesign: flat ink-on-warm-canvas,
/// rose-pink accent, square corners, mono type. RainbowKit owns the modal's
/// internal layout, but every surface, border, and accent here is pulled from
/// the same tokens the rest of the app uses (src/styles/tokens.css, light
/// theme), so the wallet picker reads as part of the product rather than a
/// bolted-on third-party sheet.
///
/// Values are concrete hex (not CSS vars) because RainbowKit themes are plain
/// JS objects resolved once at mount, not at paint. We track the LIGHT brand
/// here; pink looks good on both axes so it carries the dark canvas too.
const ACCENT = "#D6336C"; // --accent
const ACCENT_INK = "#FFFFFF"; // --accent-ink
const CANVAS = "#F4F1ED"; // --canvas
const CANVAS_2 = "#EFEAE3"; // --canvas-2-ish, one notch off canvas
const INK = "#1A1612"; // --ink
const INK_2 = "rgba(26,22,18,0.62)"; // --ink-2
const HAIRLINE = "rgba(26,22,18,0.22)"; // --hairline-strong

const base = lightTheme({
  accentColor: ACCENT,
  accentColorForeground: ACCENT_INK,
  borderRadius: "none",
  fontStack: "system",
  overlayBlur: "small",
});

export const arcrunRainbowTheme: Theme = {
  ...base,
  colors: {
    ...base.colors,
    accentColor: ACCENT,
    accentColorForeground: ACCENT_INK,
    modalBackground: CANVAS,
    modalBorder: INK,
    modalText: INK,
    modalTextSecondary: INK_2,
    modalTextDim: INK_2,
    profileForeground: CANVAS,
    profileAction: CANVAS_2,
    profileActionHover: CANVAS,
    menuItemBackground: CANVAS_2,
    connectButtonBackground: CANVAS,
    connectButtonInnerBackground: CANVAS_2,
    connectButtonText: INK,
    closeButton: INK_2,
    closeButtonBackground: CANVAS_2,
    generalBorder: HAIRLINE,
    generalBorderDim: HAIRLINE,
    actionButtonBorder: HAIRLINE,
    actionButtonBorderMobile: HAIRLINE,
    actionButtonSecondaryBackground: CANVAS_2,
    selectedOptionBorder: INK,
  },
  fonts: {
    body: 'var(--font-mono), "JetBrains Mono", ui-monospace, monospace',
  },
  radii: {
    ...base.radii,
    actionButton: "0px",
    connectButton: "0px",
    menuButton: "0px",
    modal: "0px",
    modalMobile: "0px",
  },
};
