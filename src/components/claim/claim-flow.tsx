"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Character } from "@/components/arena/character";
import { AGENTS, AGENT_ORDER } from "@/lib/agents";
import type { ChallengeResponse, ClaimRecord, ClaimResponse, RewardsCluster, RewardsStatus } from "@/lib/rewards-types";
import type { AgentId } from "@/lib/types";
import { cn, shortHash, solscanTx } from "@/lib/utils";
import { useWallet } from "@/components/wallet/wallet-provider";
import { shortAddress, signMessage } from "@/lib/wallet";
import { Turnstile } from "./turnstile";

type Outcome =
  | { kind: "demo"; amount: number; agent: AgentId }
  | { kind: "live"; cluster: RewardsCluster; claim: ClaimRecord; earlier: boolean };

type Busy = "sign" | "send" | null;

const STEPS = ["Connect wallet", "Back an agent", "Sign & claim"];

async function api<T>(url: string, body?: object): Promise<{ status: number; data: T }> {
  const res = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  return { status: res.status, data: (await res.json()) as T };
}

const fetchStatus = async (address?: string) =>
  (await api<RewardsStatus>(`/api/rewards/status${address ? `?wallet=${address}` : ""}`)).data;

function readable(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  if (/reject|denied|cancel|declin/i.test(text)) return "You cancelled in your wallet. Nothing was sent.";
  return text || "Something went wrong. Try again.";
}

