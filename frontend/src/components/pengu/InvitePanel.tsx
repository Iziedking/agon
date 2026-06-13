"use client";

import { useCallback, useEffect, useState } from "react";
import { useArcWrite } from "@/hooks/useArcWrite";
import { useOperatorAddress } from "@/hooks/useAuth";
import { BracketedCell } from "@/components/redesign";
import { CONTRACTS, publicClient } from "@/lib/arc";
import { challengeArenaAbi, fetchChallengeInvites, type ChallengeInvitee } from "@/lib/challenges";
import { resolveRecipients } from "@/lib/profiles";
import { friendlyError } from "@/lib/errors";
import { logRawError, reportEvent } from "@/lib/report";

/// Invite panel for private challenges. Renders for the creator while the
/// challenge is OPEN. Accepts a comma or newline separated list of wallet
/// addresses, @X handles, and Discord usernames; resolves the handles to
/// operator wallets, then fires one ChallengeArena.invite tx for all of them.
/// Each invitee is notified in-app and on Telegram (if linked) with a link to
/// the challenge, via the indexer's ChallengeInvited handler. Shows the
/// already-invited list below, populated from the indexer's challenge_invites
/// table. Also gives the creator a one-click COPY INVITE LINK to share offchain.

interface Props {
  challengeId: number;
  creator: string;
  isPrivate: boolean;
  /// 0 = OPEN, 1 = LOCKED, 2 = SETTLED, 3 = CANCELLED
  status: number;
}

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function InvitePanel({ challengeId, creator, isPrivate, status }: Props) {
  const { address } = useOperatorAddress();
  const { writeContractAsync } = useArcWrite();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [invites, setInvites] = useState<ChallengeInvitee[]>([]);

  const isCreator = !!address && address.toLowerCase() === creator.toLowerCase();
  const isOpen = status === 0;
  const visible = isPrivate && isCreator && isOpen;

  const reload = useCallback(async () => {
    setInvites(await fetchChallengeInvites(challengeId));
  }, [challengeId]);

  useEffect(() => {
    if (!visible) return;
    void reload();
  }, [visible, reload]);

  if (!visible) return null;

  function tokenize(raw: string): string[] {
    return raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  }

  async function copyLink() {
    const url = `${window.location.origin}/challenges/${challengeId}`;
    try {
      await navigator.clipboard.writeText(url);
      setNote("LINK COPIED");
      setTimeout(() => setNote(null), 1500);
    } catch {
      setError("could not copy. select the link manually.");
    }
  }

  async function sendInvites() {
    const tokens = tokenize(input);
    if (tokens.length === 0) {
      setError("add one or more wallet addresses, @x handles, or discord usernames.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Resolve @x handles and discord usernames to operator wallets; plain
      // 0x addresses pass through. invite() is on-chain and takes addresses.
      const resolved = await resolveRecipients(tokens);
      const seen = new Set<string>();
      const good: `0x${string}`[] = [];
      for (const r of resolved) {
        if (!r.address) continue;
        const lower = r.address.toLowerCase();
        if (seen.has(lower)) continue;
        seen.add(lower);
        good.push(r.address as `0x${string}`);
      }
      const unresolved = resolved.filter((r) => !r.address).map((r) => r.input);
      if (good.length === 0) {
        setError(
          `couldn't find an arcrun account for ${unresolved.join(", ")}. they need to sign in once before you can invite them.`,
        );
        setBusy(false);
        return;
      }
      const hash = await writeContractAsync({
        address: CONTRACTS.ChallengeArena,
        abi: challengeArenaAbi,
        functionName: "invite",
        args: [BigInt(challengeId), good],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      reportEvent("challenge_invite", {
        context: { id: challengeId, count: good.length },
        address,
      });
      setNote(`INVITED ${good.length}`);
      // Partial success: tell the creator which handles didn't map to an
      // account so they can chase them, while still confirming the rest.
      if (unresolved.length > 0) {
        setError(`couldn't find: ${unresolved.join(", ")}. invited the ${good.length} we could.`);
      }
      setInput("");
      setTimeout(() => setNote(null), 1500);
      // Optimistically merge the just-invited addresses so the creator sees
      // confirmation immediately, before the indexer catches the event.
      setInvites((prev) => {
        const seen = new Set(prev.map((i) => i.address.toLowerCase()));
        const fresh = good
          .filter((g) => !seen.has(g.toLowerCase()))
          .map((g) => ({ address: g, invitedAt: new Date().toISOString() }));
        return [...prev, ...fresh];
      });
      void reload();
    } catch (e) {
      setError(friendlyError(e, "could not invite."));
      logRawError("challenge_invite_error", e, { address, context: { id: challengeId } });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
          <span aria-hidden className="text-accent">■</span> INVITE
        </span>
        <button
          onClick={copyLink}
          className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink"
        >
          COPY INVITE LINK ↗
        </button>
      </div>
      <BracketedCell pad="md">
        <p className="font-mono text-[12px] leading-[1.55] text-ink-2">
          only invited operators can join this challenge. add them by wallet address, @x handle, or discord username. they get an in-app and telegram alert with a link, and the on-chain invite goes out in one tx.
        </p>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="0xabc...  @xhandle  discordname"
          rows={3}
          disabled={busy}
          className="mt-4 w-full border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-[12px] text-ink outline-none transition-colors focus:border-ink"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={sendInvites}
            disabled={busy}
            className="inline-flex items-center gap-2 bg-accent px-4 py-2 font-mono text-[12px] uppercase tracking-[0.12em] text-accent-ink transition-colors hover:bg-accent-press disabled:opacity-60"
          >
            {busy ? "INVITING…" : "INVITE"} <span aria-hidden>→</span>
          </button>
          {note ? (
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--ok)]">{note}</span>
          ) : null}
        </div>
        {error ? (
          <p className="mt-3 font-mono text-[11px] text-[#e0466e]">{error}</p>
        ) : null}

        {invites.length > 0 ? (
          <div className="mt-5 border-t border-[color:var(--hairline)] pt-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">
              INVITED · {invites.length}
            </div>
            <ul className="mt-2 flex flex-col gap-1">
              {invites.map((i) => (
                <li key={i.address} className="font-mono text-[12px] text-ink">
                  {short(i.address)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </BracketedCell>
    </section>
  );
}
