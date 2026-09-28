/** Four seats at one table, one colour per agent. */
export function Logo({ className = "size-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <rect x="1" y="1" width="38" height="38" rx="11" fill="#0b0f17" stroke="rgba(255,255,255,0.14)" />
      <circle cx="20" cy="20" r="5.5" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
      <circle cx="11" cy="11" r="4" fill="var(--quant)" />
      <circle cx="29" cy="11" r="4" fill="var(--degen)" />
      <circle cx="11" cy="29" r="4" fill="var(--guardian)" />
      <circle cx="29" cy="29" r="4" fill="var(--oracle)" />
    </svg>
  );
}
