/** Four seats at one table. */
export function Logo({ className = "size-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <rect x="1" y="1" width="38" height="38" rx="11" fill="var(--paper)" stroke="var(--ink)" strokeOpacity="0.3" />
      <circle cx="20" cy="20" r="5.5" fill="none" stroke="var(--ink)" strokeOpacity="0.35" strokeWidth="1.5" />
      <circle cx="11" cy="11" r="4" fill="var(--ink)" />
      <circle cx="29" cy="11" r="4" fill="var(--ink)" />
      <circle cx="11" cy="29" r="4" fill="var(--ink)" />
      <circle cx="29" cy="29" r="4" fill="var(--ink)" />
    </svg>
  );
}
