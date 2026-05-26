import { AgentMascot } from "@/components/pengu/AgentMascot";
import { operatorColor } from "@/lib/profiles";

/// A round avatar for an operator: their address-derived mascot in a white disc.
/// The color is deterministic, so one operator is recognizable everywhere they
/// appear (leaderboard, results boards, their own profile). Size via className.
export function OperatorAvatar({ address, className = "h-8 w-8" }: { address: string; className?: string }) {
  return (
    <span
      className={`flex flex-none items-center justify-center overflow-hidden rounded-full border border-pengu-blue/15 bg-pengu-card ${className}`}
    >
      <AgentMascot color={operatorColor(address)} className="h-[68%] w-auto" />
    </span>
  );
}
