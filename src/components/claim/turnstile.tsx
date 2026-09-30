"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

/** The part of Cloudflare's script used here. */
interface TurnstileApi {
  render(el: HTMLElement, opts: { sitekey: string; theme?: string; callback(token: string): void; "expired-callback"?(): void }): string | null | undefined;
  remove(id: string): void;
}

// Not declared on Window: Privy's packages declare `window.turnstile` with a type of their own, and two declarations clash.
const turnstile = () => (window as unknown as { turnstile?: TurnstileApi }).turnstile;

/** Cloudflare Turnstile captcha. Only rendered when the server has it configured. */
export function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (token: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const api = turnstile();
    if (!ready || !box.current || !api) return;
    const id = api.render(box.current, {
      sitekey: siteKey,
      theme: "dark",
      callback: onToken,
      "expired-callback": () => onToken(null),
    });
    if (!id) return;
    return () => turnstile()?.remove(id);
  }, [ready, siteKey, onToken]);

  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" onReady={() => setReady(true)} />
      <div ref={box} className="flex min-h-[65px] justify-center" />
    </>
  );
}
