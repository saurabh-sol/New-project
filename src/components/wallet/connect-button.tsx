"use client";

import { useEffect, useRef, useState } from "react";
import { shortAddress } from "@/lib/wallet";
import { cn } from "@/lib/utils";
import { useWallet } from "./wallet-provider";

export function ConnectButton({ className }: { className?: string }) {
  const { address, walletName, icon, open, disconnect } = useWallet();
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  if (!address) {
    return (
      <button onClick={open} className={cn("btn-primary px-4 py-2 text-sm", className)}>
        Connect wallet
      </button>
    );
  }

  return (
    <div ref={box} className={cn("relative", className)}>
      <button onClick={() => setMenu((m) => !m)} className="btn-ghost flex items-center gap-2 py-1.5 pl-1.5 pr-3 text-sm" aria-expanded={menu}>
        {icon ? (
          // eslint-disable-next-line @next/next/no-img-element -- wallet icons are inline data URIs
          <img src={icon} alt="" className="size-6 rounded-full" />
        ) : (
          <span className="size-6 rounded-full bg-white" />
        )}
        <span className="font-mono text-xs text-white">{shortAddress(address)}</span>
      </button>
      {menu && (
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
