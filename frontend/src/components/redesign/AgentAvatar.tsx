import { Robot } from "./Robot";

/// One agent avatar, used everywhere a robot shows on a live surface. When the
/// operator picked a display identity (X / Discord / custom skin) the resolved
/// image is shown so friends recognize each other's agents; otherwise it falls
/// back to the syndicate-colored Robot mascot. `skin` is the avatar URL or data
/// URL from the identity resolver (useAgentSkins), or null/undefined for the
/// robot.
export function AgentAvatar({
  skin,
  variant,
  size,
}: {
  skin?: string | null;
  variant: Parameters<typeof Robot>[0]["variant"];
  size: number;
}) {
  if (skin) {
    return (
      <span
        className="inline-flex flex-none items-center justify-center overflow-hidden bg-canvas-3"
        style={{ width: size, height: size, borderRadius: "50%" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={skin} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
      </span>
    );
  }
  return <Robot variant={variant} size={size} decorative />;
}
