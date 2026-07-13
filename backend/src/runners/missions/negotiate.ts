/// The NEGOTIATE pillar: agents haggling over the price of intel before they pay.
///
/// The A2A rail already had `request -> offer -> accept -> pay`, but the price was
/// take-it-or-leave-it. The buyer had no voice, so nothing was actually being
/// negotiated: the "negotiate" pillar was a label on a purchase. This adds the
/// missing middle, a real bounded bargain:
///
///     request -> offer -> counter -> (counter | accept | walk) -> pay
///
/// No contract change is needed. The price is agreed OFF-chain and settled by the
/// same USDC transfer that already existed; the chain records what was paid, and
/// the transcript records how the two agents got there.
///
/// WHO MAY BE HAGGLED
/// A platform specialist is a house market-maker: it holds a reserve price and
/// trades down toward it to win a sale. An OPERATOR specialist is a real user who
/// listed intel at a price they chose, so their ask is FIRM. We do not bargain a
/// human's listing down without their consent; that is their money. The market
/// pressure on an overpriced operator is that the buyer can WALK and bargain with
/// the house instead, and lose them the sale.

import type { Specialist } from "./types.js";

/// Kill switch. Off makes every ask firm, which is the old take-it-or-leave-it
/// behaviour: buyers pay the shelf price and nothing is bargained.
const NEGOTIATION_ENABLED = (process.env.MISSION_NEGOTIATION_ENABLED ?? "1") !== "0";

/// One line of the handshake transcript. Surfaced on the live stage so viewers
/// watch the bargain happen rather than just seeing a number get paid.
export interface A2AStep {
  step: "request" | "offer" | "counter" | "accept" | "walk" | "pay";
  detail: string;
}

/// How many offer/counter exchanges one bargain may run before the buyer takes the
/// best price on the table or walks. Bounded so a mission cannot stall in a haggle.
const MAX_ROUNDS = Math.max(1, Number(process.env.MISSION_NEGOTIATION_ROUNDS ?? "3"));

/// How many sellers a buyer will bargain with for one fragment. More than one is
/// what gives the buyer leverage: a seller that will not move loses to one that will.
const MAX_SELLERS = Math.max(1, Number(process.env.MISSION_NEGOTIATION_SELLERS ?? "2"));

/// A platform seller's floor, as a fraction of its ask. It will trade down to here
/// to win the sale and refuse below it. Not zero: the house is a market-maker, not
/// a charity, and a seller that always caves teaches buyers nothing.
const SELLER_RESERVE_FRAC = Math.min(1, Math.max(0, Number(process.env.MISSION_SELLER_RESERVE_FRAC ?? "0.6")));

/// Negotiation is a SKILL. A higher-tier operative opens lower and concedes slower,
/// so it lands a better price out of the same market. This is the lever that makes
/// the pillar part of the game instead of a cosmetic exchange: two agents facing an
/// identical shelf walk away having paid different amounts, and the cheaper buyer
/// keeps more float for the fragments it still has to source.
function negotiationSkill(tier: number): number {
  return Math.min(1, Math.max(0, tier / 4));
}

interface Bargain {
  seller: Specialist;
  /// What the seller originally asked, USDC 6-dec.
  quoted6: bigint;
  /// What the two agents settled on, USDC 6-dec. Equals quoted6 for a firm ask.
  agreed6: bigint;
  rounds: number;
  transcript: A2AStep[];
}

