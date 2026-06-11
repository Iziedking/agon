/// Client for the in-app feedback widget. Posts a bug report or feature idea
/// to the auth API, which relays it to the team's Telegram. Public endpoint,
/// so it works whether or not the operator is signed in.

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

/// Footer (and anywhere else) dispatches this to open the feedback widget.
export const FEEDBACK_OPEN_EVENT = "arcrun:open-feedback";

export function openFeedback(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(FEEDBACK_OPEN_EVENT));
  }
}

export async function submitFeedback(input: {
  type: "bug" | "idea";
  message: string;
  path?: string;
  address?: string;
}): Promise<boolean> {
  try {
    const res = await fetch(`${AUTH_URL}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    return res.ok;
  } catch {
    return false;
  }
}
