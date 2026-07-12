/// An x402 seller that ArcRun runs ITSELF, on Arc, gated by Circle Gateway.
///
/// Why this exists. Every third-party x402 seller we integrated settles on a chain
/// other than Arc (Exa and Gloria on Base mainnet with the exact scheme). That is
/// fine for buying research, but it means Circle's batched-settlement rail never
/// touched the chain the product is actually built on, even though Arc Testnet is
/// one of the chains Nanopayments supports best: deposits confirm in about half a
/// second, against 13 to 19 minutes for the Sepolia family.
///
/// So the platform becomes the seller. This is a real x402 resource server sitting
/// on Arc Testnet, priced in sub-cent USDC, settled through Circle Gateway's
/// batched rail. An agent that needs market intel pays for it the same way it pays
/// any other seller: it gets a 402, signs an EIP-3009 authorization offchain for
/// zero gas, and Gateway settles the net position on chain. The agent's own budget
/// is debited and the platform's Gateway balance is credited.
///
/// One caveat worth knowing. Gateway returns a SETTLEMENT ID, not an on-chain hash,
/// because the batch settles later. The payment is real and the balance debits, but
/// do not render that id as an explorer link.
///
/// The data is genuine: live Polymarket odds, fetched keylessly. We are not
/// selling agents a stub.
///
/// Runs as a small standalone HTTP listener because Circle's middleware is a
/// standard Node (req, res, next) handler. Keeping it off the Hono app means it
/// cannot affect the main API.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { config } from "../config/index.js";

/// Circle's Gateway facilitator. Testnet, because we sell on Arc Testnet. Check
/// the Nanopayments column in Circle's supported-blockchains table before pointing
/// this at a different chain.
const FACILITATOR_URL = "https://gateway-api-testnet.circle.com";

/// Arc Testnet in CAIP-2. Restricting to this one network is deliberate: a buyer
/// paying us must settle on Arc, which is the whole point.
const ARC_CAIP2 = "eip155:5042002";

interface PaidRequest extends IncomingMessage {
  payment?: {
    verified: boolean;
    payer: string;
    amount: string;
    network: string;
    transaction?: string;
  };
}

/// Live Polymarket odds, keyless. The same ground truth the mission grader scores
/// against, which is what makes the purchase worth making.
async function marketIntel(topic: string): Promise<unknown> {
  const tag = process.env.POLYMARKET_TAG_ID ?? "21"; // 21 = Crypto
  const url =
    `https://gamma-api.polymarket.com/markets?closed=false&limit=8&order=volume24hr&ascending=false&tag_id=${tag}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`polymarket ${res.status}`);
  const raw = (await res.json()) as Array<Record<string, unknown>>;
  const markets = (Array.isArray(raw) ? raw : []).slice(0, 8).map((m) => {
    let yes: number | null = null;
    try {
      const prices = JSON.parse(String(m.outcomePrices ?? "[]")) as string[];
      if (prices[0] != null) yes = Number(prices[0]);
    } catch {
      /* leave null */
    }
    return {
      question: String(m.question ?? ""),
      impliedYes: yes,
      volume24hr: Number(m.volume24hr ?? 0),
      endDate: String(m.endDate ?? ""),
    };
  });
  return { topic, source: "polymarket", fetchedAt: new Date().toISOString(), markets };
}

function send(res: ServerResponse, code: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json" });
  res.end(payload);
}

/// Start the seller. Returns silently when disabled or unconfigured, so a missing
/// env can never take the backend down.
export async function startArcX402Seller(): Promise<void> {
  const enabled = String(process.env.X402_SELLER_ENABLED ?? "0") === "1";
  if (!enabled) return;

  const sellerAddress = process.env.X402_SELLER_ADDRESS;
  if (!sellerAddress) {
    console.warn("[x402-seller] X402_SELLER_ENABLED=1 but X402_SELLER_ADDRESS is unset; not starting.");
    return;
  }

  const port = Number(process.env.X402_SELLER_PORT ?? "8090");
  const price = process.env.X402_SELLER_PRICE ?? "$0.001";

  let requirePayment: (req: IncomingMessage, res: ServerResponse, next: (e?: unknown) => void) => void | Promise<void>;
  try {
    const { createGatewayMiddleware } = await import("@circle-fin/x402-batching/server");
    const gateway = createGatewayMiddleware({
      sellerAddress,
      networks: ARC_CAIP2,
      facilitatorUrl: FACILITATOR_URL,
      description: "ArcRun market intel: live Polymarket odds",
    });
    requirePayment = gateway.require(price) as typeof requirePayment;
  } catch (err) {
    console.warn(`[x402-seller] failed to init Gateway middleware: ${err instanceof Error ? err.message : err}`);
    return;
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (url.pathname === "/health") {
      send(res, 200, { ok: true, chain: ARC_CAIP2, price, seller: sellerAddress });
      return;
    }

    if (url.pathname !== "/x402/market-intel") {
      send(res, 404, { error: "not found" });
      return;
    }

    // Circle's middleware answers with a 402 (including the GatewayWalletBatched
    // extra the buyer needs to build its EIP-712 domain) when the request carries
    // no valid authorization, and calls next() once Gateway has verified and
    // settled the payment.
    void requirePayment(req, res, (err?: unknown) => {
      if (err) {
        send(res, 500, { error: err instanceof Error ? err.message : String(err) });
        return;
      }
      const paid = (req as PaidRequest).payment;
      const topic = url.searchParams.get("topic") ?? "crypto";
      void marketIntel(topic)
        .then((data) => {
          console.log(
            `[x402-seller] served ${topic} to ${paid?.payer ?? "?"} ` +
              `for ${paid?.amount ?? "?"} on ${paid?.network ?? "?"} tx=${paid?.transaction ?? "pending-batch"}`,
          );
          send(res, 200, { ...(data as object), payment: paid ?? null });
        })
        .catch((e: unknown) => {
          // The buyer already paid, so failing to fetch is on us. Say so plainly
          // rather than returning a stub the agent would then be graded on.
          send(res, 502, { error: `upstream data unavailable: ${e instanceof Error ? e.message : String(e)}` });
        });
    });
  });

  server.listen(port, () => {
    console.log(
      `[x402-seller] Circle Gateway x402 seller live on :${port} ` +
        `(${ARC_CAIP2}, ${price}/call, payTo ${sellerAddress})`,
    );
  });
}
