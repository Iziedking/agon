import { arcTestnet } from "./arc";

/// Circle Modular Wallets (email + passkey) login. Creates a passkey-backed
/// smart account whose signature our SIWE backend verifies via EIP-1271/6492.
/// The SDK is imported dynamically so it stays out of the initial bundle and is
/// only evaluated in the browser, where the WebAuthn ceremony runs.

const CLIENT_KEY = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY ?? "";
const CLIENT_URL = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_URL ?? "https://modular-sdk.circle.com/v1/rpc/w3s/buidl";

export function circleConfigured(): boolean {
  return CLIENT_KEY.length > 0;
}

export interface CircleAccount {
  address: `0x${string}`;
  signMessage: (args: { message: string }) => Promise<`0x${string}`>;
}

/// Register a new passkey or log in with an existing one for `username` (an
/// email), then build the Circle smart account on Arc. Browser-only: needs a
/// user gesture, a secure context, and this origin registered as an Allowed
/// Domain in the Circle Console.
export async function createCircleAccount(
  username: string,
  mode: "Register" | "Login",
): Promise<CircleAccount> {
  if (!CLIENT_KEY) throw new Error("Circle client key is not set (NEXT_PUBLIC_CIRCLE_CLIENT_KEY)");

  const { toPasskeyTransport, toWebAuthnCredential, toModularTransport, toCircleSmartAccount, WebAuthnMode } =
    await import("@circle-fin/modular-wallets-core");
  const { toWebAuthnAccount } = await import("viem/account-abstraction");
  const { createPublicClient } = await import("viem");

  const passkeyTransport = toPasskeyTransport(CLIENT_URL, CLIENT_KEY);
  const credential = await toWebAuthnCredential({
    transport: passkeyTransport,
    mode: mode === "Register" ? WebAuthnMode.Register : WebAuthnMode.Login,
    username,
  });

  const modularTransport = toModularTransport(`${CLIENT_URL}/arcTestnet`, CLIENT_KEY);
  const client = createPublicClient({ chain: arcTestnet, transport: modularTransport });
  const account = await toCircleSmartAccount({ client, owner: toWebAuthnAccount({ credential }) });

  return account as unknown as CircleAccount;
}