export function ClaimFlow() {
  const { session, address, open, connecting } = useWallet();
  const [agent, setAgent] = useState<AgentId | null>(null);
  const [status, setStatus] = useState<RewardsStatus | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);

  // Reload whenever the wallet changes: a wallet that already claimed goes straight to its receipt.
  useEffect(() => {
    let alive = true;
    fetchStatus(address ?? undefined)
      .then((s) => {
        if (!alive) return;
        setStatus(s);
        setOutcome(s.claim ? { kind: "live", cluster: s.cluster, claim: s.claim, earlier: true } : null);
        setError(null);
      })
      .catch(() => alive && setError("Can't reach the rewards server. Reload to try again."));
    return () => {
      alive = false;
    };
  }, [address]);

  const step = outcome ? 3 : !session ? 0 : !agent ? 1 : 2;

  async function claim() {
    if (!session || !agent || !address) return;
    setError(null);
    setBusy("sign");
    try {
      const challenge = await api<ChallengeResponse & { error?: string }>("/api/rewards/challenge", { wallet: address, agent });
      if (challenge.status !== 200) throw new Error(challenge.data.error);
      const signature = await signMessage(session.wallet, session.account, challenge.data.message);

      setBusy("send");
      const { data } = await api<ClaimResponse>("/api/rewards/claim", {
        wallet: address,
        agent,
        message: challenge.data.message,
        token: challenge.data.token,
        signature,
        captcha,
      });
      if (data.ok) {
        setOutcome(data.mode === "demo" ? { kind: "demo", amount: data.amount, agent } : { kind: "live", cluster: data.cluster, claim: data.claim, earlier: false });
      } else if (data.claim) {
        setOutcome({ kind: "live", cluster: status?.cluster ?? "mainnet-beta", claim: data.claim, earlier: true });
      } else {
        throw new Error(data.error);
      }
    } catch (e) {
      setError(readable(e));
    } finally {
      setBusy(null);
    }
  }

  const needsCaptcha = !!status?.captchaSiteKey && !captcha;
  const blocked = status?.problem ?? (status && status.mode === "live" && status.remainingToday === 0 ? "Today's rewards are all claimed. Come back tomorrow." : null);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-16 sm:px-6">
      <div className="mb-6 text-center">
        <h1 className="font-display text-4xl font-bold tracking-tight text-white">Arena Rewards</h1>
        <p className="mt-2 text-sm text-white/55">
          Back an agent and claim <span className="font-semibold text-white/80">{status ? `${status.amount} USDC` : "USDC"}</span> on Solana. One
          claim per wallet. You pay no fee.
        </p>
      </div>

      {status?.mode === "demo" && (
        <div className="mb-4 rounded-xl border border-white/30 bg-white/10 px-4 py-3 text-xs leading-relaxed text-white/80">
          <span className="font-semibold">Demo mode.</span> No reward treasury is configured on this server, so you can try the whole flow but no USDC will
          be sent.
        </div>
      )}
      {status?.mode === "live" && status.cluster === "devnet" && (
        <div className="mb-4 rounded-xl border border-white/30 bg-white/10 px-4 py-3 text-xs text-white/80">
          <span className="font-semibold">Devnet.</span> Rewards are paid in devnet test USDC, which has no real value.
        </div>
      )}

      <div className="panel overflow-hidden">
        <Stepper step={step} />

        <div className="p-5 sm:p-7">
          <AnimatePresence mode="wait">
            {step === 0 && (
              <Pane key="connect">
                <h2 className="font-display text-lg font-semibold text-white">Connect your Solana wallet</h2>
                <p className="mt-1 text-sm text-white/50">Phantom, MetaMask, Solflare, Backpack and other Solana wallets work. Connecting only shares your public address.</p>
                <button onClick={open} disabled={connecting} className="btn-primary mt-5 w-full py-3.5 text-sm">
                  {connecting ? "Waiting for wallet…" : "Connect wallet"}
                </button>
              </Pane>
            )}

            {step === 1 && (
              <Pane key="pick">
                <h2 className="text-lg font-semibold text-white">Which agent are you backing?</h2>
                <p className="mt-1 text-sm text-white/50">Your reward is the same whoever you pick.</p>
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {AGENT_ORDER.map((id, i) => {
                    const a = AGENTS[id];
                    return (
                      <motion.button
                        key={id}
                        onClick={() => setAgent(id)}
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.07 }}
                        whileHover={{ y: -4 }}
                        className="group panel px-3 pb-3 pt-4 text-center transition-colors hover:bg-white/[0.07]"
                      >
                        <div className="mx-auto w-16">
                          <Character id={id} pose="idle" />
                        </div>
                        <div className="mt-2 text-sm font-semibold text-white">{a.name}</div>
                        <div className="font-mono text-[10px] uppercase tracking-wider text-white/60">
                          {a.model}
                        </div>
                        <div className="mt-1 text-[11px] leading-snug text-white/40">{a.role}</div>
                      </motion.button>
                    );
                  })}
                </div>
              </Pane>
            )}

            {step === 2 && agent && (
              <Pane key="sign">
                <div className="flex items-center gap-4">
                  <div className="w-20 shrink-0">
                    <Character id={agent} pose={busy ? "type" : "talk"} thinking={busy !== null} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-white">You&apos;re backing {AGENTS[agent].name}</h2>
                    <button onClick={() => setAgent(null)} disabled={busy !== null} className="text-xs text-white/80 hover:underline disabled:opacity-40">
                      Change agent
                    </button>
                  </div>
                </div>

                <ul className="mt-5 space-y-2 text-sm text-white/60">
                  <li>1. Your wallet asks you to sign a short message. This is free and is not a transaction.</li>
                  <li>
                    2. We send <span className="text-white">{status?.amount} USDC</span> to {address && shortAddress(address)} and pay the network fee.
                  </li>
                </ul>

                {status?.captchaSiteKey && (
                  <div className="mt-5">
                    <Turnstile siteKey={status.captchaSiteKey} onToken={setCaptcha} />
                  </div>
                )}

                {blocked && <p className="mt-5 rounded-xl border border-white/30 bg-white/10 px-4 py-3 text-sm text-white/80">{blocked}</p>}

                <button
                  onClick={claim}
                  disabled={busy !== null || needsCaptcha || !!blocked}
                  className="btn-primary mt-5 w-full px-5 py-3.5 text-sm"
                >
                  {busy === "sign" ? "Check your wallet…" : busy === "send" ? "Sending your USDC…" : `Sign & claim ${status?.amount ?? ""} USDC`}
                </button>
              </Pane>
            )}

            {step === 3 && outcome && (
              <Pane key="done">
                <Done outcome={outcome} />
              </Pane>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-4 overflow-hidden rounded-xl border border-white/30 bg-white/10 px-4 py-3 text-sm text-red-300"
                role="alert"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {session && address && (
          <div className="border-t border-white/5 px-5 py-3 text-xs text-white/45 sm:px-7">
            {session.wallet.name} · <span className="font-mono text-white/70">{shortAddress(address)}</span>
          </div>
        )}
      </div>

      <p className="mt-5 text-center text-xs leading-relaxed text-white/35">
        Arena Rewards are a thank-you paid from a pool funded by The Council team. They are not trading profit and not investment returns.
      </p>
    </div>
  );
}

