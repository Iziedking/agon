export type AgonSignerRoute =
  | "browser_wallet"
  | "circle_developer_controlled"
  | "circle_user_controlled"
  | "unavailable";

export type AgonSignerSelection = {
  address: `0x${string}` | undefined;
  route: AgonSignerRoute;
};

function address(value: string | null | undefined): `0x${string}` | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^0x[0-9a-f]{40}$/.test(normalized)
    ? normalized as `0x${string}`
    : undefined;
}

export function selectAgonSigner(input: {
  walletKind: "circle" | "wagmi" | undefined;
  sessionAddress: string | null | undefined;
  connectedAddress: string | null | undefined;
  activeCircleUserControlledAddress: string | null | undefined;
  linkedPrincipalAddresses: readonly string[];
}): AgonSignerSelection {
  const sessionAddress = address(input.sessionAddress);
  const connectedAddress = address(input.connectedAddress);
  const activeCircleAddress = address(input.activeCircleUserControlledAddress);
  const linked = new Set(input.linkedPrincipalAddresses.map((value) => address(value)).filter(Boolean));

  if (activeCircleAddress && linked.has(activeCircleAddress)) {
    return { address: activeCircleAddress, route: "circle_user_controlled" };
  }
  if (input.walletKind === "circle" && sessionAddress) {
    return { address: sessionAddress, route: "circle_developer_controlled" };
  }
  if (input.walletKind === "wagmi" && connectedAddress) {
    return { address: connectedAddress, route: "browser_wallet" };
  }
  return { address: undefined, route: "unavailable" };
}
