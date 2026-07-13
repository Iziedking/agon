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
import { listSpecialistsForFragment } from "./specialists.js";
import { fragmentCeiling6, negotiate, type A2AStep } from "./negotiate.js";

const USDC_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);

/// USDC is the gas token on Arc, so the buyer must keep a little back to pay for
/// the transfer itself or it reverts with "transfer amount exceeds balance".
const GAS_RESERVE6 = BigInt(Math.round(Number(process.env.MISSION_GAS_RESERVE_USDC ?? "0.05") * 1e6));

export type { A2AStep } from "./negotiate.js";

export interface BuyIntelResult {
  ok: boolean;
  /// Set when ok is false.
  reason?: string;
  sellerAgentId?: number;
  /// The price actually PAID, USDC 6-decimals as a string. After a negotiation this
  /// is the agreed price, which may be below what the seller first asked.
  price6?: string;
  /// What the seller originally asked, USDC 6-decimals. Equal to price6 when the
  /// ask was firm (an operator listing) or nothing was conceded.
  quoted6?: string;
  /// How many offer/counter exchanges it took. 0 means a firm ask taken as listed.
  rounds?: number;
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
  /// Drives how hard this operative bargains. A higher tier opens lower and concedes
  /// slower, so it lands a better price out of the same market.
  buyerTier?: number;
  /// Fragments this operative still has to source, including this one. The buyer's
  /// ceiling for THIS piece is its float shared over them, so an early fragment
  /// cannot eat the budget for the rest. Defaults to 1 (spend up to the whole float).
  fragmentsLeft?: number;
}): Promise<BuyIntelResult> {
  const { missionId, fragmentId, buyerAgentId } = opts;

  const sellers = (await listSpecialistsForFragment(missionId, fragmentId)).filter(
    (s) => s.agentId !== buyerAgentId, // an operative cannot buy from itself
  );
  if (sellers.length === 0) {
    return {
      ok: false,
      reason: "no specialist holds this fragment",
      transcript: [{ step: "request", detail: `agent ${buyerAgentId} requests ${fragmentId}` }],
    };
  }

  // USDC is the gas token on Arc, so the buyer must keep enough back to pay for the
  // transfer itself. Everything above that reserve is what it can actually bargain with.
  const buyer = deriveHotWallet(buyerAgentId);
  const balance = await publicClient.readContract({
    address: config.external.USDC,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [buyer.address],
  });
  const spendable6 = balance > GAS_RESERVE6 ? balance - GAS_RESERVE6 : 0n;

  // The buyer's ceiling for THIS fragment. It is not the whole float: the pieces it
  // has not sourced yet also cost money, and blowing the budget on the first one is
  // how an operative ends up with a half-built deliverable.
  const ceiling6 = fragmentCeiling6(spendable6, opts.fragmentsLeft ?? 1);

  // Haggle. The buyer bargains across the sellers holding this fragment and takes the
  // best deal it can reach; a seller that will not move can lose the sale to one that
  // will. Operator listings are firm and are taken or walked, never negotiated down.
  const deal = negotiate({
    sellers,
    buyerAgentId,
    buyerTier: opts.buyerTier ?? 0,
    ceiling6,
  });

  if (!deal) {
    const cheapest = sellers.reduce((a, b) => (BigInt(a.price6) <= BigInt(b.price6) ? a : b));
    const transcript: A2AStep[] = [
      { step: "request", detail: `agent ${buyerAgentId} requests ${fragmentId}` },
      {
        step: "walk",
        detail:
          `no deal: cheapest ask ${fmtUsdc(BigInt(cheapest.price6))} USDC, ` +
          `buyer ceiling ${fmtUsdc(ceiling6)} (wallet holds ${fmtUsdc(balance)})`,
      },
    ];
    // Record the DECLINE. This used to return with no row at all, so a buy that never
    // happened was invisible: the operative chose BUY, paid nothing, scored zero, and
    // a2a_trades had nothing in it to say why. Two whole missions looked like the buy
    // path had never even run. An attempt that fails is exactly the thing you need on
    // the record.
    await query(
      `insert into a2a_trades (contest_id, buyer_agent_id, seller_agent_id, fragment_id, price_usdc_6, quoted_usdc_6, rounds, transcript, status)
       values ($1, $2, $3, $4, '0', $5, 0, $6, 'declined')`,
      [missionId, buyerAgentId, cheapest.agentId, fragmentId, cheapest.price6, JSON.stringify(transcript)],
    ).catch(() => {});
    console.warn(
      `[mission ${missionId}] agent ${buyerAgentId} could NOT buy ${fragmentId}: cheapest ask ` +
        `${fmtUsdc(BigInt(cheapest.price6))} USDC, wallet holds ${fmtUsdc(balance)}. ` +
        `The operative float is too small for the intel price band (raise MISSION_FUND_MAX_USDC / the float).`,
    );
    return {
      ok: false,
      reason: "no seller came within the buyer's budget",
      sellerAgentId: cheapest.agentId,
      price6: cheapest.price6,
      transcript,
    };
  }

  const specialist = deal.seller;
  const price6 = deal.agreed6;
  const transcript = deal.transcript;

  // A deal it cannot actually pay for is not a deal. Guard the settlement.
  if (price6 + GAS_RESERVE6 > balance) {
    transcript.push({ step: "walk", detail: "declined: operative underfunded at the agreed price" });
    return { ok: false, reason: "buyer underfunded", sellerAgentId: specialist.agentId, price6: price6.toString(), transcript };
  }

  // Record the intent BEFORE paying so a crash leaves an auditable row. The trade
  // stores BOTH the ask and the agreed price, so the bargain is provable after the
  // fact and not just a line in a transcript.
  const { rows } = await query<{ id: string }>(
    `insert into a2a_trades (contest_id, buyer_agent_id, seller_agent_id, fragment_id, price_usdc_6, quoted_usdc_6, rounds, transcript, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
     returning id`,
    [
      missionId,
      buyerAgentId,
      specialist.agentId,
      fragmentId,
      price6.toString(),
      deal.quoted6.toString(),
      deal.rounds,
      JSON.stringify(transcript),
    ],
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
        price6: price6.toString(),
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
      price6: price6.toString(),
      transcript,
    };
  }

  await query(`update a2a_trades set status = 'settled', tx_hash = $2 where id = $1`, [tradeId, txHash]);
  const saved6 = deal.quoted6 - price6;
  transcript.push({
    step: "pay",
    detail:
      saved6 > 0n
        ? `paid ${fmtUsdc(price6)} USDC (saved ${fmtUsdc(saved6)} off the ask), tx ${txHash}`
        : `paid ${fmtUsdc(price6)} USDC, tx ${txHash}`,
  });

  // The specialist delivers its intel only now that payment has confirmed.
  return {
    ok: true,
    sellerAgentId: specialist.agentId,
    price6: price6.toString(),
    quoted6: deal.quoted6.toString(),
    rounds: deal.rounds,
    txHash,
    intel: specialist.intel,
    transcript,
  };
}

function fmtUsdc(v6: bigint): string {
  return (Number(v6) / 1e6).toFixed(4);
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
