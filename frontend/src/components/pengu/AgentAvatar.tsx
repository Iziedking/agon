"use client";

import type { CSSProperties } from "react";
import { Robot, robotVariantForId, type RobotVariant } from "@/components/redesign/Robot";

/// Renders an agent's visual. If the owner has uploaded a skin, the image is
/// shown; otherwise falls back to the flat <Robot /> variant.

interface Props {
  agent: { id: number; nickname?: string | null; skin?: string | null };
  variant?: RobotVariant;
  size?: number;
  live?: boolean;
  className?: string;
  style?: CSSProperties;
  alt?: string;
}

export function AgentAvatar({ agent, variant, size = 64, live, className = "", style, alt }: Props) {
  if (agent.skin) {
    return (
      <img
        src={agent.skin}
        alt={alt ?? agent.nickname ?? `agent #${agent.id}`}
        className={`object-cover ${className}`}
        style={style}
        loading="lazy"
        decoding="async"
      />
    );
  }
  return (
    <Robot
      variant={variant ?? robotVariantForId(agent.id)}
      size={size}
      className={className}
      decorative={!alt}
      ariaLabel={alt ?? `agent #${agent.id}`}
    />
  );
}