function Pane({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.25 }}>
      {children}
    </motion.div>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex border-b border-white/5">
      {STEPS.map((label, i) => (
        <li key={label} className="relative flex flex-1 items-center justify-center gap-2 px-2 py-3.5">
          <span
            className={cn(
              "grid size-5 place-items-center rounded-full font-mono text-[10px] font-bold transition-colors",
              i < step ? "bg-white text-black" : i === step ? "bg-white text-black" : "bg-white/10 text-white/40",
            )}
          >
            {i < step ? "✓" : i + 1}
          </span>
          <span className={cn("hidden text-xs sm:inline", i <= step ? "text-white" : "text-white/35")}>{label}</span>
          {i === Math.min(step, STEPS.length - 1) && (
            <motion.span layoutId="claim-step" className="absolute inset-x-0 bottom-0 h-0.5" style={{ background: "#fff" }} />
          )}
        </li>
      ))}
    </ol>
  );
}

const CONFETTI = ["#ffffff", "#d4d4d4", "#a3a3a3", "#737373"];

function Done({ outcome }: { outcome: Outcome }) {
  const agent = outcome.kind === "demo" ? outcome.agent : outcome.claim.agent;
  const amount = outcome.kind === "demo" ? outcome.amount : outcome.claim.amount;
  const paid = outcome.kind === "live" && outcome.claim.status === "sent";
  const pending = outcome.kind === "live" && outcome.claim.status === "pending";

  return (
    <div className="relative text-center">
      {paid && !outcome.earlier && (
        <div className="pointer-events-none absolute inset-x-0 top-10">
          {Array.from({ length: 28 }, (_, i) => {
            const angle = (i / 28) * Math.PI * 2;
            return (
              <motion.span
                key={i}
                className="absolute left-1/2 top-0 h-2.5 w-1.5 rounded-sm"
                style={{ background: CONFETTI[i % CONFETTI.length] }}
                initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
                animate={{ x: Math.cos(angle) * (90 + (i % 5) * 22), y: Math.sin(angle) * 90 + 120, opacity: 0, rotate: 300 }}
                transition={{ duration: 1.5, ease: "easeOut" }}
              />
            );
          })}
        </div>
      )}

      <div className="mx-auto w-24">
        <Character id={agent} pose={paid ? "cheer" : "idle"} />
      </div>

      {outcome.kind === "demo" ? (
        <>
          <h2 className="mt-3 text-xl font-semibold text-white">Wallet verified</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-white/55">
            Your signature checked out. This server is in demo mode, so <span className="text-white/80">no USDC was sent</span>. With a funded treasury
            this step pays {amount} USDC.
          </p>
          <span className="mt-4 inline-block rounded bg-white/10 px-2 py-1 font-mono text-[10px] tracking-wider text-white/80 ring-1 ring-white/30">
            DEMO · NO TRANSACTION
          </span>
        </>
      ) : (
        <>
          <h2 className="mt-3 text-xl font-semibold text-white">
            {pending ? "Confirming your payment" : outcome.earlier ? "You already claimed" : "Reward sent"}
          </h2>
          <motion.div
            className={cn("mt-1 font-mono text-4xl font-bold", paid ? "text-white/80" : "text-white/70")}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 220, damping: 12 }}
          >
            {paid ? "+" : ""}
            {amount.toFixed(2)} USDC
          </motion.div>
          <p className="mt-2 text-sm text-white/50">
            {pending
              ? "The transfer was submitted and is waiting for confirmation. Reload in a minute to see the result."
              : `Sent ${new Date(outcome.claim.ts).toLocaleString()}${outcome.cluster === "devnet" ? " on devnet" : ""}.`}
          </p>
          {outcome.claim.signature && (
            <a
              href={solscanTx(outcome.claim.signature, outcome.cluster)}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 font-mono text-xs text-white/80 hover:bg-white/10"
            >
              {shortHash(outcome.claim.signature)} · View on Solscan ↗
            </a>
          )}
        </>
      )}

      <div className="mt-6">
        <Link href="/" className="text-sm text-white/60 underline-offset-4 hover:text-white hover:underline">
          ← Back to the trading floor
        </Link>
      </div>
    </div>
  );
}
