"use client";

import { useEffect, useState } from "react";
import type { AdminStatus } from "@/lib/admin-types";

const ASK_EVERY_MS = 30_000;

/**
 * The server's own state, asked for every half minute. `reached` is false while the server
 * can't be reached. A display that is no longer signed in is sent to sign in again.
 */
export function useAdminStatus(): { status: AdminStatus | null; reached: boolean } {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [reached, setReached] = useState(true);

  useEffect(() => {
    let on = true;
    const ask = async () => {
      try {
        const res = await fetch("/api/admin/status", { cache: "no-store" });
        if (!on) return;
        // Loading the page again is what sends a browser that is not signed in to the sign-in page.
        if (res.status === 401) return window.location.reload();
        if (!res.ok) return setReached(false);
        setStatus((await res.json()) as AdminStatus);
        setReached(true);
      } catch {
        if (on) setReached(false);
      }
    };
    void ask();
    const id = setInterval(ask, ASK_EVERY_MS);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, []);

  return { status, reached };
}

/** The time now, read again every second. Null until the page is in the browser, whose clock the server does not know. */
export function useNow(everyMs = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
