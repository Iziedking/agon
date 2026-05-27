"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useAccount } from "wagmi";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/pengu/Footer";
import { Bubble3D, SectionLabel } from "@/components/pengu/atoms";
import { AgentMascot } from "@/components/pengu/AgentMascot";
import { AgentTraits } from "@/components/pengu/AgentTraits";
import { NftBadge } from "@/components/pengu/NftBadge";
import { OperatorAvatar } from "@/components/pengu/OperatorAvatar";
import { EXPLORER } from "@/lib/arc";
import { CONTEST_TYPES, fetchAgents, tierOf, type AgentState } from "@/lib/agents";
import {
  agentColorById,
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

/// The operator profile, redesigned as a personal identity and settings page.
/// Activity stats and recent contests have moved to /dashboard; this page is
/// for who you are and how things look. Agent nicknames and the optional
/// telegram/discord handles live in localStorage (per-browser) for now;
/// X is the only social that is server-persisted, via the existing OAuth
/// link/unlink flow.

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

const chunkyBtn =
  "rounded-pill bg-pengu-blue px-5 py-2.5 font-display text-xs uppercase tracking-wide text-white shadow-[0_4px_0_0_#5b34d6] transition-all duration-100 hover:translate-y-[2px] hover:shadow-[0_2px_0_0_#5b34d6]";
const ghostBtn =
  "rounded-pill border border-pengu-blue/30 bg-pengu-card px-5 py-2.5 font-display text-xs uppercase tracking-wide text-pengu-blue hover:border-pengu-blue";
const input =
  "w-full rounded-pill border border-pengu-blue/20 bg-pengu-card px-4 py-2 font-mono text-sm text-pengu-dark outline-none transition-colors focus:border-pengu-blue";
const card =
  "rounded-card border border-pengu-blue/15 bg-pengu-card p-6 shadow-[0_8px_24px_rgba(70,45,150,0.06)]";

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
      .then((p) => {
        if (live) setProfile(p);
      })
      .catch(() => {
        if (live) setProfile(null);
      });
    fetchAgents(address as `0x${string}`)
      .then((list) => {
        if (live) setAgents(list);
      })
      .catch(() => {
        if (live) setAgents([]);
      });
    return () => {
      live = false;
    };
  }, [address]);

  async function unbindX() {
    try {
      await fetch(`${AUTH_URL}/auth/x/unbind`, { method: "POST", credentials: "include" });
      const next = await fetchOperator(address);
      setProfile(next);
    } catch {
      // silent; the link will re-show next reload if the unbind failed
    }
  }

  return (
    <div className="min-h-screen text-pengu-dark">
      <AppHeader />

      <section className="mx-auto max-w-[900px] px-6 pb-10 pt-12">
        <SectionLabel>operator</SectionLabel>
        <div className="mt-5 flex flex-wrap items-center gap-5">
          <OperatorAvatar address={address} className="h-16 w-16 shadow-[0_8px_24px_rgba(70,45,150,0.06)]" />
          <div className="min-w-0 flex-1">
            <Bubble3D className="break-all text-[clamp(28px,4vw,44px)]">{short(address)}</Bubble3D>
            {profile !== "loading" && profile?.xHandle ? (
              <p className="mt-1 font-mono text-sm text-pengu-blue">@{profile.xHandle}</p>
            ) : null}
          </div>
          <a
            href={`${EXPLORER}/address/${address}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-pengu-dark/45 hover:text-pengu-blue"
          >
            arcscan ↗
          </a>
        </div>

        {profile === "loading" ? (
          <p className="mt-6 font-mono text-sm text-pengu-dark/55">reading the profile…</p>
        ) : null}
      </section>

      {/* Agents customization */}
      <section className="mx-auto max-w-[900px] px-6 pb-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SectionLabel>agents</SectionLabel>
          {isMe ? (
            <a href="/workshop" className="font-display text-xs uppercase tracking-wide text-pengu-blue hover:underline">
              manage in workshop →
            </a>
          ) : null}
        </div>

        {agents === undefined ? (
          <p className="mt-4 font-mono text-sm text-pengu-dark/55">reading agents from arc…</p>
        ) : agents.length === 0 ? (
          <p className="mt-4 font-mono text-sm text-pengu-dark/55">no agents claimed yet.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            {agents.map((a) => (
              <AgentCustomizeCard key={a.id} agent={a} isMe={isMe} />
            ))}
          </div>
        )}
      </section>

      {/* Socials */}
      <section className="mx-auto max-w-[900px] px-6 pb-10">
        <SectionLabel>socials</SectionLabel>
        <div className={`mt-4 ${card} flex flex-col gap-5`}>
          {/* X */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-display text-xs uppercase tracking-wide text-pengu-dark/45">x (twitter)</div>
              <div className="mt-1 font-mono text-sm text-pengu-dark">
                {profile !== "loading" && profile?.xHandle ? `@${profile.xHandle}` : "not linked"}
              </div>
            </div>
            {isMe ? (
              profile !== "loading" && profile?.xHandle ? (
                <button onClick={unbindX} className={ghostBtn}>
                  unbind
                </button>
              ) : (
                <a href={`${AUTH_URL}/auth/x/start`} className={chunkyBtn}>
                  connect x
                </a>
              )
            ) : null}
          </div>

          <div className="h-px bg-pengu-blue/10" />

          {/* Telegram */}
          <TelegramRow
            isMe={isMe}
            handle={profile !== "loading" ? profile?.telegramUsername ?? null : null}
            telegramId={profile !== "loading" ? profile?.telegramId ?? null : null}
            onUnbind={async () => {
              await fetch(`${AUTH_URL}/auth/telegram/unbind`, {
                method: "POST",
                credentials: "include",
              });
              const next = await fetchOperator(address);
              setProfile(next);
            }}
          />

          <div className="h-px bg-pengu-blue/10" />

          {/* Discord */}
          <DiscordRow
            isMe={isMe}
            handle={profile !== "loading" ? profile?.discordUsername ?? null : null}
            onUnbind={async () => {
              await fetch(`${AUTH_URL}/auth/discord/unbind`, {
                method: "POST",
                credentials: "include",
              });
              const next = await fetchOperator(address);
              setProfile(next);
            }}
          />
        </div>
      </section>

      {/* Settings (isMe only) */}
      {isMe ? (
        <section className="mx-auto max-w-[900px] px-6 pb-16">
          <SectionLabel>settings</SectionLabel>
          <div className={`mt-4 ${card} flex flex-col gap-5`}>
            <SettingRow
              k="theme"
              label="theme"
              hint="flip the entire arena to dark; choice persists across visits"
              options={[
                { value: "light", label: "light" },
                { value: "dark", label: "dark" },
              ]}
              fallback="light"
            />
            <div className="h-px bg-pengu-blue/10" />
            <SettingRow
              k="lang"
              label="language"
              hint="more languages are coming"
              options={[
                { value: "en", label: "english" },
                { value: "es", label: "spanish (soon)", disabled: true },
                { value: "ja", label: "japanese (soon)", disabled: true },
              ]}
              fallback="en"
            />
            <div className="h-px bg-pengu-blue/10" />
            <ToggleRow k="muted" label="mute sound effects" hint="sound is coming; the toggle remembers your choice for when it arrives." />
          </div>
        </section>
      ) : null}

      <Footer />
    </div>
  );
}

/// Read a File, downscale to fit 256x256, return a PNG data URL. Keeps the
/// payload tiny regardless of source resolution and forces a single output
/// format the server can validate.
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
    canvas.width = w;
    canvas.height = h;
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

  // Sync the input from incoming agent prop so the field reflects whatever the
  // server returned after the last fetchAgents call.
  useEffect(() => {
    setName(agent.nickname ?? "");
    setSkin(agent.skin ?? null);
  }, [agent.id, agent.nickname, agent.skin]);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await saveAgentName(agent.id, name);
    setBusy(false);
    if (res.ok) {
      setName(res.nickname ?? "");
      setSavedNote(true);
      setTimeout(() => setSavedNote(false), 1500);
    } else {
      setError(res.error);
    }
  }

  async function onPickSkin(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("file must be an image");
      return;
    }
    setSkinBusy(true);
    setError(null);
    setSkinNote(null);
    try {
      const dataUrl = await downscaleToDataUrl(file, 256);
      const res = await saveAgentSkin(agent.id, dataUrl);
      if (res.ok) {
        setSkin(dataUrl);
        setSkinNote("skin saved");
        setTimeout(() => setSkinNote(null), 1500);
      } else {
        setError(res.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not process image");
    } finally {
      setSkinBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function onClearSkin() {
    setSkinBusy(true);
    setError(null);
    const res = await clearAgentSkin(agent.id);
    setSkinBusy(false);
    if (res.ok) {
      setSkin(null);
      setSkinNote("skin cleared");
      setTimeout(() => setSkinNote(null), 1500);
    } else {
      setError(res.error);
    }
  }

  const display = (name || agent.nickname || "").trim();

  return (
    <div className="rounded-card border border-pengu-blue/15 bg-pengu-card p-5 shadow-[0_8px_24px_rgba(70,45,150,0.06)]">
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-full border border-pengu-blue/15 bg-pengu-card">
          {skin ? (
            <img
              src={skin}
              alt={display || `agent #${agent.id}`}
              className="h-full w-full object-cover"
            />
          ) : (
            <AgentMascot color={agentColorById(agent.id)} className="h-[68%] w-auto" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-bubble text-lg uppercase text-pengu-dark">
            {display ? display : `agent #${agent.id}`}
            <span className="ml-2 font-mono text-xs text-pengu-dark/45">#{agent.id}</span>
          </div>
          <div className="mt-0.5 font-mono text-xs text-pengu-dark/55">
            {CONTEST_TYPES.map((t) => `${t} t${tierOf(agent, t)}`).join(" · ")}
          </div>
        </div>
      </div>

      {isMe ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`name agent #${agent.id}`}
              className="w-full max-w-[280px] rounded-pill border border-pengu-blue/20 bg-pengu-card px-4 py-2 font-mono text-sm text-pengu-dark outline-none transition-colors focus:border-pengu-blue"
              disabled={busy}
              maxLength={24}
            />
            <button onClick={save} disabled={busy} className={`${chunkyBtn} disabled:opacity-60`}>
              {busy ? "saving…" : "save name"}
            </button>
            {savedNote ? <span className="font-mono text-xs text-[#22c55e]">saved</span> : null}
          </div>

          {/* Skin upload row */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onPickSkin(f);
              }}
            />
            <button
              onClick={() => fileInput.current?.click()}
              disabled={skinBusy}
              className={`${ghostBtn} disabled:opacity-60`}
            >
              {skinBusy ? "uploading…" : skin ? "replace skin" : "upload custom skin"}
            </button>
            {skin ? (
              <button
                onClick={onClearSkin}
                disabled={skinBusy}
                className="rounded-pill border border-[#e0466e]/40 px-5 py-2.5 font-display text-xs uppercase tracking-wide text-[#e0466e] hover:border-[#e0466e] disabled:opacity-60"
              >
                clear skin
              </button>
            ) : null}
            <span className="font-mono text-[10px] text-pengu-dark/45">
              auto-resized to 256×256 png · &lt;200kb
            </span>
            {skinNote ? <span className="font-mono text-xs text-[#22c55e]">{skinNote}</span> : null}
          </div>

          {error ? <p className="mt-2 font-mono text-xs text-[#e0466e]">{error}</p> : null}
        </>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <NftBadge tokenId={agent.erc8004TokenId} />
      </div>
      <AgentTraits agentId={agent.id} />

      <div className="mt-4 flex flex-wrap gap-2">
        <span className="rounded-full border border-pengu-blue/15 bg-pengu-bg px-3 py-1 font-display text-[10px] uppercase tracking-wide text-pengu-dark/45">
          train with skills · soon
        </span>
      </div>
    </div>
  );
}

