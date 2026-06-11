import { config } from "../config/index.js";

/// Transactional email sender. One place every ArcRun email goes through, so
/// the provider wiring and the from-address formatting live in a single spot.
///
/// Provider is chosen by EMAIL_PROVIDER: `resend` posts to the Resend API;
/// anything else (default `console`) just logs, so local dev needs no SMTP.
/// Throws on a hard send failure; callers that must deliver (OTP) surface it,
/// best-effort callers (welcome, receipts) should catch.

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/// Format the from header. EMAIL_FROM may be a bare address
/// (noreply@arcrun.xyz) or already include a display name; we wrap a bare
/// address as `ArcRun <addr>` so inboxes show the brand, not just the address.
function fromHeader(from: string): string {
  return from.includes("<") ? from : `ArcRun <${from}>`;
}

export async function sendEmail(msg: EmailMessage): Promise<void> {
  if (config.auth.emailOtp.provider === "resend") {
    await sendViaResend(msg);
  } else {
    console.log(`[EMAIL · DEV] to=${msg.to} subject="${msg.subject}"`);
  }
}

async function sendViaResend(msg: EmailMessage): Promise<void> {
  const apiKey = config.auth.emailOtp.resendApiKey;
  const from = config.auth.emailOtp.from;
  if (!apiKey || !from) {
    throw new Error("RESEND_API_KEY and EMAIL_FROM are required when EMAIL_PROVIDER=resend");
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: fromHeader(from),
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`resend ${res.status}: ${body.slice(0, 200)}`);
  }
}
