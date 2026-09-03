export const MAX_COMPARE_SERVICES = 3;

export function parseCompareIds(rawIds: string | null): string[] {
  if (!rawIds) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const rawId of rawIds.split(",")) {
    const id = rawId.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length === MAX_COMPARE_SERVICES) break;
  }
  return ids;
}

export function serializeCompareIds(ids: readonly string[]): string {
  return parseCompareIds(ids.join(",")).join(",");
}

export function addCompareId(ids: readonly string[], id: string): string[] {
  return parseCompareIds([...ids, id].join(","));
}

export function removeCompareId(ids: readonly string[], id: string): string[] {
  return parseCompareIds(ids.filter((candidate) => candidate !== id).join(","));
}

