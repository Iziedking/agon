"use client";

import type { CSSProperties } from "react";
import {
  AgentMascot,
  variantForAgentId,
  type AgentMood,
  type AgentVariant,
} from "@/components/pengu/AgentMascot";

/// Renders an agent's visual. If the owner has uploaded a skin, the image is
/// shown; otherwise falls back to the variant mascot. Same prop shape as the
/// mascot so swap-in is mechanical.
export function AgentAvatar({
  agent,
  variant,
  mood,
  live,
  className = "",
  style,
  alt,
}: {
  agent: { id: number; nickname?: string | null; skin?: string | null };
  variant?: AgentVariant;
  mood?: AgentMood;
  live?: boolean;
  className?: string;
  style?: CSSProperties;
  alt?: string;
}) {
  if (agent.skin) {
    return (
      <img
        src={agent.skin}
        alt={alt ?? agent.nickname ?? `agent #${agent.id}`}
        className={`object-cover ${live ? "breath" : ""} ${className}`}
        style={style}
        loading="lazy"
        decoding="async"
      />
    );
  }
  return (
    <AgentMascot
      variant={variant ?? variantForAgentId(agent.id)}
      mood={mood}
      live={live}
      className={className}
      style={style}
    />
  );
}
