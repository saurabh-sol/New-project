"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** One row in the wallet list. */
export interface WalletOption {
  key: string;
  name: string;
  icon: string | null;
  /** A few words under the name: what kind of wallet it is. */
  note: string;
  /** Missing when the wallet isn't installed; the row then links to its download page. */
  connect?: () => Promise<void>;
  installUrl?: string;
  /** What the row's tag says when the wallet can't be connected. "Install" unless given. */
  installLabel?: string;
}

interface Props {
  popular: WalletOption[];
  installed: WalletOption[];
  onClose: () => void;
}

function readable(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  if (/reject|denied|cancel|declin/i.test(text)) return "You cancelled in your wallet.";
  if (/already pending/i.test(text)) return "Your wallet already has a request open. Check the wallet's window.";
  return text.split("\n")[0] || "The wallet did not connect. Try again.";
}

function Logo({ option, size = "size-9" }: { option: WalletOption; size?: string }) {
  return option.icon ? (
    // eslint-disable-next-line @next/next/no-img-element -- wallet icons are inline data URIs or small local files
    <img src={option.icon} alt="" className={cn(size, "shrink-0 rounded-xl")} />
  ) : (
    <span className={cn(size, "grid shrink-0 place-items-center rounded-xl bg-white/10 font-mono text-xs font-bold text-white")}>{option.name.slice(0, 2)}</span>
  );
}

/**
 * The wallet picker: the list on the left, help or progress on the right.
 * It shows MetaMask and Robinhood Wallet, then any other wallet installed in this browser.
 */
export function ConnectWindow({ popular, installed, onClose }: Props) {
  const [pending, setPending] = useState<WalletOption | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function choose(option: WalletOption) {
    if (!option.connect) return;
    setError(null);
    setPending(option);
    try {
      await option.connect();
      onClose();
    } catch (e) {
      setError(readable(e));
    }
  }

  const row = (o: WalletOption) => {
    const active = pending?.key === o.key;
    const body = (
      <>
        <Logo option={o} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-white">{o.name}</span>
          <span className="block text-xs text-white/40">{o.note}</span>
        </span>
        {!o.connect && <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/50">{o.installLabel ?? "Install"}</span>}
      </>
    );
    const style = cn("flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors", active ? "bg-white/15" : "hover:bg-white/[0.08]");
    return (
      <li key={o.key}>
        {o.connect ? (
          <button onClick={() => choose(o)} className={style} aria-pressed={active}>
            {body}
          </button>
        ) : (
          <a href={o.installUrl} target="_blank" rel="noreferrer" className={style}>
            {body}
          </a>
        )}
      </li>
    );
  };

  return (
    <motion.div
      className="fixed inset-0 z-[5000] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Connect a wallet"
        className="panel panel-strong relative grid max-h-[86vh] w-full max-w-3xl overflow-hidden md:grid-cols-[19rem_minmax(0,1fr)]"
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 grid size-8 place-items-center rounded-full bg-white/10 text-sm text-white/70 hover:bg-white/20 hover:text-white"
        >
          ✕
        </button>

        {/* the list */}
        <div className="overflow-y-auto border-b border-white/10 p-5 md:border-b-0 md:border-r">
          <h2 className="font-display text-xl font-bold text-white">Connect a Wallet</h2>
          <p className="mt-1 text-xs text-white/40">On Robinhood Chain</p>

          <h3 className="mb-1 mt-5 px-2.5 text-sm font-semibold text-white/40">Popular</h3>
          <ul className="grid gap-0.5">{popular.map(row)}</ul>

          {installed.length > 0 && (
            <>
              <h3 className="mb-1 mt-5 px-2.5 text-sm font-semibold text-white/40">Installed</h3>
              <ul className="grid gap-0.5">{installed.map(row)}</ul>
            </>
          )}
        </div>

        {/* help, or progress once a wallet is chosen */}
        <div className="flex min-h-[22rem] flex-col items-center justify-center overflow-y-auto px-8 py-10 text-center">
          {pending ? (
            <>
              <Logo option={pending} size="size-16" />
              <h3 className="font-display mt-5 text-lg font-bold text-white">{error ? "Not connected" : `Opening ${pending.name}…`}</h3>
              <p className={cn("mt-2 max-w-xs text-sm", error ? "text-red-300" : "text-white/55")} role={error ? "alert" : "status"}>
                {error ?? "Confirm the connection in your wallet. Connecting only shares your public address."}
              </p>
              <div className="mt-6 flex gap-2">
                {error && (
                  <button onClick={() => choose(pending)} className="btn-primary px-5 py-2 text-sm">
                    Try again
                  </button>
                )}
                <button
                  onClick={() => {
                    setPending(null);
                    setError(null);
                  }}
                  className="btn-ghost px-5 py-2 text-sm"
                >
                  Back
                </button>
              </div>
            </>
          ) : (
            <>
              <h3 className="font-display text-lg font-bold text-white">What is a Wallet?</h3>
              <dl className="mt-7 grid max-w-sm gap-6 text-left">
                <div className="flex gap-4">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-white/15 text-lg text-white" aria-hidden="true">
                    ◈
                  </span>
                  <div>
                    <dt className="text-sm font-semibold text-white">A home for your digital assets</dt>
                    <dd className="mt-1 text-sm leading-relaxed text-white/50">Wallets hold, send and receive tokens such as USDG.</dd>
                  </div>
                </div>
                <div className="flex gap-4">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-white/15 text-lg text-white" aria-hidden="true">
                    ⚿
                  </span>
                  <div>
                    <dt className="text-sm font-semibold text-white">A new way to log in</dt>
                    <dd className="mt-1 text-sm leading-relaxed text-white/50">No account or password to create here. You connect your wallet instead.</dd>
                  </div>
                </div>
              </dl>
              <div className="mt-8 flex flex-col items-center gap-3">
                <a href="https://metamask.io/download" target="_blank" rel="noreferrer" className="btn-primary px-5 py-2 text-sm">
                  Get a Wallet
                </a>
                <a href="https://docs.robinhood.com/chain/add-network-to-wallet" target="_blank" rel="noreferrer" className="text-sm font-semibold text-white/70 hover:text-white">
                  Learn More
                </a>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
