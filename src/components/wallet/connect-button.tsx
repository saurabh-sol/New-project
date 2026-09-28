"use client";

import { useEffect, useRef, useState } from "react";
import { shortAddress } from "@/lib/wallet";
import { cn } from "@/lib/utils";
import { useWallet } from "./wallet-provider";

const NETWORK = { solana: "Solana", base: "Base" };

export function ConnectButton({ className }: { className?: string }) {
  const { chain, address, walletName, icon, connecting, open, openAccount, disconnect } = useWallet();
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  if (!chain || !address) {
    return (
      <button onClick={open} disabled={connecting} className={cn("btn-primary px-4 py-2 text-sm", className)}>
        {connecting ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }

  return (
    <div ref={box} className={cn("relative", className)}>
      {/* Ethereum-type wallets get RainbowKit's own account window. Solana wallets get a small menu. */}
      <button
        onClick={() => (chain === "base" ? openAccount() : setMenu((m) => !m))}
        className="btn-ghost flex items-center gap-2 py-1.5 pl-1.5 pr-3 text-sm"
        aria-expanded={chain === "solana" ? menu : undefined}
      >
        {icon ? (
          // eslint-disable-next-line @next/next/no-img-element -- wallet icons are inline data URIs
          <img src={icon} alt="" className="size-6 rounded-full" />
        ) : (
          <span className="grid size-6 place-items-center rounded-full bg-white font-mono text-[9px] font-bold text-black">0x</span>
        )}
        <span className="font-mono text-xs text-white">{shortAddress(address)}</span>
        <span className="hidden rounded-full bg-white/10 px-1.5 py-px text-[10px] text-white/60 sm:inline">{NETWORK[chain]}</span>
      </button>
      {menu && chain === "solana" && (
        <div className="panel absolute right-0 top-full z-50 mt-2 w-52 overflow-hidden p-1.5 text-sm">
          <div className="px-3 py-2 text-xs text-white/40">{walletName}</div>
          <button
            className="w-full rounded-lg px-3 py-2 text-left text-white/80 hover:bg-white/10"
            onClick={() => {
              navigator.clipboard?.writeText(address).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              });
            }}
          >
            {copied ? "Copied" : "Copy address"}
          </button>
          <button
            className="w-full rounded-lg px-3 py-2 text-left text-red-300 hover:bg-white/10"
            onClick={() => {
              setMenu(false);
              void disconnect();
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
