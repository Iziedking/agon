import { ImageResponse } from "next/og";
import { formatUsdc6, loadWin, placeVerb } from "./winData";

/// Personalized win card. The /share/<source>/<id>/<op> link in the X post
/// unfurls with THIS image: the event, the prize won, and the winner's agent
/// pfp, brand-styled. nodejs runtime so we can pre-fetch the avatar to a data
/// URL (satori never has to fetch a remote image mid-render, which would risk
/// failing the whole card).

// nodejs (we use Buffer for the avatar) + always render on-demand so the card
// is never statically pre-generated with placeholder params (which left the
// unfurl with no image).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "I won on ArcRun";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CANVAS = "#F4F1ED";
const INK = "#1A1612";
const INK_2 = "#4A453E";
const INK_3 = "#847C70";
const ACCENT = "#FF3D8A";
const HAIRLINE = "rgba(26,22,18,0.12)";

/// satori (the card renderer) decodes PNG and JPEG ONLY. A WEBP or AVIF avatar
/// throws DURING the PNG stream, after the route's try/catch has returned, so it
/// 500s the whole card with no fallback. Discord serves WEBP avatars by default
/// and unavatar.io can too, which is exactly the win-card 500 in the field. So
/// trust the bytes, not the content-type header: sniff the magic number and only
/// pass real PNG/JPEG through. Anything else returns null and the card draws the
/// operator's initial instead.
function decodableMime(buf: Buffer): "image/png" | "image/jpeg" | null {
  if (buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  return null; // WEBP (RIFF), AVIF, GIF, SVG, etc: not safe for the renderer
}

async function avatarDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    let buf: Buffer;
    if (url.startsWith("data:image/")) {
      // Our stored Telegram pfp. Decode it so we can sniff the real format
      // instead of trusting the declared mime (which may lie).
      const comma = url.indexOf(",");
      if (comma < 0 || !/;base64/i.test(url.slice(0, comma))) return null;
      buf = Buffer.from(url.slice(comma + 1), "base64");
    } else {
      // Bounded so a slow avatar host never stalls the card past the crawler's
      // patience; we fall back to the placeholder marker instead.
      const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(2500) });
      if (!r.ok) return null;
      buf = Buffer.from(await r.arrayBuffer());
    }
    // A very large pfp can choke the renderer; fall back to the placeholder.
    if (buf.byteLength === 0 || buf.byteLength > 600_000) return null;
    const mime = decodableMime(buf);
    if (!mime) return null;
    return `data:${mime};base64,${buf.toString("base64")}`;
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
  // satori only ships a Latin font. Any glyph outside it (an emoji in an X
  // display name, a CJK character) makes next/og try to fetch a "dynamic
  // font" at render time, and that fetch failing throws DURING streaming,
  // after our try/catch has already returned, so the whole card 500s with
  // no fallback. Strip the handle to printable ASCII so the card always
  // renders. Fall back to the short address if nothing survives.
  const whoRaw = win.handle ?? win.short;
  const who =
    whoRaw
      // The masked wallet uses a real ellipsis (…); render it as ASCII dots so
      // a handle-less winner's address ("0xA045…03c5") doesn't itself trip the
      // dynamic-font fetch.
      .replace(/…/g, "...")
      .replace(/[^\x20-\x7E]/g, "")
      .trim() || win.short.replace(/…/g, "...");
  // The avatar placeholder shows the operator's initial (a Latin letter) so
  // we never render the ■ glyph, which is NOT in satori's font and was the
  // exact cause of the dynamic-font 500.
  const initial = (who.replace(/^@/, "")[0] ?? "A").toUpperCase();

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
                {initial}
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
