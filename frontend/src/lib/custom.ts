/// Submits a custom contest/challenge request to the auth API. The project
/// describes the metric and rules; ArcRun reviews it and follows up using the
/// contact they provide.

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

export async function submitCustomRequest(input: {
  surface: "contest" | "challenge";
  kind?: string;
  contact: string;
  spec: string;
}): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${AUTH_URL}/custom-requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: number; error?: string };
    if (!res.ok) return { ok: false, error: data.error ?? "could not submit the request." };
    return { ok: true, id: data.id ?? 0 };
  } catch {
    return { ok: false, error: "network error. try again." };
  }
}
