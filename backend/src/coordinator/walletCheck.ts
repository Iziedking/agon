import { parseAbi } from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";

import { publicClient } from "../chain/arc.js";
import { config } from "../config/index.js";

/// Production wallet-separation check. ArcRun's threat model relies on
/// distinct EOAs across four roles:
///
///   - coordinator (orchestrates contests, posts merkle roots)
///   - validator   (ERC-8004 giveFeedback; must NOT own agent NFTs)
///   - treasury    (receives listing fees + platform-fee skims)
///   - scout-master[0] (first hot wallet derived from the mnemonic)
///
/// Collisions across any pair are at minimum a centralization smell and
/// at worst a security failure (ERC-8004's no-self-feedback rule is the
/// hardest constraint: coordinator == validator gets calls rejected
/// on-chain).
///
/// In dev / local testnet, a collision is a warning so a one-keypair
/// setup still works. In prod, set STRICT_WALLET_SEPARATION=true to make
/// any collision a startup failure.

const escrowAbi = parseAbi(["function treasury() view returns (address)"]);

export interface WalletMap {
  coordinator: `0x${string}` | null;
  validator: `0x${string}` | null;
  treasury: `0x${string}` | null;
  scoutMaster0: `0x${string}` | null;
}

async function resolveAddresses(): Promise<WalletMap> {
  const out: WalletMap = {
    coordinator: null,
    validator: null,
    treasury: null,
    scoutMaster0: null,
  };
  if (config.coordinator.privateKey) {
    out.coordinator = privateKeyToAccount(config.coordinator.privateKey).address;
  }
  if (config.validator.privateKey) {
    out.validator = privateKeyToAccount(config.validator.privateKey).address;
  }
  if (config.scout.masterMnemonic) {
    try {
      out.scoutMaster0 = mnemonicToAccount(config.scout.masterMnemonic, { addressIndex: 0 }).address;
    } catch {
      // bad mnemonic; leave null
    }
  }
  try {
    out.treasury = (await publicClient.readContract({
      address: config.contracts.PrizeEscrow,
      abi: escrowAbi,
      functionName: "treasury",
    })) as `0x${string}`;
  } catch {
    // RPC blip or contract not yet deployed; skip the treasury cross-check.
  }
  return out;
}

interface Collision {
  a: string;
  b: string;
  address: string;
  severity: "blocker" | "warning";
}

function findCollisions(map: WalletMap): Collision[] {
  const out: Collision[] = [];
  const eq = (x: `0x${string}` | null, y: `0x${string}` | null) =>
    x !== null && y !== null && x.toLowerCase() === y.toLowerCase();

  // Coordinator == validator: HARD blocker. The validator's giveFeedback
  // call to ReputationRegistry reverts on-chain when the caller owns the
  // agent NFT (AgentRegistry owns them via the coordinator wallet).
  if (eq(map.coordinator, map.validator)) {
    out.push({
      a: "coordinator",
      b: "validator",
      address: map.coordinator!,
      severity: "blocker",
    });
  }
  // Coordinator == treasury: fees flow back into the orchestrating wallet
  // instead of a custody-isolated one. Mainly an ops smell (one compromised
  // key drains everything), not a protocol break, so warning by default.
  if (eq(map.coordinator, map.treasury)) {
    out.push({
      a: "coordinator",
      b: "treasury",
      address: map.coordinator!,
      severity: "warning",
    });
  }
  // Validator == treasury: the validator gains skim balance, which mixes
  // the "I attest" role with the "I'm paid" role. Warning.
  if (eq(map.validator, map.treasury)) {
    out.push({
      a: "validator",
      b: "treasury",
      address: map.validator!,
      severity: "warning",
    });
  }
  // Scout-master[0] == anything: the first hot wallet derived from the
  // mnemonic shouldn't be reused as a privileged role. Warning.
  if (eq(map.scoutMaster0, map.coordinator)) {
    out.push({
      a: "scout-master[0]",
      b: "coordinator",
      address: map.scoutMaster0!,
      severity: "warning",
    });
  }
  if (eq(map.scoutMaster0, map.validator)) {
    out.push({
      a: "scout-master[0]",
      b: "validator",
      address: map.scoutMaster0!,
      severity: "warning",
    });
  }
  if (eq(map.scoutMaster0, map.treasury)) {
    out.push({
      a: "scout-master[0]",
      b: "treasury",
      address: map.scoutMaster0!,
      severity: "warning",
    });
  }
  return out;
}

/// Log the role map + any collisions found. Returns true when the
/// startup should continue, false when STRICT_WALLET_SEPARATION=true
/// flagged a blocker. Callers should `process.exit(1)` on false.
export async function checkWalletSeparation(): Promise<boolean> {
  const strict = (process.env.STRICT_WALLET_SEPARATION ?? "").toLowerCase() === "true";
  const map = await resolveAddresses();

  // Print the role map so operators can eyeball it on startup. Missing
  // roles (null) read as "not configured".
  console.log("wallet roles:");
  console.log(`  coordinator:    ${map.coordinator ?? "(not set)"}`);
  console.log(`  validator:      ${map.validator ?? "(not set)"}`);
  console.log(`  treasury:       ${map.treasury ?? "(unread)"}`);
  console.log(`  scout-master 0: ${map.scoutMaster0 ?? "(not set)"}`);

  const collisions = findCollisions(map);
  if (collisions.length === 0) {
    return true;
  }

  let hasBlocker = false;
  for (const c of collisions) {
    const line = `${c.severity.toUpperCase()}: ${c.a} and ${c.b} share address ${c.address}`;
    if (c.severity === "blocker") {
      console.error(line);
      hasBlocker = true;
    } else {
      console.warn(line);
    }
  }

  if (hasBlocker || strict) {
    if (strict) {
      console.error(
        "STRICT_WALLET_SEPARATION=true and at least one role collision was found; refusing to start.",
      );
      return false;
    }
    if (hasBlocker) {
      console.error(
        "A blocker collision was found (e.g. coordinator == validator violates ERC-8004 no-self-feedback). Set distinct keys or expect on-chain reverts.",
      );
      // Blocker without strict mode: keep running but make it loud. ERC-8004
      // calls will revert; the rest of the platform still works.
    }
  }
  return true;
}