/// Telegram linking row. Fetches the bot's username from the backend so we
/// know whether telegram is configured server-side, then embeds the Telegram
/// Login Widget script for the connect action. Already-linked state shows the
/// handle and an unbind button. Skipping or failing the config fetch falls
/// back to a "not configured" message so judges can see the rest of the page.
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
    return () => {
      live = false;
    };
  }, []);

  // Mount the Telegram Login Widget when configured, the connected user is
  // viewing their own profile, and they haven't already linked.
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
    script.setAttribute("data-radius", "20");
    host.appendChild(script);
    return () => {
      host.innerHTML = "";
    };
  }, [isMe, handle, configured, botUsername]);

  const displayHandle = handle ? `@${handle}` : telegramId ? `id ${telegramId}` : "not linked";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="font-display text-xs uppercase tracking-wide text-pengu-dark/45">telegram</div>
        <div className="mt-1 font-mono text-sm text-pengu-dark">{displayHandle}</div>
        <div className="mt-0.5 font-mono text-[11px] text-pengu-dark/45">
          {configured === false ? "telegram bot not configured" : "verified by telegram login widget"}
        </div>
      </div>

      {isMe ? (
        handle ? (
          <button onClick={onUnbind} className={ghostBtn}>
            unbind
          </button>
        ) : configured ? (
          <div ref={widgetMount} />
        ) : (
          <button
            disabled
            className="cursor-not-allowed rounded-pill border border-pengu-blue/15 bg-pengu-bg px-5 py-2.5 font-display text-xs uppercase tracking-wide text-pengu-dark/40"
          >
            unavailable
          </button>
        )
      ) : null}
    </div>
  );
}