/// Bargain with ONE seller. Returns the price the two of them reached, or null when
/// the buyer walks (the seller would not come within the buyer's ceiling).
function bargainWith(
  seller: Specialist,
  buyerAgentId: number,
  buyerTier: number,
  /// The most this buyer will pay for this fragment. Above it, walking is correct:
  /// the float is finite and the fragments it has not sourced yet also cost money.
  ceiling6: bigint,
): Bargain | null {
  const transcript: A2AStep[] = [];
  const ask6 = BigInt(seller.price6);

  // An operator's listing is firm. Take it or leave it; do not haggle a user. With
  // the kill switch off, EVERY ask is firm and we are back to shelf pricing.
  if (seller.owner === "operator" || !NEGOTIATION_ENABLED) {
    const who = seller.owner === "operator" ? "operator agent" : "specialist";
    transcript.push({
      step: "offer",
      detail: `${who} ${seller.agentId} lists ${seller.fragmentId} at ${fmt(ask6)} USDC (firm)`,
    });
    if (ask6 > ceiling6) {
      transcript.push({
        step: "walk",
        detail: `agent ${buyerAgentId} walks: ${fmt(ask6)} is over its ${fmt(ceiling6)} ceiling`,
      });
      return null;
    }
    transcript.push({ step: "accept", detail: `agent ${buyerAgentId} accepts the listed price` });
    return { seller, quoted6: ask6, agreed6: ask6, rounds: 0, transcript };
  }

  // Platform seller: a real bargain.
  const skill = negotiationSkill(buyerTier);
  const reserve6 = (ask6 * BigInt(Math.round(SELLER_RESERVE_FRAC * 1000))) / 1000n;

  transcript.push({
    step: "offer",
    detail: `specialist ${seller.agentId} offers ${seller.fragmentId} for ${fmt(ask6)} USDC`,
  });

  // The buyer opens below the ask. A better negotiator opens lower (tier 0 opens at
  // 75% of the ask, tier 4 at 50%), which anchors the whole exchange in its favour.
  const openFrac = 0.75 - 0.25 * skill;
  let buyerBid6 = big(ask6, openFrac);
  let sellerAsk6 = ask6;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    if (buyerBid6 > ceiling6) buyerBid6 = ceiling6;
    transcript.push({
      step: "counter",
      detail: `agent ${buyerAgentId} counters ${fmt(buyerBid6)} USDC`,
    });

    // The seller takes any bid at or above its reserve. It is a market-maker: a sale
    // at the floor beats no sale.
    if (buyerBid6 >= reserve6) {
      transcript.push({
        step: "accept",
        detail: `specialist ${seller.agentId} accepts ${fmt(buyerBid6)} USDC (asked ${fmt(ask6)})`,
      });
      return { seller, quoted6: ask6, agreed6: buyerBid6, rounds: round, transcript };
    }

    // Below the floor. Out of rounds means the deal dies at the buyer's ceiling: if
    // the buyer can afford the reserve, it pays it rather than lose the intel.
    if (round === MAX_ROUNDS) {
      if (reserve6 <= ceiling6) {
        transcript.push({
          step: "accept",
          detail: `agent ${buyerAgentId} takes the specialist's floor, ${fmt(reserve6)} USDC`,
        });
        return { seller, quoted6: ask6, agreed6: reserve6, rounds: round, transcript };
      }
      transcript.push({
        step: "walk",
        detail: `agent ${buyerAgentId} walks: floor ${fmt(reserve6)} is over its ${fmt(ceiling6)} ceiling`,
      });
      return null;
    }

    // The seller concedes toward the buyer, and the buyer concedes toward the seller.
    // A skilled buyer moves LESS per round, so the midpoint drifts its way.
    sellerAsk6 = mid(sellerAsk6, buyerBid6, 0.5);
    if (sellerAsk6 < reserve6) sellerAsk6 = reserve6;
    transcript.push({
      step: "offer",
      detail: `specialist ${seller.agentId} comes back at ${fmt(sellerAsk6)} USDC`,
    });

    // Buyer takes the seller's counter outright when it is already within its ceiling
    // and it has stopped improving materially.
    if (sellerAsk6 <= ceiling6 && sellerAsk6 <= buyerBid6) {
      transcript.push({ step: "accept", detail: `agent ${buyerAgentId} accepts ${fmt(sellerAsk6)} USDC` });
      return { seller, quoted6: ask6, agreed6: sellerAsk6, rounds: round, transcript };
    }
    const concession = 0.5 - 0.25 * skill; // tier 4 gives up a quarter, tier 0 gives up half
    buyerBid6 = mid(buyerBid6, sellerAsk6, concession);
  }

  return null;
}

/// Bargain across the sellers who hold this fragment and return the BEST deal the
/// buyer could reach, or null when every seller was out of reach. This is where the
/// buyer's leverage comes from: a seller holding out for its ask can simply lose to
/// one that moves.
export function negotiate(opts: {
  sellers: Specialist[];
  buyerAgentId: number;
  buyerTier: number;
  /// The most this buyer will pay for this one fragment (its float, shared out over
  /// the fragments it still has to source). Walking is a real outcome.
  ceiling6: bigint;
}): Bargain | null {
  const { sellers, buyerAgentId, buyerTier, ceiling6 } = opts;
  const transcript: A2AStep[] = [
    { step: "request", detail: `agent ${buyerAgentId} requests ${sellers[0]?.fragmentId ?? "intel"}` },
  ];

  let best: Bargain | null = null;
  for (const seller of sellers.slice(0, MAX_SELLERS)) {
    const deal = bargainWith(seller, buyerAgentId, buyerTier, ceiling6);
    transcript.push(...(deal?.transcript ?? []));
    if (deal && (!best || deal.agreed6 < best.agreed6)) best = deal;
  }

  if (!best) return null;

  // Say what the bargaining was worth, so the saving is visible rather than implied.
  const saved6 = best.quoted6 - best.agreed6;
  if (saved6 > 0n) {
    transcript.push({
      step: "accept",
      detail: `deal: ${fmt(best.agreed6)} USDC with agent ${best.seller.agentId}, ${fmt(saved6)} under the ${fmt(best.quoted6)} ask`,
    });
  }
  return { ...best, transcript };
}

/// Multiply a 6-dec USDC amount by a fraction without losing precision to floats.
function big(v: bigint, frac: number): bigint {
  return (v * BigInt(Math.round(frac * 10_000))) / 10_000n;
}

/// Move `from` toward `to` by `frac` of the gap.
function mid(from: bigint, to: bigint, frac: number): bigint {
  const gap = to - from;
  return from + (gap * BigInt(Math.round(frac * 10_000))) / 10_000n;
}

function fmt(v6: bigint): string {
  return (Number(v6) / 1e6).toFixed(4);
}

/// The buyer's ceiling for ONE fragment: its spendable float shared over the
/// fragments it still has to source, with a little headroom so an early fragment
/// cannot eat the budget for the rest. Exported so the runner and the float sizer
/// agree on the same number.
export function fragmentCeiling6(spendable6: bigint, fragmentsLeft: number): bigint {
  const n = BigInt(Math.max(1, fragmentsLeft));
  // 1.5x the even share: a buyer may pay above the average for one piece, but not
  // so far above that it cannot afford the rest.
  const share = (spendable6 * 3n) / (n * 2n);
  // Never above what the wallet actually holds. With one fragment left the 1.5x
  // share EXCEEDS the float, so the buyer would shake hands on a price it cannot
  // pay: the settlement guard then rejects it as underfunded and the operative
  // loses the intel it just successfully bargained for. Cap it.
  return share < spendable6 ? share : spendable6;
}

export const negotiationConfig = {
  maxRounds: MAX_ROUNDS,
  maxSellers: MAX_SELLERS,
  sellerReserveFrac: SELLER_RESERVE_FRAC,
  enabled: NEGOTIATION_ENABLED,
};
