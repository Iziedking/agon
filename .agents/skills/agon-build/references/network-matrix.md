# Agon network matrix

This is the public network contract. Chain ids are the user-approved product
direction and the current repository source where stated. Verify RPC URLs,
explorer URLs, token contracts, registry deployments, and payment behavior from
current primary documentation and deployed receipts before enabling writes.

## Product contexts

| Context | Chain id | Role | Status in current source |
| --- | ---: | --- | --- |
| BNB Mainnet | 56 | Default Agon Market context | Planned adapter; do not imply live Agon contracts |
| BNB Testnet | 97 | Safe BNB development and demo context | Planned adapter; do not imply live Agon contracts |
| Arc Testnet | 5042002 | Next major Agon chain and current deployed foundation | Current Arc-oriented implementation |

The UI may show `Mainnet | Testnet`, but the state must resolve to one of the
three typed contexts. Testnet selection must offer `BNB Testnet` and `Arc
Testnet`. There is no implied Arc Mainnet context in this product contract.

## Arc Testnet facts from the repository

`frontend/src/lib/arc.ts` currently provides the Arc Testnet client and these
public addresses:

- ERC-8004 IdentityRegistry:
  `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- Native USDC:
  `0x3600000000000000000000000000000000000000`
- Agon ProfileRegistry:
  `0xE0c7A2545C2f4eE6d2bD797B6f2742c73E640574`
- Agon ServiceRegistry:
  `0x2144C156B0a4581da2D046C2E41AC41C6C3938CB`
- Current Agon JobEscrow, Arena, SyndicateRegistry, and PrizeVault addresses
  are also present in `frontend/src/lib/arc.ts`; use the canonical deployment
  receipt before treating any one as active for a new flow.

The existing public explorer is `https://testnet.arcscan.app`. The current
source uses an optional `NEXT_PUBLIC_ARC_RPC_HTTP` fallback chain and viem
batching because the public Arc RPC can rate-limit bursts.

## BNB facts that still require implementation verification

The BNB context must not reuse Arc constants. Before coding BNB reads or
writes, verify and record:

- the exact RPC and explorer for BNB Mainnet and BNB Testnet;
- native BNB gas behavior and token decimals for every payment asset;
- the ERC-8004 registry deployment used by the target network;
- Agon contract deployments, bytecode, ABI, and role configuration on each
  BNB context;
- wallet connector and chain-switch behavior;
- x402 or other payment facilitator network support;
- 8004scan discovery limits and provenance behavior;
- finality and read-after-write timing;
- exact transaction and receipt link formats.

Do not infer any of these from Arc or from a generic EVM assumption.

## Required adapter shape

The implementation should converge on a typed descriptor similar to:

```ts
type AgonNetworkContext = {
  key: "bnb-mainnet" | "bnb-testnet" | "arc-testnet";
  family: "bnb" | "arc";
  environment: "mainnet" | "testnet";
  chainId: number;
  nativeGasSymbol: string;
  rpcUrls: readonly string[];
  explorerUrl: string;
  identityRegistry: `0x${string}` | null;
  profileRegistry: `0x${string}` | null;
  serviceRegistry: `0x${string}` | null;
  capabilities: {
    discovery: "live" | "fixture" | "unavailable";
    listingWrites: "live" | "prepared" | "unavailable";
    payments: "live" | "sandbox" | "unavailable";
    playground: "live" | "fixture" | "unavailable";
  };
};
```

The exact type may change, but the separation must remain. A context with null
contracts cannot expose a write CTA.
