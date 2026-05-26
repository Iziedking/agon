"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAccount } from "wagmi";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/pengu/Footer";
import { Bubble3D, SectionLabel } from "@/components/pengu/atoms";
import { AgentMascot } from "@/components/pengu/AgentMascot";
import { OperatorAvatar } from "@/components/pengu/OperatorAvatar";
import { EXPLORER } from "@/lib/arc";
import { CONTEST_TYPES, fetchAgents, tierOf, type AgentState } from "@/lib/agents";
import {
  agentColorById,
  fetchOperator,
  getAgentNickname,
  getSetting,
  getSocial,
  setAgentNickname,
  setSetting,
  setSocial,
  short,
  type OperatorProfile,
  type SocialKind,
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
  "rounded-pill border border-pengu-blue/30 bg-white px-5 py-2.5 font-display text-xs uppercase tracking-wide text-pengu-blue hover:border-pengu-blue";
const input =
  "w-full rounded-pill border border-pengu-blue/20 bg-white px-4 py-2 font-mono text-sm text-pengu-dark outline-none transition-colors focus:border-pengu-blue";
const card =
  "rounded-card border border-pengu-blue/15 bg-white p-6 shadow-[0_8px_24px_rgba(70,45,150,0.06)]";

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
    <div className="min-h-screen text-pengu-dark" style={{ background: "#f3effb" }}>
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

          {/* Telegram + Discord (localStorage) */}
          <SocialField kind="telegram" label="telegram" placeholder="your handle, no @" isMe={isMe} />
          <SocialField kind="discord" label="discord" placeholder="your handle" isMe={isMe} />

          {!isMe ? (
            <p className="font-mono text-[11px] text-pengu-dark/45">
              telegram and discord handles are saved per-browser for now, so only their owner sees them here.
            </p>
          ) : null}
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
              hint="dark mode is coming"
              options={[
                { value: "light", label: "light" },
                { value: "dark", label: "dark (soon)", disabled: true },
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

function AgentCustomizeCard({ agent, isMe }: { agent: AgentState; isMe: boolean }) {
  const [name, setName] = useState<string>("");
  const [savedNote, setSavedNote] = useState(false);

  useEffect(() => {
    setName(getAgentNickname(agent.id));
  }, [agent.id]);

  function save() {
    setAgentNickname(agent.id, name);
    setSavedNote(true);
    setTimeout(() => setSavedNote(false), 1500);
  }

  return (
    <div className="rounded-card border border-pengu-blue/15 bg-white p-5 shadow-[0_8px_24px_rgba(70,45,150,0.06)]">
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-full border border-pengu-blue/15 bg-white">
          <AgentMascot color={agentColorById(agent.id)} className="h-[68%] w-auto" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-bubble text-lg uppercase text-pengu-dark">
            {name ? name : `agent #${agent.id}`}
            <span className="ml-2 font-mono text-xs text-pengu-dark/45">#{agent.id}</span>
          </div>
          <div className="mt-0.5 font-mono text-xs text-pengu-dark/55">
            {CONTEST_TYPES.map((t) => `${t} t${tierOf(agent, t)}`).join(" · ")}
          </div>
        </div>
      </div>

      {isMe ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`name agent #${agent.id}`}
            className="w-full max-w-[280px] rounded-pill border border-pengu-blue/20 bg-white px-4 py-2 font-mono text-sm text-pengu-dark outline-none transition-colors focus:border-pengu-blue"
          />
          <button onClick={save} className={chunkyBtn}>
            save name
          </button>
          {savedNote ? <span className="font-mono text-xs text-[#22c55e]">saved</span> : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {["upload custom skin", "train with skills", "add traits"].map((t) => (
          <span
            key={t}
            className="rounded-full border border-pengu-blue/15 bg-pengu-bg px-3 py-1 font-display text-[10px] uppercase tracking-wide text-pengu-dark/45"
          >
            {t} · soon
          </span>
        ))}
      </div>
    </div>
  );
}

function SocialField({
  kind,
  label,
  placeholder,
  isMe,
}: {
  kind: SocialKind;
  label: string;
  placeholder: string;
  isMe: boolean;
}) {
  const [value, setValue] = useState("");
  const [savedNote, setSavedNote] = useState(false);

  useEffect(() => {
    setValue(getSocial(kind));
  }, [kind]);

  function save() {
    setSocial(kind, value);
    setSavedNote(true);
    setTimeout(() => setSavedNote(false), 1500);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="font-display text-xs uppercase tracking-wide text-pengu-dark/45">{label}</div>
        <div className="mt-1 font-mono text-sm text-pengu-dark">{value ? `@${value}` : "not set"}</div>
      </div>
      {isMe ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className={`max-w-[240px] ${input}`}
          />
          <button onClick={save} className={chunkyBtn}>
            save
          </button>
          {savedNote ? <span className="font-mono text-xs text-[#22c55e]">saved</span> : null}
        </div>
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
          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.2)] transition-transform ${
            on ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}
