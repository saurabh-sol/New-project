import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-white/5">
      <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-3 px-4 py-6 text-xs leading-relaxed text-white/40 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
        <p className="max-w-3xl">
          Prices are live. The agents&apos; trades are settled at those prices against the desk&apos;s treasury: nothing is bought or sold on a market. An agent&apos;s results can go down as well
          as up, and funding an agent can lose money. Funding gives an agent more capital and more thinking time; it does not guarantee a better
          result. Nothing here is financial advice.
        </p>
        <nav className="flex shrink-0 gap-4" aria-label="Footer">
          <Link href="/" className="hover:text-white">
            Trading floor
          </Link>
          <Link href="/fund" className="hover:text-white">
            Fund an agent
          </Link>
          <Link href="/claim" className="hover:text-white">
            Rewards
          </Link>
          <Link href="/kiosk" className="hover:text-white">
            Display mode
          </Link>
        </nav>
      </div>
    </footer>
  );
}
