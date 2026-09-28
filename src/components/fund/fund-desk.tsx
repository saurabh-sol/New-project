"use client";

import { AnimatePresence, motion } from "motion/react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Character } from "@/components/arena/character";
import { Face } from "@/components/arena/face";
import { useWallet } from "@/components/wallet/wallet-provider";
import { AGENTS, AGENT_ORDER } from "@/lib/agents";
import { bonusFor, estimate, withdrawFee, type FundingTerms } from "@/lib/funding";
import type { FundBonus, FundPosition, FundResult, FundStatus } from "@/lib/funding-types";
import type { AgentId } from "@/lib/types";
import { useFundStatus } from "@/lib/use-fund";
import { cn, fmtSigned, shortHash, solscanTx } from "@/lib/utils";
import { canSignTransactions, signMessage, signTransaction } from "@/lib/wallet";

const QUICK = [5, 10, 25, 50];
const PERCENTS = [25, 50, 75, 100];
const money = (n: number) => `$${n.toFixed(2)}`;

async function post<T>(url: string, body: object): Promise<FundResult<T>> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json()) as FundResult<T>;
}

function readable(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  if (/reject|denied|cancel|declin/i.test(text)) return "You cancelled in your wallet. Nothing was moved.";
  return text || "Something went wrong. Try again.";
}

const isAgent = (v: string | null): v is AgentId => !!v && v in AGENTS;

type Notice = { tone: "good" | "bad"; text: string; signature?: string };

