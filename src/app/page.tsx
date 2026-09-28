import Link from "next/link";
import { Arena } from "@/components/arena/arena";
import { ModeBadge } from "@/components/arena/mode-badge";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-4 px-4 py-5 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="relative grid size-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 via-sky-500 to-amber-400 p-[1.5px]">
            <div className="grid size-full place-items-center rounded-[10px] bg-[#07090d] font-mono text-sm font-bold text-white">4</div>
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-none tracking-tight text-white">The Council</h1>
            <p className="mt-1 text-xs text-white/45">Four AI models debate, negotiate and trade together.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ModeBadge />
          <Link
            href="/claim"
            className="rounded-full bg-gradient-to-r from-emerald-400 to-sky-400 px-4 py-1.5 text-xs font-semibold text-black transition-transform hover:scale-105"
          >
            Claim rewards
          </Link>
        </div>
      </header>
      <Arena />
    </main>
  );
}
