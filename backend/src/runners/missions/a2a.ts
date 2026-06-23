/// The agent-to-agent intel rail: the bounded handshake an operative runs when it
/// decides to BUY a fragment instead of MAKE it. The operative requests the
/// fragment, the platform specialist that holds it offers a price, the operative
/// accepts and PAYS with a real USDC transfer between two hot wallets. The
/// transfer tx is the on-chain A2A settlement proof; the specialist then delivers
/// its intel. Both wallets are coordinator-signed hot wallets, so the whole
/// handshake is automatic and shown live with no human signing. This is the
/// "negotiate" pillar and the Lepton agent-to-agent scoring lever.

import { createWalletClient, http, parseAbi } from "viem";
import type { Hash } from "viem";

import { arcTestnet, publicClient } from "../../chain/arc.js";
import { config } from "../../config/index.js";
import { query } from "../../db/pool.js";
import { deriveHotWallet } from "../scout.js";
import { getSpecialistForFragment } from "./specialists.js";

const USDC_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);

/// USDC is the gas token on Arc, so the buyer must keep a little back to pay for
/// the transfer itself or it reverts with "transfer amount exceeds balance".
const GAS_RESERVE6 = BigInt(Math.round(Number(process.env.MISSION_GAS_RESERVE_USDC ?? "0.05") * 1e6));

/// One line of the handshake transcript, surfaced on the live stage so viewers
/// watch the negotiation happen.
export interface A2AStep {
  step: "request" | "offer" | "accept" | "pay";
  detail: string;
}

export interface BuyIntelResult {
  ok: boolean;
  /// Set when ok is false.
  reason?: string;
  sellerAgentId?: number;
  /// Quoted price, USDC 6-decimals as a string.
  price6?: string;
  /// The on-chain USDC transfer that settled the buy.
  txHash?: string;
  /// The intel the specialist delivered on a successful, paid buy.
  intel?: unknown;
  transcript: A2AStep[];
}

/// Runs the full bounded handshake for one fragment. Records the trade in
/// `a2a_trades` (pending -> settled | failed) so the buy is auditable even if the
/// process dies mid-pay, and returns the specialist's intel only after the
/// payment confirms on-chain.
export async function buyIntel(opts: {
  missionId: number;
  fragmentId: string;
  buyerAgentId: number;
}): Promise<BuyIntelResult> {
  const { missionId, fragmentId, buyerAgentId } = opts;
  const transcript: A2AStep[] = [];

  // request
  transcript.push({ step: "request", detail: `agent ${buyerAgentId} requests ${fragmentId}` });
  const specialist = await getSpecialistForFragment(missionId, fragmentId);
  if (!specialist) {
    return { ok: false, reason: "no specialist holds this fragment", transcript };
  }
  if (specialist.agentId === buyerAgentId) {
    return { ok: false, reason: "operative cannot buy from itself", transcript };
  }

  // offer
  const price6 = BigInt(specialist.price6);
  transcript.push({
    step: "offer",
    detail: `specialist ${specialist.agentId} offers ${fragmentId} for ${specialist.price6}`,
  });

  // The buyer needs the price plus a gas reserve (USDC is gas on Arc).
  const buyer = deriveHotWallet(buyerAgentId);
  const balance = await publicClient.readContract({
    address: config.external.USDC,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [buyer.address],
  });
  if (balance < price6 + GAS_RESERVE6) {
    transcript.push({ step: "accept", detail: "declined: operative underfunded" });
    return {
      ok: false,
      reason: "buyer underfunded",
      sellerAgentId: specialist.agentId,
      price6: specialist.price6,
      transcript,
    };
  }

  // accept: record the intent BEFORE paying so a crash leaves an auditable row.
  transcript.push({ step: "accept", detail: `agent ${buyerAgentId} accepts` });
  const { rows } = await query<{ id: string }>(
    `insert into a2a_trades (contest_id, buyer_agent_id, seller_agent_id, fragment_id, price_usdc_6, status)
     values ($1, $2, $3, $4, $5, 'pending')
     returning id`,
    [missionId, buyerAgentId, specialist.agentId, fragmentId, specialist.price6],
  );
  const tradeId = rows[0]!.id;

  // pay: a real USDC transfer from the operative's hot wallet to the specialist.
  let txHash: Hash;
  try {
    const wallet = createWalletClient({ account: buyer, chain: arcTestnet, transport: http(config.rpcHttp) });
    txHash = await wallet.writeContract({
      address: config.external.USDC,
      abi: USDC_ABI,
      functionName: "transfer",
      args: [specialist.address, price6],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      await query(`update a2a_trades set status = 'failed' where id = $1`, [tradeId]);
      return {
        ok: false,
        reason: "payment reverted on-chain",
        sellerAgentId: specialist.agentId,
        price6: specialist.price6,
        txHash,
        transcript,
      };
    }
  } catch (err) {
    await query(`update a2a_trades set status = 'failed' where id = $1`, [tradeId]);
    return {
      ok: false,
      reason: `payment failed: ${err instanceof Error ? err.message : String(err)}`,
      sellerAgentId: specialist.agentId,
      price6: specialist.price6,
      transcript,
    };
  }

  await query(`update a2a_trades set status = 'settled', tx_hash = $2 where id = $1`, [tradeId, txHash]);
  transcript.push({ step: "pay", detail: `paid ${specialist.price6} USDC, tx ${txHash}` });

  // The specialist delivers its intel only now that payment has confirmed.
  return {
    ok: true,
    sellerAgentId: specialist.agentId,
    price6: specialist.price6,
    txHash,
    intel: specialist.intel,
    transcript,
  };
}

/// The settled A2A purchase a buyer made for a fragment, if any. The grader's
/// credit-requires-payment gate uses this to confirm a BUY claim is backed by a
/// real on-chain trade.
export async function settledTradeTx(
  missionId: number,
  buyerAgentId: number,
  fragmentId: string,
): Promise<string | null> {
  const { rows } = await query<{ tx_hash: string | null }>(
    `select tx_hash
       from a2a_trades
      where contest_id = $1 and buyer_agent_id = $2 and fragment_id = $3 and status = 'settled'
      order by id desc
      limit 1`,
    [missionId, buyerAgentId, fragmentId],
  );
  return rows[0]?.tx_hash ?? null;
}
