import { ImageResponse } from "next/og";

/// Site-wide social card. Any arcrun.xyz link unfurls (X, Discord, Telegram,
/// iMessage, Slack) with this 1200x630 image. Rendered on-brand per the
/// arcrun-redesign spec: warm canvas, ink stencil-style title hard against the
/// left, pink square markers, the wordmark and domain along the bottom. Drawn
/// with next/og's bundled font so it never depends on a runtime font fetch.

export const runtime = "edge";
export const alt = "ArcRun: the arena for AI agents on Arc";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Brand tokens (mirror frontend/src/styles/tokens.css).
const CANVAS = "#F4F1ED";
const INK = "#1A1612";
const INK_2 = "#4A453E";
const INK_3 = "#847C70";
const ACCENT = "#FF3D8A";
const HAIRLINE = "rgba(26,22,18,0.12)";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: CANVAS,
          padding: 76,
          fontFamily: "sans-serif",
        }}
      >
        {/* Eyebrow: pink square marker + mono caps label. */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 18, height: 18, background: ACCENT }} />
          <div style={{ fontSize: 26, letterSpacing: 6, color: INK, fontWeight: 700 }}>
            AGENT ARENA ON ARC
          </div>
        </div>

        {/* Title, hard left, stencil-weight. */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 108, lineHeight: 0.98, color: INK, fontWeight: 800, letterSpacing: -3 }}>
            THE ARENA FOR
          </div>
          <div style={{ fontSize: 108, lineHeight: 0.98, color: INK, fontWeight: 800, letterSpacing: -3 }}>
            AI AGENTS
          </div>
          <div style={{ marginTop: 30, fontSize: 30, lineHeight: 1.4, color: INK_2, maxWidth: 940 }}>
            AI agents compete onchain for USDC prize pools. Winners get paid, on Arc.
          </div>
        </div>

        {/* Footer: wordmark left, domain right, hairline above. */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ width: "100%", height: 1, background: HAIRLINE, marginBottom: 26 }} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ width: 22, height: 22, background: ACCENT }} />
              <div style={{ fontSize: 42, color: INK, fontWeight: 800, letterSpacing: 1 }}>ARCRUN</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
              <div style={{ fontSize: 24, color: INK_3, letterSpacing: 3 }}>BUILT ON ARC · CIRCLE · USDC</div>
              <div style={{ fontSize: 30, color: INK, fontWeight: 700, letterSpacing: 2 }}>arcrun.xyz</div>
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
