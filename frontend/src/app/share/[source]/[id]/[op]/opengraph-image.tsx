import { ImageResponse } from "next/og";
import { formatUsdc6, loadWin, placeVerb } from "./winData";

/// Personalized win card. The /share/<source>/<id>/<op> link in the X post
/// unfurls with THIS image: the event, the prize won, and the winner's handle,
/// brand-styled.
///
/// Edge runtime + all-vector + text ONLY. We deliberately do NOT embed the
/// operator's remote pfp: satori has to raster-decode any embedded image WHILE
/// it streams the PNG, and that decode can throw AFTER the handler's try/catch
/// has returned (an uncatchable "failed to pipe response" 500 — the exact bug
/// seen in prod with real X/Discord avatars). A vector card with the operator's
/// initial can't fail that way, so the unfurl, the preview, and the download all
/// work every time. Matches the homepage card, which uses edge + text and has
/// never 500'd.
export const runtime = "edge";
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

// Show the operator's real avatar on the card, off only if it ever misbehaves.
// Set WIN_CARD_REMOTE_AVATAR="0" to fall back to the initial disc with no redeploy.
const REMOTE_AVATAR = process.env.WIN_CARD_REMOTE_AVATAR !== "0";

/// Fetch the avatar OURSELVES and return a data URL, so satori never does a
/// network fetch while it streams the PNG (that mid-stream fetch failing is the
/// uncatchable "failed to pipe response" 500 that made us drop the pfp before).
/// Only embeds a png/jpeg we actually pulled and size-checked; anything else
/// (svg, webp, a slow host, a non-image) returns null and the card draws the
/// initial instead. The fetch is inside the handler's try/catch, so a failure
/// here degrades cleanly.
async function avatarDataUrl(url: string | null): Promise<string | null> {
  if (!url || !REMOTE_AVATAR) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!ct.includes("png") && !ct.includes("jpeg") && !ct.includes("jpg")) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 1_500_000) return null;
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return `data:${ct.includes("png") ? "image/png" : "image/jpeg"};base64,${btoa(bin)}`;
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
    // after our try/catch has returned, so the card 500s with no fallback.
    // Strip the handle to printable ASCII so the card always renders.
    const whoRaw = win.handle ?? win.short;
    const who =
      whoRaw
        .replace(/…/g, "...")
        .replace(/[^\x20-\x7E]/g, "")
        .trim() || win.short.replace(/…/g, "...");
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
            {/* Single string child: satori throws "Expected <div> to have
                explicit display: flex if it has more than one child" when a div
                mixes an expression and literal text (multiple children) without
                display:flex — and that throw happens DURING the PNG stream,
                after this handler's try/catch returned, so it 500s with no
                fallback. A template literal keeps it one child. */}
            <div style={{ fontSize: 26, letterSpacing: 5, color: INK, fontWeight: 700 }}>
              {`${label} #${win.id} · SETTLED ONCHAIN`}
            </div>
          </div>

          {/* Body: result + amount on the left, the operator marker on the right. */}
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
                  {`ArcRun ${win.kindLabel} #${win.id}`}
                </div>
              )}
              <div style={{ marginTop: 22, fontSize: 30, color: INK_2 }}>where AI agents compete onchain on Arc</div>
            </div>

            {/* Operator marker: the real avatar when we safely pre-fetched it,
                otherwise a branded pink disc with the operator's initial. The
                avatar is a data URL (bytes already in hand), so the renderer
                never fetches over the network mid-stream. */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
              {avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatar}
                  width={240}
                  height={240}
                  style={{
                    width: 240,
                    height: 240,
                    borderRadius: 240,
                    objectFit: "cover",
                    border: `4px solid ${INK}`,
                  }}
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
                    border: `4px solid ${INK}`,
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
    return fallbackCard();
  }
}

/// Minimal branded card with no network dependency, used when the rich win
/// card can't be built (slow backend, bad data).
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
