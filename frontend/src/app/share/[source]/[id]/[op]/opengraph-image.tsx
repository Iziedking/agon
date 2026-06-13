import { ImageResponse } from "next/og";
import { formatUsdc6, loadWin, placeVerb } from "./winData";

/// Personalized win card. The /share/<source>/<id>/<op> link in the X post
/// unfurls with THIS image: the event, the prize won, and the winner's agent
/// pfp, brand-styled. nodejs runtime so we can pre-fetch the avatar to a data
/// URL (satori never has to fetch a remote image mid-render, which would risk
/// failing the whole card).

export const alt = "I won on ArcRun";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CANVAS = "#F4F1ED";
const INK = "#1A1612";
const INK_2 = "#4A453E";
const INK_3 = "#847C70";
const ACCENT = "#FF3D8A";
const HAIRLINE = "rgba(26,22,18,0.12)";

async function avatarDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    // Bounded so a slow avatar host never stalls the card past the crawler's
    // patience; we fall back to the placeholder marker instead.
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(2500) });
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") ?? "image/png";
    if (!ct.startsWith("image/")) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    // A very large pfp can choke the image renderer; fall back to the
    // placeholder marker rather than risk failing the whole card.
    if (buf.byteLength > 600_000) return null;
    return `data:${ct};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export default async function ShareImage({
  params,
}: {
  params: Promise<{ source: string; id: string; op: string }>;
}) {
  try {
  const { source, id, op } = await params;
  const win = await loadWin(source, id, op);
  const avatar = await avatarDataUrl(win.avatarUrl);

  const label = win.kindLabel.toUpperCase();
  const verb = placeVerb(win.rank).toUpperCase();
  const amount = formatUsdc6(win.amount6);
  const who = win.handle ?? win.short;

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
        {/* Eyebrow. */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 18, height: 18, background: ACCENT }} />
          <div style={{ fontSize: 26, letterSpacing: 5, color: INK, fontWeight: 700 }}>
            {label} #{win.id} · SETTLED ONCHAIN
          </div>
        </div>

        {/* Body: result + amount on the left, agent pfp on the right. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 760 }}>
            <div style={{ fontSize: 84, lineHeight: 0.98, color: INK, fontWeight: 800, letterSpacing: -2 }}>
              {verb}
            </div>
            {amount ? (
              <div style={{ fontSize: 132, lineHeight: 1, color: ACCENT, fontWeight: 800, letterSpacing: -3 }}>
                {amount}
              </div>
            ) : (
              <div style={{ fontSize: 60, lineHeight: 1.05, color: INK_2, fontWeight: 700, marginTop: 8 }}>
                ArcRun {win.kindLabel} #{win.id}
              </div>
            )}
            <div style={{ marginTop: 22, fontSize: 30, color: INK_2 }}>where AI agents compete onchain on Arc</div>
          </div>

          {/* Agent pfp: the resolved avatar, or a pink placeholder marker. */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatar}
                alt=""
                width={240}
                height={240}
                style={{ width: 240, height: 240, borderRadius: 240, objectFit: "cover", border: `4px solid ${INK}` }}
              />
            ) : (
              <div
                style={{
                  width: 240,
                  height: 240,
                  borderRadius: 240,
                  background: ACCENT,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#1A0E14",
                  fontSize: 110,
                  fontWeight: 800,
                }}
              >
                ■
              </div>
            )}
            <div style={{ fontSize: 28, color: INK, fontWeight: 700, maxWidth: 280, textAlign: "center" }}>{who}</div>
          </div>
        </div>

        {/* Footer. */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ width: "100%", height: 1, background: HAIRLINE, marginBottom: 26 }} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ width: 22, height: 22, background: ACCENT }} />
              <div style={{ fontSize: 42, color: INK, fontWeight: 800, letterSpacing: 1 }}>ARCRUN</div>
            </div>
            <div style={{ fontSize: 30, color: INK_3, fontWeight: 700, letterSpacing: 2 }}>arcrun.xyz</div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
  } catch {
    // Never 500: any failure (slow backend, bad data, oversized avatar) falls
    // back to a clean branded card so the unfurl, preview, and download work.
    return fallbackCard();
  }
}

/// Minimal branded card with no network dependency, used when the rich win
/// card can't be built.
function fallbackCard() {
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
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 18, height: 18, background: ACCENT }} />
          <div style={{ fontSize: 26, letterSpacing: 5, color: INK, fontWeight: 700 }}>AGENT ARENA ON ARC</div>
        </div>
        <div style={{ fontSize: 104, lineHeight: 0.98, color: INK, fontWeight: 800, letterSpacing: -3 }}>
          I WON ON ARCRUN
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 22, height: 22, background: ACCENT }} />
            <div style={{ fontSize: 42, color: INK, fontWeight: 800, letterSpacing: 1 }}>ARCRUN</div>
          </div>
          <div style={{ fontSize: 30, color: INK_3, fontWeight: 700, letterSpacing: 2 }}>arcrun.xyz</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
