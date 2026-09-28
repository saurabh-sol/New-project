"use client";

import { AnimatePresence, motion } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { connectWallet, disconnectWallet, useSolanaWallets, type Wallet, type WalletAccount } from "@/lib/wallet";

interface Session {
  wallet: Wallet;
  account: WalletAccount;
}

interface WalletContext {
  session: Session | null;
  address: string | null;
  connecting: boolean;
  /** Opens the window that lists the installed wallets. */
  open: () => void;
  disconnect: () => Promise<void>;
}

const Ctx = createContext<WalletContext | null>(null);
const LAST_WALLET = "council:wallet";

export function useWallet(): WalletContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}

const GET_A_WALLET = [
  { name: "Phantom", url: "https://phantom.com/download" },
  { name: "MetaMask", url: "https://metamask.io/download" },
  { name: "Solflare", url: "https://solflare.com/download" },
  { name: "Backpack", url: "https://backpack.app/download" },
];

function readable(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  if (/reject|denied|cancel|declin/i.test(text)) return "You cancelled in your wallet.";
  return text || "The wallet did not connect. Try again.";
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const wallets = useSolanaWallets();
  const [session, setSession] = useState<Session | null>(null);
  const [showing, setShowing] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const triedRestore = useRef(false);

  // Bring back the wallet the user connected last time, without opening it.
  useEffect(() => {
    if (triedRestore.current || session || wallets.length === 0) return;
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_WALLET);
    } catch {}
    const wallet = wallets.find((w) => w.name === last);
    if (!wallet) return;
    triedRestore.current = true;
    connectWallet(wallet, true)
      .then((account) => setSession({ wallet, account }))
      .catch(() => {});
  }, [wallets, session]);

  const connect = useCallback(async (wallet: Wallet) => {
    setError(null);
    setConnecting(wallet.name);
    try {
      const account = await connectWallet(wallet);
      setSession({ wallet, account });
      setShowing(false);
      try {
        localStorage.setItem(LAST_WALLET, wallet.name);
      } catch {}
    } catch (e) {
      setError(readable(e));
    } finally {
      setConnecting(null);
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (session) await disconnectWallet(session.wallet);
    setSession(null);
    try {
      localStorage.removeItem(LAST_WALLET);
    } catch {}
  }, [session]);

  const open = useCallback(() => {
    setError(null);
    setShowing(true);
  }, []);

  useEffect(() => {
    if (!showing) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setShowing(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showing]);

  const value = useMemo<WalletContext>(
    () => ({ session, address: session?.account.address ?? null, connecting: connecting !== null, open, disconnect }),
    [session, connecting, open, disconnect],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <AnimatePresence>
        {showing && (
          <motion.div
            className="fixed inset-0 z-[5000] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowing(false)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Connect a wallet"
              className="panel panel-strong w-full max-w-md overflow-hidden"
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 320, damping: 26 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-6 pt-5">
                <h2 className="font-display text-xl font-semibold text-white">Connect a wallet</h2>
                <button onClick={() => setShowing(false)} aria-label="Close" className="grid size-8 place-items-center rounded-full text-white/50 hover:bg-white/10 hover:text-white">
                  ✕
                </button>
              </div>
              <p className="px-6 pt-1 text-sm text-white/50">Connecting only shares your public address.</p>

              <div className="grid gap-2 p-6">
                {wallets.map((w) => (
                  <button
                    key={w.name}
                    onClick={() => connect(w)}
                    disabled={connecting !== null}
                    className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left transition hover:border-white/50 hover:bg-white/[0.08] disabled:opacity-50"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- wallet icons are inline data URIs */}
                    <img src={w.icon} alt="" className="size-9 rounded-xl" />
                    <span className="flex-1 font-medium text-white">{w.name}</span>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white/80">
                      {connecting === w.name ? "Opening…" : "Installed"}
                    </span>
                  </button>
                ))}

                {wallets.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-white/15 px-4 py-5 text-center text-sm text-white/55">
                    No Solana wallet was found in this browser. Install one, then reload this page.
                  </div>
                )}

                {error && (
                  <p role="alert" className="rounded-xl border border-white/30 bg-white/10 px-4 py-2.5 text-sm text-red-300">
                    {error}
                  </p>
                )}
              </div>

              <div className="border-t border-white/5 px-6 py-4">
                <div className="mb-2 text-[11px] uppercase tracking-widest text-white/35">Get a wallet</div>
                <div className="flex flex-wrap gap-2">
                  {GET_A_WALLET.filter((g) => !wallets.some((w) => w.name.toLowerCase().includes(g.name.toLowerCase()))).map((g) => (
                    <a key={g.name} href={g.url} target="_blank" rel="noreferrer" className="btn-ghost px-3 py-1 text-xs">
                      {g.name} ↗
                    </a>
                  ))}
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-white/35">
                  This app runs on Solana. MetaMask works once its Solana account is switched on.
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Ctx.Provider>
  );
}