/// Discord linking row. Matches the X pattern: connect link points at the
/// server start endpoint, which redirects to discord.com and back with a code.
/// Already-linked state shows the username and an unbind button.
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
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="font-display text-xs uppercase tracking-wide text-pengu-dark/45">discord</div>
        <div className="mt-1 font-mono text-sm text-pengu-dark">{handle ? handle : "not linked"}</div>
        <div className="mt-0.5 font-mono text-[11px] text-pengu-dark/45">oauth2 identify scope</div>
      </div>

      {isMe ? (
        handle ? (
          <button onClick={onUnbind} className={ghostBtn}>
            unbind
          </button>
        ) : (
          <a href={`${AUTH_URL}/auth/discord/start`} className={chunkyBtn}>
            connect discord
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

  useEffect(() => {
    setValue(getSetting(k, fallback));
  }, [k, fallback]);

  function pick(v: string) {
    setValue(v);
    setSetting(k, v);
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="font-display text-xs uppercase tracking-wide text-pengu-dark/45">{label}</div>
        {hint ? <div className="mt-1 font-mono text-[11px] text-pengu-dark/45">{hint}</div> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => !o.disabled && pick(o.value)}
            disabled={o.disabled}
            className={`rounded-full px-3 py-1.5 font-display text-[11px] uppercase tracking-wide transition-colors ${
              o.disabled
                ? "cursor-not-allowed bg-pengu-blue/5 text-pengu-dark/30"
                : value === o.value
                  ? "bg-pengu-blue text-white"
                  : "bg-pengu-blue/10 text-pengu-blue hover:bg-pengu-blue/20"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ToggleRow({ k, label, hint }: { k: SettingKey; label: string; hint?: string }) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    setOn(getSetting(k, "0") === "1");
  }, [k]);

  function toggle() {
    const next = !on;
    setOn(next);
    setSetting(k, next ? "1" : "0");
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="font-display text-xs uppercase tracking-wide text-pengu-dark/45">{label}</div>
        {hint ? <div className="mt-1 font-mono text-[11px] text-pengu-dark/45">{hint}</div> : null}
      </div>
      <button
        onClick={toggle}
        className={`relative h-7 w-12 flex-none rounded-full transition-colors ${on ? "bg-pengu-blue" : "bg-pengu-blue/15"}`}
        aria-pressed={on}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-pengu-card shadow-[0_2px_4px_rgba(0,0,0,0.2)] transition-transform ${
            on ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}
