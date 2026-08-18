/// Brand-styled transactional email templates. Email clients are hostile to
/// modern CSS, so these use table layout, inline styles, and web-safe font
/// stacks only (no @font-face, no flexbox/grid, no clip-path). They carry the
/// Agon look the way email allows: warm canvas, ink type, a single pink
/// accent, a mono body, and a blocky uppercase heading.
///
/// Pure functions: no config import, so callers pass any dynamic URLs.

const C = {
  canvas: "#F4F1ED",
  ink: "#1A1612",
  ink2: "#4A453E",
  ink3: "#847C70",
  accent: "#FF3D8A",
  accentInk: "#1A0E14",
  hairline: "rgba(26,22,18,0.14)",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  display: "'Arial Black', 'Helvetica Neue', Helvetica, Arial, sans-serif",
};

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

/// Shared shell: wordmark, a bordered card with a pink top accent, eyebrow,
/// blocky heading, the caller's body html, and a mono footer.
function shell(opts: { preheader: string; eyebrow: string; heading: string; bodyHtml: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<!-- Declare a light-only scheme so Gmail / Apple Mail dark mode don't invert
     the palette and hide the ink text on the canvas card. -->
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<style>:root { color-scheme: light only; } body { color-scheme: light only; }</style>
</head>
<body style="margin:0;padding:0;background:${C.canvas};color-scheme:light only;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.canvas};">${opts.preheader}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.canvas};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
  <tr><td style="padding:0 0 22px 4px;">
    <span style="display:inline-block;width:12px;height:12px;background:${C.accent};vertical-align:middle;"></span>
    <span style="font-family:${C.mono};font-size:15px;font-weight:700;letter-spacing:2px;color:${C.ink};vertical-align:middle;padding-left:9px;">AGON</span>
  </td></tr>
  <tr><td style="border:1px solid ${C.ink};background:${C.canvas};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="height:4px;background:${C.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td style="padding:28px 28px 32px;">
        <div style="font-family:${C.mono};font-size:11px;font-weight:500;letter-spacing:2px;text-transform:uppercase;color:${C.ink3};">
          <span style="color:${C.accent};">&#9632;</span> ${opts.eyebrow}
        </div>
        <div style="font-family:${C.display};font-size:25px;line-height:1.1;letter-spacing:-0.3px;text-transform:uppercase;color:${C.ink};padding-top:10px;">
          ${opts.heading}
        </div>
        ${opts.bodyHtml}
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:22px 4px 0;font-family:${C.mono};font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:${C.ink3};line-height:1.6;">
    AGON &middot; TRUSTED AGENT SERVICES ON ARC, PRICED IN USDC<br>
    <a href="https://agon.surf" style="color:${C.ink3};text-decoration:none;">agon.surf</a>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/// A pink tag-style CTA button (sharp rectangle; email can't do the notch).
function ctaButton(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:22px;"><tr>
    <td bgcolor="${C.accent}" style="background:${C.accent};">
      <a href="${href}" style="display:inline-block;padding:12px 22px;font-family:${C.mono};font-size:12px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${C.accentInk};text-decoration:none;">${label} &rarr;</a>
    </td>
  </tr></table>`;
}

/// The email-verification code. The big mono code is the hero of the message.
export function otpEmailTemplate(code: string): BuiltEmail {
  const bodyHtml = `
    <div style="font-family:${C.mono};font-size:14px;line-height:1.6;color:${C.ink2};padding-top:14px;">
      use this code to verify your email and finish signing in to Agon.
    </div>
    <div style="font-family:${C.mono};font-size:34px;font-weight:700;letter-spacing:10px;color:${C.ink};text-align:center;padding:20px 0;margin-top:18px;border:1px dashed ${C.hairline};">
      ${code}
    </div>
    <div style="font-family:${C.mono};font-size:12px;line-height:1.6;color:${C.ink3};padding-top:14px;">
      expires in 10 minutes. if you didn&rsquo;t request this, you can ignore this email.
    </div>`;
  return {
    subject: "Your Agon verification code",
    html: shell({
      preheader: `Your Agon code is ${code} (expires in 10 minutes).`,
      eyebrow: "VERIFY YOUR EMAIL",
      heading: "ENTER THE CODE",
      bodyHtml,
    }),
    text:
      `Your Agon verification code is ${code}.\n\n` +
      `It expires in 10 minutes. If you didn't request this, ignore this email.\n\n` +
      `Agon · trusted agent services on Arc, priced in USDC · agon.surf`,
  };
}

/// Optional welcome email. Not wired by default; call after a successful
/// first-time signup. Pass the app URL so the CTA points at the live site.
export function welcomeEmailTemplate(opts: { appUrl: string }): BuiltEmail {
  const bodyHtml = `
    <div style="font-family:${C.mono};font-size:14px;line-height:1.6;color:${C.ink2};padding-top:14px;">
      your wallet is your identity here. claim an agent, enter a contest or open a
      challenge, and let it compete autonomously for real USDC. every payout
      settles on Arc in under a second.
    </div>
    ${ctaButton("ENTER THE ARENA", opts.appUrl)}`;
  return {
    subject: "Welcome to Agon",
    html: shell({
      preheader: "Claim an agent and put it to work for real USDC on Arc.",
      eyebrow: "WELCOME",
      heading: "WELCOME TO THE ARENA",
      bodyHtml,
    }),
    text:
      `Welcome to Agon.\n\n` +
      `Your wallet is your identity. Claim an agent, enter a contest or open a ` +
      `challenge, and let it compete for real USDC. Payouts settle on Arc in under a second.\n\n` +
      `Enter the arena: ${opts.appUrl}\n\n` +
      `Agon · trusted agent services on Arc, priced in USDC · agon.surf`,
  };
}
