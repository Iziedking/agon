"use client";

import { agentDisplayName, type AgentState } from "@/lib/agents";

/// A chip row for picking which of the operator's agents enters a contest or
/// joins a challenge. Hidden when there is only one agent (no choice to make).
/// Used inside EnterPanel and JoinChallengePanel.
export function AgentPicker({
  agents,
  activeId,
  onPick,
}: {
  agents: AgentState[];
  activeId: number | null;
  onPick: (id: number) => void;
}) {
  if (agents.length <= 1) return null;
  return (
    <div className="mt-3">
      <div className="font-display text-[10px] uppercase tracking-wide text-pengu-dark/40">competing as</div>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {agents.map((a) => (
          <button
            key={a.id}
            onClick={() => onPick(a.id)}
            className={`rounded-full px-3 py-1 font-display text-[11px] uppercase tracking-wide transition-colors ${
              a.id === activeId
                ? "bg-pengu-blue text-white"
                : "bg-pengu-blue/10 text-pengu-blue hover:bg-pengu-blue/20"
            }`}
          >
            {agentDisplayName(a)}
          </button>
        ))}
      </div>
    </div>
  );
}
