"use client";

import { useCallback, useEffect, useState } from "react";
import type { FundStatus } from "./funding-types";

const REFRESH_MS = 20_000;

/** Funding figures for every agent, plus this wallet's own funding when an address is given. */
export function useFundStatus(address: string | null) {
  const [status, setStatus] = useState<FundStatus | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetch(`/api/fund/status${address ? `?wallet=${address}` : ""}`, { signal, cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        setStatus((await res.json()) as FundStatus);
        setFailed(false);
      } catch {
        if (!signal?.aborted) setFailed(true);
      }
    },
    [address],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    const tick = () => void load(ctrl.signal);
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, REFRESH_MS);
    return () => {
      ctrl.abort();
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  return { status, failed, refresh: load };
}
