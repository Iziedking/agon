"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useAccount } from "wagmi";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import { BracketedCell, Robot } from "@/components/redesign";
import { AgentTraits } from "@/components/pengu/AgentTraits";
import { NftBadge } from "@/components/pengu/NftBadge";
import { EXPLORER } from "@/lib/arc";
import { CONTEST_TYPES, fetchAgents, tierOf, type AgentState } from "@/lib/agents";
import {
  clearAgentSkin,
  fetchOperator,
  getSetting,
  saveAgentName,
  saveAgentSkin,
  setSetting,
  short,
  type OperatorProfile,
  type SettingKey,
} from "@/lib/profiles";

/// /operators/[address] per arcrun-redesign §4.5. The profile is for who you
/// are and how things look. Stats live on /dashboard.

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

export default function OperatorPage() {
  const params = useParams();
  const address = (Array.isArray(params.address) ? params.address[0] : params.address) ?? "";
  const { address: me } = useAccount();
  const isMe = !!me && !!address && me.toLowerCase() === address.toLowerCase();

  const [profile, setProfile] = useState<OperatorProfile | null | "loading">("loading");
  const [agents, setAgents] = useState<AgentState[] | undefined>(undefined);

  useEffect(() => {
    if (!address) return;
    let live = true;
    setProfile("loading");
    setAgents(undefined);
    fetchOperator(address)
      .then((p) => { if (live) setProfile(p); })
      .catch(() => { if (live) setProfile(null); });
    fetchAgents(address as `0x${string}`)
      .then((list) => { if (live) setAgents(list); })
      .catch(() => { if (live) setAgents([]); });
    return () => { live = false; };
  }, [address]);

  async function unbindX() {
    try {
      await fetch(`${AUTH_URL}/auth/x/unbind`, { method: "POST", credentials: "include" });
      const next = await fetchOperator(address);
      setProfile(next);
    } catch {/* silent */}
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />

      <section className="mx-auto max-w-[1080px] px-6 pt-16">
        <div className="flex flex-wrap items-center gap-5">
          <span
            className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden border border-[color:var(--hairline-strong)] bg-canvas-2"
            style={{ borderRadius: "50%" }}
          >
            <Robot variant="pink" size={40} decorative />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
              <span aria-hidden className="text-accent">■</span> OPERATOR
            </div>
            <h1
              className="mt-2 break-all font-stencil uppercase text-ink"
              style={{ fontSize: "clamp(28px, 4vw, 44px)", lineHeight: 1, letterSpacing: "-0.01em" }}
            >
              {short(address)}
            </h1>
            {profile !== "loading" && profile?.xHandle ? (
              <p className="mt-2 font-mono text-[12px] uppercase tracking-[0.12em] text-ink-2">
                @{profile.xHandle}
              </p>
            ) : null}
          </div>
          <a
            href={`${EXPLORER}/address/${address}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink"
          >
            ARCSCAN ↗
          </a>
        </div>

        {profile === "loading" ? (
          <p className="mt-8 font-mono text-sm text-ink-2">reading the profile…</p>
        ) : null}
      </section>

      {/* AGENTS */}
      <section className="mx-auto max-w-[1080px] px-6 pt-12">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
            <span aria-hidden className="text-accent">■</span> AGENTS
          </span>
          {isMe ? (
            <a href="/workshop" className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink">
              MANAGE IN WORKSHOP →
            </a>
          ) : null}
        </div>

        {agents === undefined ? (
          <p className="font-mono text-sm text-ink-2">reading agents from arc…</p>
        ) : agents.length === 0 ? (
          <p className="font-mono text-sm text-ink-2">no agents claimed yet.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {agents.map((a) => (
              <AgentCustomizeCard key={a.id} agent={a} isMe={isMe} />
            ))}
          </div>
        )}
      </section>

      {/* SOCIALS */}
      <section className="mx-auto max-w-[1080px] px-6 pt-12">
        <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
          <span aria-hidden className="text-accent">■</span> SOCIALS
        </div>
        <BracketedCell pad="sm">
          <div className="flex flex-col">
            {/* X */}
            <SocialRow
              label="X"
              handle={profile !== "loading" && profile?.xHandle ? `@${profile.xHandle}` : null}
              hint="oauth2"
              isMe={isMe}
              connectHref={`${AUTH_URL}/auth/x/start`}
              onUnbind={unbindX}
            />
            {/* Telegram */}
            <TelegramRow
              isMe={isMe}
              handle={profile !== "loading" ? profile?.telegramUsername ?? null : null}
              telegramId={profile !== "loading" ? profile?.telegramId ?? null : null}
              onUnbind={async () => {
                await fetch(`${AUTH_URL}/auth/telegram/unbind`, { method: "POST", credentials: "include" });
                setProfile(await fetchOperator(address));
              }}
            />
            {/* Discord */}
            <DiscordRow
              isMe={isMe}
              handle={profile !== "loading" ? profile?.discordUsername ?? null : null}
              onUnbind={async () => {
                await fetch(`${AUTH_URL}/auth/discord/unbind`, { method: "POST", credentials: "include" });
                setProfile(await fetchOperator(address));
              }}
            />
          </div>
        </BracketedCell>
      </section>

      {/* SETTINGS — isMe only. Dark mode is gone per the redesign. */}
      {isMe ? (
        <section className="mx-auto max-w-[1080px] px-6 py-12 pb-16">
          <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
            <span aria-hidden className="text-accent">■</span> SETTINGS
          </div>
          <BracketedCell pad="sm">
            <div className="flex flex-col">
              <SettingRow
                k="lang"
                label="LANGUAGE"
                hint="more languages are coming"
                options={[
                  { value: "en", label: "ENGLISH" },
                  { value: "es", label: "SPANISH (SOON)", disabled: true },
                  { value: "ja", label: "JAPANESE (SOON)", disabled: true },
                ]}
                fallback="en"
              />
              <ToggleRow
                k="muted"
                label="MUTE SOUND EFFECTS"
                hint="sound effects are coming; the toggle remembers your choice."
              />
            </div>
          </BracketedCell>
        </section>
      ) : null}

      <Footer />
    </div>
  );
}

/// One social row inside the BracketedCell. Used directly for X. Telegram and
/// Discord wrap their own rows because of the widget/OAuth specifics.
function SocialRow({
  label,
  handle,
  hint,
  isMe,
  connectHref,
  onUnbind,
}: {
  label: string;
  handle: string | null;
  hint: string;
  isMe: boolean;
  connectHref: string;
  onUnbind: () => void | Promise<void>;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--hairline)] py-3 last:border-0">
      <div className="min-w-0">
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">{label}</div>
        <div className="mt-1 font-mono text-sm text-ink">{handle ?? "NOT LINKED"}</div>
        <div className="mt-0.5 font-mono text-[11px] text-ink-3">{hint}</div>
      </div>
      {isMe ? (
        handle ? (
          <button
            onClick={onUnbind}
            className="border border-ink-3 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:border-ink hover:text-ink"
          >
            UNBIND
          </button>
        ) : (
          <a
            href={connectHref}
            className="inline-flex items-center gap-2 bg-accent px-4 py-2 font-mono text-[12px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press"
          >
            LINK <span aria-hidden>→</span>
          </a>
        )
      ) : null}
    </div>
  );
}

/// Read a File, downscale to fit 256x256, return a PNG data URL.
async function downscaleToDataUrl(file: File, max = 256): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = (e) => rej(e);
      im.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function AgentCustomizeCard({ agent, isMe }: { agent: AgentState; isMe: boolean }) {
  const [name, setName] = useState<string>(agent.nickname ?? "");
  const [skin, setSkin] = useState<string | null>(agent.skin ?? null);
  const [busy, setBusy] = useState(false);
  const [skinBusy, setSkinBusy] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const [skinNote, setSkinNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(agent.nickname ?? "");
    setSkin(agent.skin ?? null);
  }, [agent.id, agent.nickname, agent.skin]);

  async function save() {
    setBusy(true); setError(null);
    const res = await saveAgentName(agent.id, name);
    setBusy(false);
    if (res.ok) {
      setName(res.nickname ?? "");
      setSavedNote(true);
      setTimeout(() => setSavedNote(false), 1500);
    } else setError(res.error);
  }

  async function onPickSkin(file: File) {
    if (!file.type.startsWith("image/")) { setError("file must be an image"); return; }
    setSkinBusy(true); setError(null); setSkinNote(null);
    try {
      const dataUrl = await downscaleToDataUrl(file, 256);
      const res = await saveAgentSkin(agent.id, dataUrl);
      if (res.ok) {
        setSkin(dataUrl);
        setSkinNote("SKIN SAVED");
        setTimeout(() => setSkinNote(null), 1500);
      } else setError(res.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not process image");
    } finally {
      setSkinBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function onClearSkin() {
    setSkinBusy(true); setError(null);
    const res = await clearAgentSkin(agent.id);
    setSkinBusy(false);
    if (res.ok) {
      setSkin(null);
      setSkinNote("SKIN CLEARED");
      setTimeout(() => setSkinNote(null), 1500);
    } else setError(res.error);
  }

  const display = (name || agent.nickname || "").trim();

  return (
    <BracketedCell className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden bg-canvas-3">
          {skin ? (
            <img src={skin} alt={display || `agent #${agent.id}`} className="h-full w-full object-cover" />
          ) : (
            <Robot variant="pink" size={42} decorative />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-stencil uppercase text-ink" style={{ fontSize: 18, letterSpacing: "-0.01em" }}>
            {display ? display : `AGENT #${agent.id}`}
          </div>
          <div className="mt-1 font-mono text-[11px] text-ink-3">
            {CONTEST_TYPES.map((t) => `${t.toUpperCase()} T${tierOf(agent, t)}`).join(" · ")}
          </div>
        </div>
      </div>

      {isMe ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`name agent #${agent.id}`}
              className="min-w-0 flex-1 border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none transition-colors focus:border-ink"
              disabled={busy}
              maxLength={24}
            />
            <button
              onClick={save}
              disabled={busy}
              className="bg-accent px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press disabled:opacity-60"
            >
              {busy ? "SAVING…" : "SAVE"}
            </button>
            {savedNote ? <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--ok)]">SAVED</span> : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickSkin(f); }}
            />
            <button
              onClick={() => fileInput.current?.click()}
              disabled={skinBusy}
              className="border border-ink px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink hover:bg-canvas-3 disabled:opacity-60"
            >
              {skinBusy ? "UPLOADING…" : skin ? "REPLACE SKIN" : "UPLOAD CUSTOM SKIN"}
            </button>
            {skin ? (
              <button
                onClick={onClearSkin}
                disabled={skinBusy}
                className="border border-[color:var(--err)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--err)] hover:bg-canvas-3 disabled:opacity-60"
              >
                CLEAR
              </button>
            ) : null}
            {skinNote ? <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--ok)]">{skinNote}</span> : null}
          </div>
          <p className="font-mono text-[10px] text-ink-3">auto-resized to 256×256 png · &lt;200kb</p>

          {error ? <p className="font-mono text-[11px] text-[color:var(--err)]">{error}</p> : null}
        </>
      ) : null}

      <div className="border-t border-[color:var(--hairline)] pt-3">
        <NftBadge tokenId={agent.erc8004TokenId} />
        <AgentTraits agentId={agent.id} />
      </div>

      <div>
        <span className="border border-[color:var(--hairline-strong)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
          TRAIN WITH SKILLS · SOON
        </span>
      </div>
    </BracketedCell>
  );
}

