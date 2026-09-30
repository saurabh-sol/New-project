"use client";

import { useEffect, useState } from "react";
import { BRAND } from "@/lib/brand";
import { useMarket } from "@/store/market";

/** Long enough for the mark to draw itself once and the name to rise under it. */
const SHOW_AT_LEAST_MS = 1600;
const FADE_MS = 350;
/** The name starts as the bolt lands, one letter after another. */
const NAME_AT_MS = 700;
const LETTER_EVERY_MS = 60;

// Written as markup, not JSX: React leaves `muted` out of the server's HTML, and a browser
// won't start a film by itself unless it is muted. This one has to play before the scripts arrive.
const FILM = `<video autoplay loop muted playsinline preload="auto" aria-hidden="true" width="480" height="480"><source src="/loader/loader.mp4" type="video/mp4"><source src="/loader/loader.webm" type="video/webm"></video>`;

/**
 * The loading screen: the mark drawing itself over the whole page until the first prices are in,
 * with the site's name rising under it letter by letter.
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
      className={`site-loader fixed inset-0 z-[6000] flex flex-col items-center justify-center bg-black transition-opacity ${leaving ? "pointer-events-none opacity-0" : "opacity-100"}`}
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
      <div dangerouslySetInnerHTML={{ __html: FILM }} />
      {/* The film leaves room around the mark, so the name sits up close to it. */}
      <div className="site-loader-name font-display -mt-6 text-2xl font-bold text-white sm:text-3xl" aria-hidden="true">
        {Array.from(BRAND).map((letter, i) => (
          <span key={i} style={{ animationDelay: `${NAME_AT_MS + i * LETTER_EVERY_MS}ms` }}>
            {letter}
          </span>
        ))}
      </div>
    </div>
  );
}
