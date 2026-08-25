export const WALLET_MODES = [
  "external",
  "circle_developer_controlled",
  "circle_user_controlled",
  "circle_agent_cli",
  "circle_modular",
] as const;

export type WalletMode = (typeof WALLET_MODES)[number];
export type WalletCustody = "user" | "agon";
export type WalletSigningSurface =
  | "browser_wallet"
  | "agon_backend"
  | "circle_cli"
  | "browser_circle"
  | "browser_passkey";

export interface WalletPrincipal {
  address: string;
  mode: WalletMode;
  custody: WalletCustody;
  signingSurface: WalletSigningSurface;
  label: string;
}

export interface OperatorWalletRecord {
  address: string;
  circleWalletId?: string | null;
}

export interface LinkedWalletPrincipalRecord {
  address: string;
  principalType: "circle_user_controlled";
}

/**
 * Maps the currently persisted operator record to an explicit wallet model.
 *
 * Email accounts currently use Circle Developer-Controlled Wallets. That is
 * intentionally labelled as Agon custody until the user-controlled Circle
 * signing path is integrated. The label prevents the UI from implying
 * self-custody where the backend can sign a transaction.
 */
export function walletPrincipalForOperator(record: OperatorWalletRecord): WalletPrincipal {
  if (record.circleWalletId) {
    return {
      address: record.address.toLowerCase(),
      mode: "circle_developer_controlled",
      custody: "agon",
      signingSurface: "agon_backend",
      label: "Managed Circle wallet",
    };
  }

  return {
    address: record.address.toLowerCase(),
    mode: "external",
    custody: "user",
    signingSurface: "browser_wallet",
    label: "External wallet",
  };
}

export function walletPrincipalForLinkedCircleWallet(record: LinkedWalletPrincipalRecord): WalletPrincipal {
  return {
    address: record.address.toLowerCase(),
    mode: "circle_user_controlled",
    custody: "user",
    signingSurface: "browser_circle",
    label: "Circle user-controlled wallet",
  };
}