function TelegramRow({
  isMe,
  handle,
  telegramId,
  onUnbind,
}: {
  isMe: boolean;
  handle: string | null;
  telegramId: string | null;
  onUnbind: () => Promise<void>;
}) {
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const widgetMount = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    fetch(`${AUTH_URL}/auth/telegram/config`)
      .then((r) => r.json())
      .then((d: { configured?: boolean; botUsername?: string | null }) => {
        if (!live) return;
        setConfigured(!!d.configured);
        setBotUsername(d.botUsername ?? null);
      })
      .catch(() => live && setConfigured(false));
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!isMe || handle || !configured || !botUsername || !widgetMount.current) return;
    const host = widgetMount.current;
    host.innerHTML = "";
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "medium");
    script.setAttribute("data-auth-url", `${AUTH_URL}/auth/telegram/callback`);
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-radius", "0");
    host.appendChild(script);
    return () => { host.innerHTML = ""; };
  }, [isMe, handle, configured, botUsername]);

  const displayHandle = handle ? `@${handle}` : telegramId ? `ID ${telegramId}` : "NOT LINKED";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--hairline)] py-3 last:border-0">
      <div className="min-w-0">
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">TELEGRAM</div>
        <div className="mt-1 font-mono text-sm text-ink">{displayHandle}</div>
        <div className="mt-0.5 font-mono text-[11px] text-ink-3">
          {configured === false ? "telegram bot not configured" : "verified by telegram login widget"}
        </div>
      </div>

      {isMe ? (
        handle ? (
          <button
            onClick={onUnbind}
            className="border border-ink-3 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:border-ink hover:text-ink"
          >
            UNBIND
          </button>
        ) : configured ? (
          <div ref={widgetMount} />
        ) : (
          <button
            disabled
            className="cursor-not-allowed border border-[color:var(--hairline-strong)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3"
          >
            UNAVAILABLE
          </button>
        )
      ) : null}
    </div>
  );
}

