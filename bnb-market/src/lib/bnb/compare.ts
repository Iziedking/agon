import type { BnbChainId } from "@/lib/bnb/chains";
import type { BnbService } from "@/lib/bnb/catalog";
import { serviceById } from "@/lib/bnb/market-query";
export {
  MAX_COMPARE_SERVICES,
  addCompareId,
  parseCompareIds,
  removeCompareId,
  serializeCompareIds,
} from "./compare-core";
import { parseCompareIds } from "./compare-core";

export interface CompareCandidate {
  id: string;
  service: BnbService | null;
  availableOnChain: boolean;
}

export interface CompareState {
  chainId: BnbChainId;
  requestedIds: string[];
  candidates: CompareCandidate[];
}

/** Resolve compare ids against the selected network only. */
export function resolveCompareState(chainId: BnbChainId, rawIds: string | null): CompareState {
  const requestedIds = parseCompareIds(rawIds);
  const candidates = requestedIds.map((id) => {
    const service = serviceById(id, chainId);
    return { id, service, availableOnChain: service !== null };
  });
  return { chainId, requestedIds, candidates };
}