export function FundDesk() {
  const params = useSearchParams();
  const { session, address, open } = useWallet();
  const { status, failed, refresh } = useFundStatus(address);

  const asked = params.get("agent");
  const [agent, setAgent] = useState<AgentId>(isAgent(asked) ? asked : "quant");
  const [amount, setAmount] = useState("5");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const usd = Number(amount);
  const terms = status?.terms;
  const wallet = status?.wallet ?? null;
  const cluster = status?.cluster ?? "devnet";
  const symbol = status?.tokenSymbol ?? "USDC";
  const firstDeposit = wallet?.bonusAvailable ?? true;

  const problem = !status
    ? null
    : !status.enabled
      ? status.reason
      : !terms || !isFinite(usd) || usd <= 0
        ? "Enter an amount."
        : usd < terms.minDeposit
          ? `The smallest deposit is ${money(terms.minDeposit)}.`
          : wallet && usd > wallet.balance
            ? `Your wallet holds ${wallet.balance.toFixed(2)} ${symbol}.`
            : session && !canSignTransactions(session.wallet)
              ? `${session.wallet.name} can't sign transactions for this app. Try another wallet.`
              : null;

  async function run(label: string, work: () => Promise<Notice>) {
    setNotice(null);
    setBusy(label);
    try {
      setNotice(await work());
    } catch (e) {
      setNotice({ tone: "bad", text: readable(e) });
    } finally {
      setBusy(null);
      void refresh();
    }
  }

  const getTokens = () =>
    run("faucet", async () => {
      const r = await post<{ signature: string; usd: number }>("/api/fund/faucet", { wallet: address });
      if (!r.ok) throw new Error(r.error);
      return { tone: "good", text: `${r.usd} ${symbol} sent to your wallet.`, signature: r.signature };
    });

  const deposit = () =>
    run("deposit", async () => {
      if (!session || !address) throw new Error("Connect a wallet first.");
      const prep = await post<{ intentId: string; transaction: string }>("/api/fund/deposit", { step: "prepare", wallet: address, agent, usd });
      if (!prep.ok) throw new Error(prep.error);
      setBusy("sign");
      const signed = await signTransaction(session.wallet, session.account, prep.transaction, cluster);
      setBusy("confirm");
      const done = await post<{ signature: string; usd: number; bonus: FundBonus | null }>("/api/fund/deposit", {
        step: "confirm",
        intentId: prep.intentId,
        transaction: signed,
      });
      if (!done.ok) throw new Error(done.error);
      const bonus =
        done.bonus?.status === "paid"
          ? ` Your ${money(done.bonus.usd)} bonus was sent to your wallet.`
          : done.bonus?.status === "locked"
            ? ` Your ${money(done.bonus.usd)} bonus unlocks on ${new Date(done.bonus.unlockAt).toLocaleString()}.`
            : "";
      return { tone: "good", text: `${money(done.usd)} is now working with ${AGENTS[agent].name}.${bonus}`, signature: done.signature };
    });

  const withdraw = (from: AgentId, percent: number) =>
    run(`withdraw-${from}`, async () => {
      if (!session || !address) throw new Error("Connect a wallet first.");
      const res = await fetch("/api/fund/withdraw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step: "challenge", wallet: address, agent: from, percent }),
      });
      const ch = (await res.json()) as { message?: string; token?: string; error?: string };
      if (!ch.message || !ch.token) throw new Error(ch.error ?? "Could not start the withdrawal.");
      const signature = await signMessage(session.wallet, session.account, ch.message);
      const done = await post<{ signature: string; gross: number; fee: number; received: number; pending: boolean }>("/api/fund/withdraw", {
        step: "submit",
        wallet: address,
        agent: from,
        percent,
        message: ch.message,
        token: ch.token,
        signature,
      });
      if (!done.ok) throw new Error(done.error);
      return {
        tone: "good",
        text: done.pending
          ? `${money(done.received)} was submitted and is waiting for confirmation.`
          : `${money(done.received)} sent to your wallet (${money(done.gross)} less a ${money(done.fee)} route fee).`,
        signature: done.signature,
      };
    });

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 px-4 pb-14 pt-8 sm:px-6">
      <header>
        <h1 className="font-display text-4xl font-bold tracking-tight text-white">Fund an agent</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/55">
          Put {symbol} behind an agent. Your funding rises and falls with that agent&apos;s results, and you can take it out whenever the agent has the
          cash free.
        </p>
      </header>

      {failed && !status && <Banner tone="bad">Can&apos;t reach the funding server. Reload to try again.</Banner>}
      {status && !status.enabled && <Banner tone="warn">{status.reason}</Banner>}
      {status?.enabled && cluster === "devnet" && (
        <Banner tone="info">
          <strong className="font-semibold">Devnet.</strong> Everything here uses test tokens with no real value, and the agents&apos; trades are paper
          trades.
        </Banner>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* 1. choose */}
        <section className="panel p-5 sm:p-6">
          <h2 className="panel-title">1 · Choose an agent</h2>
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {AGENT_ORDER.map((id) => {
              const a = AGENTS[id];
              const f = status?.agents.find((x) => x.agent === id);
              const picked = id === agent;
              return (
                <button
                  key={id}
                  onClick={() => setAgent(id)}
                  aria-pressed={picked}
                  className={cn("relative flex items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition", picked ? "bg-white/[0.07]" : "border-white/10 hover:bg-white/[0.04]")}
                  style={picked ? { borderColor: "#fff" } : undefined}
                >
                  <div className="w-12 shrink-0">
                    <Character id={id} pose={picked ? "talk" : "idle"} emotion={picked ? "happy" : "neutral"} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-display truncate font-semibold text-white">{a.name}</div>
                    <div className="truncate font-mono text-[10px] uppercase tracking-wider text-white/60">
                      {a.model}
                    </div>
                    {f && (
                      <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[11px] text-white/50">
                        <span className={f.returnPct > -0.005 ? "text-emerald-400" : "text-red-400"}>
                          {f.returnPct >= 0 ? "+" : ""}
                          {f.returnPct.toFixed(2)}%
                        </span>
                        <span>{money(f.fundedUsd)} funded</span>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-white/40">
            {AGENTS[agent].name}: {AGENTS[agent].persona} More funding gives an agent more capital to trade and more thinking time per session. It
            does not make its results better or safer.
          </p>
        </section>

        {/* 2. amount */}
        <section className="panel panel-strong p-5 sm:p-6">
          <h2 className="panel-title">2 · Choose an amount</h2>

          <label className="mt-4 block">
            <span className="sr-only">Amount in {symbol}</span>
            <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 focus-within:border-sky-400/60">
              <span className="font-display text-2xl text-white/40">$</span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                className="font-display w-full bg-transparent text-3xl font-bold text-white outline-none placeholder:text-white/20"
                placeholder="0"
              />
              <span className="shrink-0 font-mono text-xs text-white/40">{symbol}</span>
            </div>
          </label>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {QUICK.map((q) => (
              <button key={q} onClick={() => setAmount(String(q))} className={cn("btn-ghost px-3 py-1 font-mono text-xs", usd === q && "border-sky-400/60 text-white")}>
                ${q}
              </button>
            ))}
            {wallet && (
              <span className="ml-auto font-mono text-xs text-white/45">
                wallet: {wallet.balance.toFixed(2)} {symbol}
              </span>
            )}
          </div>

          {terms && isFinite(usd) && usd > 0 && <Estimate terms={terms} usd={usd} first={firstDeposit} />}

          <div className="mt-5 grid gap-2">
            {!session ? (
              <button onClick={open} className="btn-primary py-3.5 text-sm">
                Connect wallet
              </button>
            ) : (
              <button onClick={deposit} disabled={busy !== null || !!problem} className="btn-primary py-3.5 text-sm">
                {busy === "deposit"
                  ? "Preparing…"
                  : busy === "sign"
                    ? "Check your wallet…"
                    : busy === "confirm"
                      ? "Confirming on Solana…"
                      : `Fund ${AGENTS[agent].name.replace("The ", "")} with ${isFinite(usd) ? money(usd) : "$0"}`}
              </button>
            )}
            {session && problem && <p className="text-center text-xs text-amber-200/80">{problem}</p>}
            {session && status?.faucet && (
              <button onClick={getTokens} disabled={busy !== null} className="btn-ghost py-2.5 text-xs">
                {busy === "faucet" ? "Sending test tokens…" : `Get ${status.faucetAmount} free ${symbol}`}
              </button>
            )}
          </div>
        </section>
      </div>

      <AnimatePresence>
        {notice && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role={notice.tone === "bad" ? "alert" : "status"}>
            <Banner tone={notice.tone === "good" ? "good" : "bad"}>
              {notice.text}{" "}
              {notice.signature && (
                <a href={solscanTx(notice.signature, cluster)} target="_blank" rel="noreferrer" className="font-mono underline underline-offset-2">
                  {shortHash(notice.signature)} ↗
                </a>
              )}
            </Banner>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 3. your funding */}
      <section className="panel p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="panel-title">Your funding</h2>
          {wallet?.bonus && <BonusLine bonus={wallet.bonus} />}
        </div>
        {!session ? (
          <p className="py-8 text-center text-sm text-white/40">Connect a wallet to see and withdraw your funding.</p>
        ) : !wallet || wallet.positions.length === 0 ? (
          <p className="py-8 text-center text-sm text-white/40">You have not funded an agent yet.</p>
        ) : (
          <ul className="mt-4 grid gap-3">
            {wallet.positions.map((p) => (
              <Holding key={p.agent} p={p} terms={status!.terms} free={status!.agents.find((a) => a.agent === p.agent)?.freeCash ?? 0} busy={busy} onWithdraw={withdraw} />
            ))}
          </ul>
        )}
      </section>

      {wallet && wallet.events.length > 0 && <Activity status={status!} />}
      {terms && <Terms terms={terms} symbol={symbol} />}
    </div>
  );
}

function Banner({ tone, children }: { tone: "good" | "bad" | "warn" | "info"; children: React.ReactNode }) {
  const tones = {
    good: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
    bad: "border-red-400/30 bg-red-400/10 text-red-100",
    warn: "border-amber-400/30 bg-amber-400/10 text-amber-100",
    info: "border-sky-400/30 bg-sky-400/10 text-sky-100",
  };
  return <div className={cn("rounded-2xl border px-4 py-3 text-sm leading-relaxed", tones[tone])}>{children}</div>;
}

function Estimate({ terms, usd, first }: { terms: FundingTerms; usd: number; first: boolean }) {
  const flat = estimate(terms, usd, 0, first);
  const rows = [
    { label: "If the agent gains 5%", e: estimate(terms, usd, 5, first) },
    { label: "If the agent is flat", e: flat },
    { label: "If the agent loses 5%", e: estimate(terms, usd, -5, first) },
  ];
  return (
    <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-4 text-sm">
      <dl className="grid gap-2">
        <div className="flex justify-between">
          <dt className="text-white/55">First-deposit bonus</dt>
          <dd className={cn("font-mono", flat.bonus > 0 ? "text-emerald-300" : "text-white/40")}>{flat.bonus > 0 ? `+${money(flat.bonus)}` : first ? "none at this size" : "already used"}</dd>
        </div>
        {flat.bonus > 0 && (
          <div className="flex justify-between text-xs">
            <dt className="text-white/40">Paid</dt>
            <dd className="text-white/55">{terms.bonusLockHours === 0 ? "straight after your deposit" : `after ${formatHours(terms.bonusLockHours)}, if the deposit is still in`}</dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className="text-white/55">Route fee when you withdraw</dt>
          <dd className="font-mono text-white/80">−{money(flat.fee)}</dd>
        </div>
      </dl>
      <table className="mt-3 w-full border-t border-white/10 text-xs">
        <caption className="pb-1 pt-3 text-left text-[10px] uppercase tracking-widest text-white/35">What you would end up with, bonus included</caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row" className="py-1 text-left font-normal text-white/55">
                {r.label}
              </th>
              <td className="py-1 text-right font-mono text-white/80">{money(r.e.received + r.e.bonus)}</td>
              <td className={cn("w-20 py-1 text-right font-mono", r.e.net > -0.005 ? "text-emerald-400" : "text-red-400")}>{fmtSigned(r.e.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const formatHours = (h: number) => (h % 24 === 0 ? `${h / 24} day${h === 24 ? "" : "s"}` : `${h} hour${h === 1 ? "" : "s"}`);

function BonusLine({ bonus }: { bonus: FundBonus }) {
  const text =
    bonus.status === "paid"
      ? `Bonus of ${money(bonus.usd)} paid`
      : bonus.status === "paying"
        ? `Bonus of ${money(bonus.usd)} is being sent`
        : bonus.status === "forfeited"
          ? `Bonus of ${money(bonus.usd)} given up by withdrawing early`
          : `Bonus of ${money(bonus.usd)} unlocks ${new Date(bonus.unlockAt).toLocaleString()}`;
  return (
    <span className={cn("rounded-full px-3 py-1 text-xs", bonus.status === "forfeited" ? "bg-white/5 text-white/45" : "bg-emerald-400/10 text-emerald-200")}>{text}</span>
  );
}

function Holding({
  p,
  terms,
  free,
  busy,
  onWithdraw,
}: {
  p: FundPosition;
  terms: FundingTerms;
  free: number;
  busy: string | null;
  onWithdraw: (agent: AgentId, percent: number) => void;
}) {
  const [percent, setPercent] = useState(100);
  const a = AGENTS[p.agent];
  const gross = Math.floor(((p.value * percent) / 100) * 100) / 100;
  const fee = withdrawFee(terms, gross);
  const tiedUp = gross > free + 0.005;

  return (
    <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <Face id={p.agent} size={40} />
          <div>
            <div className="font-display font-semibold text-white">{a.name}</div>
            <div className="font-mono text-[11px] text-white/45">{money(p.principal)} put in</div>
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-white/40">Worth now</div>
          <div className="font-display text-xl font-bold text-white">{money(p.value)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-white/40">Result</div>
          <div className={cn("font-mono text-sm font-semibold", p.pnl > -0.005 ? "text-emerald-400" : "text-red-400")}>{fmtSigned(p.pnl)}</div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex rounded-full border border-white/10 p-0.5" role="group" aria-label="Share to withdraw">
            {PERCENTS.map((pc) => (
              <button
                key={pc}
                onClick={() => setPercent(pc)}
                aria-pressed={percent === pc}
                className={cn("rounded-full px-2.5 py-1 font-mono text-[11px]", percent === pc ? "bg-white text-black" : "text-white/55 hover:text-white")}
              >
                {pc}%
              </button>
            ))}
          </div>
          <button onClick={() => onWithdraw(p.agent, percent)} disabled={busy !== null || tiedUp || gross - fee <= 0} className="btn-ghost px-4 py-1.5 text-sm">
            {busy === `withdraw-${p.agent}` ? "Withdrawing…" : "Withdraw"}
          </button>
        </div>
      </div>
      <p className="mt-3 text-xs text-white/45">
        {tiedUp
          ? `${a.name} has ${money(free)} free right now; the rest is in open positions. Choose a smaller share, or wait for the position to close.`
          : gross - fee <= 0
            ? `The ${money(fee)} route fee would use up this withdrawal.`
            : `You receive ${money(gross - fee)}: ${money(gross)} less a ${money(fee)} route fee.`}
      </p>
    </li>
  );
}

function Activity({ status }: { status: FundStatus }) {
  const label = { deposit: "Deposit", withdraw: "Withdrawal", faucet: "Test tokens" };
  return (
    <section className="panel p-5 sm:p-6">
      <h2 className="panel-title">Activity</h2>
      <ul className="mt-3 divide-y divide-white/5 text-sm">
        {status.wallet!.events.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
            <span className="w-24 text-white/80">{label[e.kind]}</span>
            <span className="w-28 text-white/50">{e.agent ? AGENTS[e.agent].name : "—"}</span>
            <span className="font-mono text-white">{money(e.usd)}</span>
            {e.fee > 0 && <span className="font-mono text-xs text-white/40">fee {money(e.fee)}</span>}
            <span className={cn("text-xs", e.status === "done" ? "text-emerald-300/80" : e.status === "failed" ? "text-red-300/80" : "text-amber-200/80")}>
              {e.status === "done" ? "confirmed" : e.status === "failed" ? "did not go through" : "confirming"}
            </span>
            <span className="ml-auto flex items-center gap-3 font-mono text-xs text-white/35">
              {new Date(e.ts).toLocaleString()}
              {e.signature && (
                <a href={solscanTx(e.signature, status.cluster)} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">
                  {shortHash(e.signature)} ↗
                </a>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Terms({ terms, symbol }: { terms: FundingTerms; symbol: string }) {
  const sizes = [5, 10, 25, 50, 100];
  return (
    <section className="panel p-5 sm:p-6">
      <h2 className="panel-title">The terms, in full</h2>
      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <ul className="space-y-2.5 text-sm leading-relaxed text-white/60">
          <li>
            <strong className="font-medium text-white/85">Your funding moves with the agent.</strong> If the agent loses, your funding is worth less. You
            can lose money.
          </li>
          <li>
            <strong className="font-medium text-white/85">Bonus.</strong> One per wallet, on your first deposit, sized by that deposit.{" "}
            {terms.bonusLockHours === 0 ? "It is paid straight away." : `It is paid after ${formatHours(terms.bonusLockHours)}. Withdraw before then and you give it up.`}
          </li>
          <li>
            <strong className="font-medium text-white/85">Route fee.</strong> Each withdrawal costs {money(terms.feeMin)} or {terms.feePct}%, whichever is
            more.
          </li>
          <li>
            <strong className="font-medium text-white/85">Withdrawals.</strong> Paid from the agent&apos;s free cash. Cash inside an open position
            becomes free when that position closes.
          </li>
          <li>
            <strong className="font-medium text-white/85">Limits.</strong> {money(terms.minDeposit)} to {money(terms.maxDeposit)} per agent, in {symbol}.
          </li>
        </ul>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-right font-mono text-xs">
            <caption className="pb-2 text-left font-sans text-xs text-white/45">A first deposit, withdrawn in full while the agent is flat</caption>
            <thead className="text-[10px] uppercase tracking-wider text-white/35">
              <tr>
                <th scope="col" className="py-1.5 text-left font-normal">
                  Deposit
                </th>
                <th scope="col" className="py-1.5 font-normal">
                  Bonus
                </th>
                <th scope="col" className="py-1.5 font-normal">
                  Fee
                </th>
                <th scope="col" className="py-1.5 font-normal">
                  You end with
                </th>
                <th scope="col" className="py-1.5 font-normal">
                  Net
                </th>
              </tr>
            </thead>
            <tbody className="text-white/80">
              {sizes.map((s) => {
                const e = estimate(terms, s, 0, true);
                return (
                  <tr key={s} className="border-t border-white/5">
                    <th scope="row" className="py-1.5 text-left font-normal">
                      {money(s)}
                    </th>
                    <td className="py-1.5 text-emerald-300">+{money(bonusFor(terms, s))}</td>
                    <td className="py-1.5">−{money(e.fee)}</td>
                    <td className="py-1.5">{money(e.received + e.bonus)}</td>
                    <td className={cn("py-1.5", e.net > -0.005 ? "text-emerald-400" : "text-red-400")}>{fmtSigned(e.net)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
