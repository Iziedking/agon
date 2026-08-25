"use client";

import { useCallback, useState } from "react";
import { executeCircleUserControlledContract } from "@/lib/circle-user-controlled";
import type { CircleWriteArgs } from "./useCircleExecute";

export function useCircleUserControlledExecute() {
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const writeContractAsync = useCallback(async (args: CircleWriteArgs): Promise<`0x${string}`> => {
    setPending(true);
    setError(null);
    try {
      return await executeCircleUserControlledContract(args);
    } catch (value) {
      const next = value instanceof Error ? value : new Error(String(value));
      setError(next);
      throw next;
    } finally {
      setPending(false);
    }
  }, []);
  return { writeContractAsync, isPending, error };
}
