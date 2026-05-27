import { AgentMascot } from "@/components/pengu/AgentMascot";

/// A built-from-shapes workshop that gains gear as the agent's highest tier
/// rises. A clean placeholder until commissioned art lands (per the plan).
function Screen({ h, label }: { h: string; label?: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className={`w-16 rounded-lg border-2 border-pengu-blue/40 bg-pengu-blue/10 ${h}`} />
      <div className="mt-1 h-2 w-8 rounded-b bg-pengu-blue/20" />
      {label ? <div className="mt-1 font-display text-[10px] uppercase tracking-wide text-pengu-dark/40">{label}</div> : null}
    </div>
  );
}

export function WorkshopScene({ level }: { level: number }) {
  return (
    <div className="relative overflow-hidden rounded-card border border-pengu-blue/15 bg-pengu-card p-8 shadow-[0_10px_30px_rgba(70,45,150,0.08)]">
      {level >= 4 ? <div className="arena-grid absolute inset-0 opacity-40" aria-hidden /> : null}
      <div className="relative flex flex-wrap items-end justify-center gap-6 sm:gap-10">
        <div className="flex items-end gap-3">
          <Screen h="h-12" label="laptop" />
          {level >= 1 ? <Screen h="h-16" label="monitor" /> : null}
          {level >= 2 ? <Screen h="h-24" label="rig" /> : null}
          {level >= 3 ? <Screen h="h-28" label="cluster" /> : null}
        </div>

        <AgentMascot color="#7c4dff" live={level >= 1} className={`h-32 w-auto ${level >= 3 ? "drift" : ""}`} />

        {level >= 2 ? (
          <div className="flex flex-col gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-3 w-12 rounded bg-pengu-blue/25" />
            ))}
            <div className="mt-1 font-display text-[10px] uppercase tracking-wide text-pengu-dark/40">server</div>
          </div>
        ) : null}

        {level >= 4 ? (
          <div className="flex flex-col items-center gap-1.5">
            <div className="h-10 w-10 rounded-full border-2 border-pengu-blue/60 bg-pengu-blue/15 glow-pulse" style={{ color: "#7c4dff" }} />
            <div className="font-display text-[10px] uppercase tracking-wide text-pengu-blue">core</div>
          </div>
        ) : null}
      </div>

      <div className="relative mt-6 text-center font-display text-xs uppercase tracking-wide text-pengu-dark/50">
        your workshop · tier {level}{level >= 4 ? " · maxed" : ""}
      </div>
    </div>
  );
}
