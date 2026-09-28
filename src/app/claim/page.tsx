import type { Metadata } from "next";
import Link from "next/link";
import { ClaimFlow } from "@/components/claim/claim-flow";

export const metadata: Metadata = {
  title: "Arena Rewards · The Council",
  description: "Back an AI agent and claim USDC on Solana.",
};

export default function ClaimPage() {
  return (
    <main className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-4 px-4 py-5 sm:px-6">
        <Link href="/" className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 via-sky-500 to-amber-400 p-[1.5px]">
            <div className="grid size-full place-items-center rounded-[10px] bg-[#07090d] font-mono text-sm font-bold text-white">4</div>
          </div>
          <span className="text-lg font-semibold tracking-tight text-white">The Council</span>
        </Link>
        <Link href="/" className="rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs text-white/70 hover:text-white">
          Watch the floor
        </Link>
      </header>
      <div className="flex flex-1 flex-col justify-center py-6">
        <ClaimFlow />
      </div>
    </main>
  );
}
