import { BRAND, X_HANDLE, X_URL } from "@/lib/brand";

/**
 * The site's account on X, as a round button that sits beside the theme switch.
 * On the narrowest phones there is no room for it beside the name, and the footer carries the link.
 */
export function XLink() {
  return (
    <a
      href={X_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${BRAND} on X (${X_HANDLE})`}
      title={`${BRAND} on X (${X_HANDLE})`}
      className="btn-ghost hidden size-9 shrink-0 place-items-center min-[440px]:grid"
    >
      <svg viewBox="0 0 24 24" className="size-[15px]" fill="currentColor" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    </a>
  );
}