function DiscordRow({
  isMe,
  handle,
  onUnbind,
}: {
  isMe: boolean;
  handle: string | null;
  onUnbind: () => Promise<void>;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--hairline)] py-3 last:border-0">
      <div className="min-w-0">
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">DISCORD</div>
        <div className="mt-1 font-mono text-sm text-ink">{handle ? handle : "NOT LINKED"}</div>
        <div className="mt-0.5 font-mono text-[11px] text-ink-3">oauth2 identify scope</div>
      </div>

      {isMe ? (
        handle ? (
          <button
            onClick={onUnbind}
            className="border border-ink-3 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:border-ink hover:text-ink"
          >
            UNBIND
          </button>
        ) : (
          <a
            href={`${AUTH_URL}/auth/discord/start`}
            className="inline-flex items-center gap-2 bg-accent px-4 py-2 font-mono text-[12px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press"
          >
            LINK <span aria-hidden>→</span>
          </a>
        )
      ) : null}
    </div>
  );
}

function SettingRow({
  k,
  label,
  hint,
  options,
  fallback,
}: {
  k: SettingKey;
  label: string;
  hint?: string;
  options: { value: string; label: string; disabled?: boolean }[];
  fallback: string;
}) {
  const [value, setValue] = useState<string>(fallback);
  useEffect(() => { setValue(getSetting(k, fallback)); }, [k, fallback]);
  function pick(v: string) { setValue(v); setSetting(k, v); }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[color:var(--hairline)] py-3 last:border-0">
      <div className="min-w-0">
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">{label}</div>
        {hint ? <p className="mt-0.5 font-mono text-[11px] text-ink-3">{hint}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => !o.disabled && pick(o.value)}
            disabled={o.disabled}
            className={
              value === o.value
                ? "border border-accent bg-accent px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink"
                : "border border-ink-3 bg-canvas px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ToggleRow({ k, label, hint }: { k: SettingKey; label: string; hint?: string }) {
  const [on, setOn] = useState<boolean>(false);
  useEffect(() => { setOn(getSetting(k, "off") === "on"); }, [k]);
  function toggle() { const next = !on; setOn(next); setSetting(k, next ? "on" : "off"); }
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[color:var(--hairline)] py-3 last:border-0">
      <div className="min-w-0">
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">{label}</div>
        {hint ? <p className="mt-0.5 font-mono text-[11px] text-ink-3">{hint}</p> : null}
      </div>
      <button
        onClick={toggle}
        aria-pressed={on}
        className="inline-flex items-center gap-2 border border-ink-3 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink hover:border-ink"
      >
        <span aria-hidden style={{ color: on ? "var(--accent)" : "var(--ink-3)" }}>●</span>
        {on ? "ON" : "OFF"}
      </button>
    </div>
  );
}
