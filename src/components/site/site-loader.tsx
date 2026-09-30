"use client";

import { useEffect, useState } from "react";
import { useMarket } from "@/store/market";

/** Long enough for the mark to draw itself once: the outline, the eyes, then the bolt. */
const SHOW_AT_LEAST_MS = 1300;
const FADE_MS = 350;

// Written as markup, not JSX: React leaves `muted` out of the server's HTML, and a browser
// won't start a film by itself unless it is muted. This one has to play before the scripts arrive.
const FILM = `<video autoplay loop muted playsinline preload="auto" aria-hidden="true" width="480" height="480"><source src="/loader/loader.mp4" type="video/mp4"><source src="/loader/loader.webm" type="video/webm"></video>`;

/**
 * The loading screen: the mark drawing itself over the whole page until the first prices are in.
 * It is part of the server's HTML, so it is what a visitor sees while the page gets ready.
 * The feed gives up after a few seconds (see the market store), so it never stays for long.
 */
export function SiteLoader() {
  const feedSettled = useMarket((s) => s.status !== "loading");
  const [shownLongEnough, setShownLongEnough] = useState(false);
  const [gone, setGone] = useState(false);
  const leaving = feedSettled && shownLongEnough;

  useEffect(() => {
    const id = setTimeout(() => setShownLongEnough(true), SHOW_AT_LEAST_MS);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const id = setTimeout(() => setGone(true), FADE_MS);
    return () => clearTimeout(id);
  }, [leaving]);

  if (gone) return null;
  return (
    <div
      role="status"
      aria-label="Loading"
      className={`site-loader fixed inset-0 z-[6000] grid place-items-center bg-black transition-opacity ${leaving ? "pointer-events-none opacity-0" : "opacity-100"}`}
      style={{ transitionDuration: `${FADE_MS}ms` }}
      dangerouslySetInnerHTML={{ __html: FILM }}
    />
  );
}
