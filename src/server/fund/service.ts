/**
 * Funding an agent: deposits, withdrawals, the first-deposit bonus and the devnet faucet.
 *
 * Every change to a user's balance is written in the same database statement as the
 * change to the agent's books, guarded by the state's version, so the two can't drift apart.
 * Every payout records its signature before it is broadcast, so a crash can't pay twice.
 */
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToCheckedInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import { Connection, PublicKey, Transaction, type Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { createHash, randomBytes } from "node:crypto";
import { AGENT_ORDER, AGENTS } from "@/lib/agents";
import { agentNav, fundIn, fundOut, userFunding, type Portfolio } from "@/lib/council";
import { bonusFor, withdrawFee } from "@/lib/funding";
import type { AgentFunding, FundBonus, FundEvent, FundPosition, FundResult, FundStatus } from "@/lib/funding-types";
import { fetchQuotes, type Token } from "@/lib/market";
import type { AgentId } from "@/lib/types";
import { FUNDING_LEVELS, fundingLevel } from "../council/skills";
import { inTurn, readVersioned, trimmed, type CouncilState } from "../council/store";
import { db, num } from "../db";
import { checkMessage, issueMessage, verifySignature } from "../rewards/challenge";
import { USDC_DECIMALS } from "../rewards/config";
import { broadcast, connect, fate, signTransfer, treasuryBalance } from "../rewards/payout";
import { fundConfig, type FundConfig } from "./config";

type Prices = Partial<Record<Token, number>>;
type Row = Record<string, unknown>;

const INTENT_TTL_MS = 3 * 60_000;
const FAUCET_GAP_HOURS = 24;
const MAX_ATTEMPTS = 6;
const DUST = 1e-9;

const cents = (n: number) => Math.round(n * 100) / 100;
const units = (usd: number) => BigInt(Math.round(usd * 10 ** USDC_DECIMALS));
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function livePrices(): Promise<Prices> {
  const quotes = await fetchQuotes(AbortSignal.timeout(10_000));
  return Object.fromEntries(Object.entries(quotes).map(([t, q]) => [t, q.price])) as Prices;
}

async function tokenBalance(conn: Connection, mint: PublicKey, owner: PublicKey): Promise<number> {
  try {
    return (await conn.getTokenAccountBalance(getAssociatedTokenAddressSync(mint, owner))).value.uiAmount ?? 0;
  } catch {
    return 0;
  }
}

/** What the treasury needs to operate; narrows the config once funding is known to be on. */
function live(cfg: FundConfig): { treasury: Keypair; conn: Connection } | null {
  return cfg.enabled && cfg.chain.treasury ? { treasury: cfg.chain.treasury, conn: connect(cfg.chain) } : null;
}

// --- reading ---

function agentView(p: Portfolio, prices: Prices): AgentFunding[] {
  return AGENT_ORDER.map((agent) => {
    const funded = userFunding(p, agent);
    const level = fundingLevel(funded);
    const next = FUNDING_LEVELS.find((l) => l.level === level.level + 1);
    const nav = agentNav(p, agent, prices);
    return {
      agent,
      nav,
      returnPct: (nav - 1) * 100,
      fundedUsd: funded,
      freeCash: p.cash[agent],
      level: level.level,
      levelLabel: level.label,
      nextLevelAt: next?.from ?? null,
    };
  });
}

const toBonus = (r: Row): FundBonus => ({
  usd: num(r.usd),
  depositUsd: num(r.deposit_usd),
  agent: r.agent as AgentId,
  unlockAt: new Date(r.unlock_at as string).getTime(),
  status: r.status as FundBonus["status"],
  signature: (r.signature as string | null) ?? null,
});

const toEvent = (r: Row): FundEvent => ({
  id: num(r.id),
  kind: r.kind as FundEvent["kind"],
  agent: (r.agent as AgentId | null) ?? null,
  usd: num(r.usd),
  fee: num(r.fee),
  status: r.status as FundEvent["status"],
  signature: (r.signature as string | null) ?? null,
  ts: new Date(r.created_at as string).getTime(),
});

const MIN_TREASURY_SOL = 0.01;
let checked: { at: number; key: string; problem: string | null } | null = null;

/** Whether the treasury can actually pay: it needs SOL for fees and a token account. Checked at most twice a minute. */
async function treasuryProblem(cfg: FundConfig): Promise<string | null> {
  const on = live(cfg);
  if (!on) return cfg.reason;
  const key = `${on.treasury.publicKey.toBase58()}:${cfg.chain.mint.toBase58()}:${cfg.chain.rpcUrl}`;
  if (checked && checked.key === key && Date.now() - checked.at < 30_000) return checked.problem;
  let problem: string | null = null;
  try {
    const sol = (await on.conn.getBalance(on.treasury.publicKey)) / 1e9;
    if (sol < MIN_TREASURY_SOL) problem = "The treasury wallet has no SOL to pay network fees yet.";
    else if (!(await on.conn.getAccountInfo(getAssociatedTokenAddressSync(cfg.chain.mint, on.treasury.publicKey)))) problem = "The treasury holds none of the funding token yet.";
  } catch {
    problem = "Can't reach the Solana network right now.";
  }
  checked = { at: Date.now(), key, problem };
  return problem;
}

export async function fundStatus(wallet: PublicKey | null): Promise<FundStatus> {
  const cfg = fundConfig();
  const { state } = await readVersioned();
  const prices = await livePrices().catch(() => ({}) as Prices);
  const problem = await treasuryProblem(cfg);
  const base: FundStatus = {
    enabled: cfg.enabled && problem === null,
    reason: problem,
    cluster: cfg.chain.cluster,
    tokenSymbol: cfg.tokenSymbol,
    faucet: cfg.enabled && problem === null && cfg.faucet,
    faucetAmount: cfg.faucetAmount,
    terms: cfg.terms,
    agents: agentView(state.portfolio, prices),
    wallet: null,
  };
  const on = live(cfg);
  if (!wallet || !on || problem) return base;

  const address = wallet.toBase58();
  await settle(address).catch((e) => console.error("[fund] settle failed:", e));
  const sql = await db();
  const [positions, bonuses, events, balance] = await Promise.all([
    sql`select * from fund_positions where wallet = ${address} and shares > ${DUST}`,
    sql`select * from fund_bonuses where wallet = ${address}`,
    sql`select * from fund_events where wallet = ${address} order by id desc limit 12`,
    tokenBalance(on.conn, cfg.chain.mint, wallet),
  ]);
  const navs = Object.fromEntries(base.agents.map((a) => [a.agent, a.nav])) as Record<AgentId, number>;

  return {
    ...base,
    wallet: {
      balance,
      positions: positions.map((r): FundPosition => {
        const agent = r.agent as AgentId;
        const value = cents(num(r.shares) * navs[agent]);
        return { agent, shares: num(r.shares), principal: num(r.principal), value, pnl: cents(value - num(r.principal)) };
      }),
      bonus: bonuses[0] ? toBonus(bonuses[0]) : null,
      bonusAvailable: bonuses.length === 0,
      events: events.map(toEvent),
    },
  };
}

// --- deposit ---

export async function prepareDeposit(wallet: PublicKey, agent: AgentId, usd: number): Promise<FundResult<{ intentId: string; transaction: string }>> {
  const cfg = fundConfig();
  const on = live(cfg);
  if (!on) return fail(cfg.reason ?? "Funding is not available.");
  const { terms, chain } = cfg;
  const amount = cents(usd);
  if (!isFinite(amount) || amount < terms.minDeposit) return fail(`The smallest deposit is $${terms.minDeposit}.`);

  const sql = await db();
  const address = wallet.toBase58();
  const [pos] = await sql`select principal from fund_positions where wallet = ${address} and agent = ${agent}`;
  if (num(pos?.principal) + amount > terms.maxDeposit) return fail(`You can fund one agent with at most $${terms.maxDeposit}.`);

  const balance = await tokenBalance(on.conn, chain.mint, wallet);
  if (balance < amount) return fail(`Your wallet holds ${balance.toFixed(2)} ${cfg.tokenSymbol}, which is less than $${amount.toFixed(2)}.`);

  // The treasury pays the network fee, so the user needs no SOL. The user only signs the transfer.
  const from = getAssociatedTokenAddressSync(chain.mint, wallet);
  const to = getAssociatedTokenAddressSync(chain.mint, on.treasury.publicKey);
  const { blockhash, lastValidBlockHeight } = await on.conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: on.treasury.publicKey, blockhash, lastValidBlockHeight }).add(
    createAssociatedTokenAccountIdempotentInstruction(on.treasury.publicKey, to, on.treasury.publicKey, chain.mint),
    createTransferCheckedInstruction(from, chain.mint, to, wallet, units(amount), USDC_DECIMALS),
  );
  tx.partialSign(on.treasury);

  const intentId = randomBytes(12).toString("hex");
  const hash = createHash("sha256").update(tx.serializeMessage()).digest("hex");
  await sql`
    insert into fund_intents (id, wallet, agent, usd, status, expires_at, message_hash)
    values (${intentId}, ${address}, ${agent}, ${amount}, 'pending', ${new Date(Date.now() + INTENT_TTL_MS).toISOString()}, ${hash})`;

  return { ok: true, intentId, transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64") };
}

async function confirmed(conn: Connection, signature: string): Promise<boolean> {
  const status = (await conn.getSignatureStatus(signature, { searchTransactionHistory: true })).value;
  return !status?.err && (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized");
}

/** Waits until the network has confirmed a transaction, or decides it failed. */
async function landed(conn: Connection, signature: string, timeoutMs = 60_000): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const status = (await conn.getSignatureStatus(signature, { searchTransactionHistory: true })).value;
    if (status?.err) return false;
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return true;
    await sleep(1000);
  }
  return false;
}

/**
 * Runs `work` against the latest books. `work` saves the books and the user's records
 * in one statement; if the books changed underneath, it reports not done and runs again.
 */
async function withBooks<T>(work: (state: CouncilState, prices: Prices, version: number) => Promise<{ done: true; value: T } | { done: false }>): Promise<T> {
  return inTurn(async () => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { state, version } = await readVersioned();
      const result = await work(state, await livePrices(), version);
      if (result.done) return result.value;
    }
    throw new Error("The agent's books changed too often to complete this. Try again.");
  });
}

export async function confirmDeposit(
  intentId: string,
  signedTx: string,
): Promise<FundResult<{ signature: string; usd: number; shares: number; nav: number; bonus: FundBonus | null }>> {
  const cfg = fundConfig();
  const on = live(cfg);
  if (!on) return fail(cfg.reason ?? "Funding is not available.");
  const sql = await db();

  const [intent] = await sql`select * from fund_intents where id = ${intentId}`;
  if (!intent) return fail("This deposit request was not found. Start again.");
  const address = intent.wallet as string;
  const agent = intent.agent as AgentId;
  const usd = num(intent.usd);

  let tx: Transaction;
  try {
    tx = Transaction.from(Buffer.from(signedTx, "base64"));
  } catch {
    return fail("The signed transaction could not be read.");
  }
  // The treasury signed exactly one message for this request. Anything else fails one of these checks.
  const hash = createHash("sha256").update(tx.serializeMessage()).digest("hex");
  if (hash !== intent.message_hash || !tx.verifySignatures()) return fail("The signed transaction does not match this deposit request.");
  const signature = bs58.encode(tx.signature!);

  const [credited] = await sql`select shares, nav from fund_events where signature = ${signature}`;
  if (!credited) {
    const expired = new Date(intent.expires_at as string).getTime() < Date.now();
    if (expired && !(await confirmed(on.conn, signature))) return fail("This deposit request expired. Start again.");
    try {
      await on.conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
    } catch (e) {
      // Sent before (a retry of this call). Whether it landed is settled below.
      if (!/already (been )?processed/i.test(String(e))) {
        console.error("[fund] deposit was not accepted:", e);
        return fail("The network rejected the transfer. Nothing was moved.");
      }
    }
    if (!(await landed(on.conn, signature))) return fail("The transfer was not confirmed. If funds left your wallet, reload in a minute: the deposit will be credited.");

    await withBooks(async (state, prices, version) => {
      const inn = fundIn(state.portfolio, agent, usd, prices);
      const next = trimmed({ ...state, portfolio: inn.portfolio });
      const rows = await sql.query(
        `with upd as (
           update council_state set data = $1::jsonb, version = version + 1, updated_at = now()
           where id = 1 and version = $2 and not exists (select 1 from fund_events where signature = $8)
           returning 1
         ), ev as (
           insert into fund_events (wallet, agent, kind, usd, shares, nav, principal, status, signature)
           select $3, $4, 'deposit', $5, $6, $7, $5, 'done', $8 from upd
         ), pos as (
           insert into fund_positions (wallet, agent, shares, principal)
           select $3, $4, $6, $5 from upd
           on conflict (wallet, agent) do update
             set shares = fund_positions.shares + excluded.shares, principal = fund_positions.principal + excluded.principal, updated_at = now()
         ), done as (
           update fund_intents set status = 'done' where id = $9 and exists (select 1 from upd)
         )
         select (select count(*) from upd)::int as ok, exists (select 1 from fund_events where signature = $8) as seen`,
        [JSON.stringify(next), version, address, agent, usd, inn.shares, inn.nav, signature, intentId],
      );
      // Credited by an earlier attempt, or credited now.
      return rows[0].ok === 1 || rows[0].seen ? { done: true, value: null } : { done: false };
    });
  }

  const [event] = await sql`select shares, nav from fund_events where signature = ${signature}`;
  const bonus = await grantBonus(cfg, address, agent, usd);
  return { ok: true, signature, usd, shares: num(event.shares), nav: num(event.nav), bonus };
}

// --- bonus ---

/** Promises the first-deposit bonus, if this wallet has never had one and today's budget allows. */
async function grantBonus(cfg: FundConfig, address: string, agent: AgentId, deposit: number): Promise<FundBonus | null> {
  const sql = await db();
  const usd = bonusFor(cfg.terms, deposit);
  if (usd > 0) {
    const unlock = new Date(Date.now() + cfg.terms.bonusLockHours * 3_600_000).toISOString();
    await sql`
      insert into fund_bonuses (wallet, agent, deposit_usd, usd, unlock_at, status)
      select ${address}, ${agent}, ${deposit}, ${usd}, ${unlock}, 'locked'
      where (select coalesce(sum(usd), 0) from fund_bonuses where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc') + ${usd} <= ${cfg.bonusDailyBudget}
      on conflict (wallet) do nothing`;
  }
  await payBonus(cfg, address).catch((e) => console.error("[fund] bonus payment failed:", e));
  const [row] = await sql`select * from fund_bonuses where wallet = ${address}`;
  return row ? toBonus(row) : null;
}

/** Pays the bonus once its lock has passed, provided the deposit that earned it is still in. */
export async function payBonus(cfg: FundConfig, address: string): Promise<void> {
  const on = live(cfg);
  if (!on) return;
  const sql = await db();
  const [bonus] = await sql`select * from fund_bonuses where wallet = ${address} and status = 'locked' and unlock_at <= now()`;
  if (!bonus) return;
  const [pos] = await sql`select principal from fund_positions where wallet = ${address} and agent = ${bonus.agent}`;
  if (num(pos?.principal) < num(bonus.deposit_usd) - 0.01) return;
  if ((await treasuryBalance(on.conn, cfg.chain, on.treasury)) < num(bonus.usd)) return;

  const signed = await signTransfer(on.conn, cfg.chain, on.treasury, new PublicKey(address), num(bonus.usd));
  const claimed = await sql`
    update fund_bonuses set status = 'paying', signature = ${signed.signature}, last_valid_block_height = ${signed.lastValidBlockHeight}
    where wallet = ${address} and status = 'locked' returning wallet`;
  if (claimed.length === 0) return;
  await broadcast(on.conn, signed);
  await sql`update fund_bonuses set status = 'paid' where wallet = ${address} and status = 'paying'`;
}

// --- withdraw ---

const WITHDRAW = "Withdraw";
const fields = (address: string, agent: AgentId, percent: number) => ({ Wallet: address, Agent: AGENTS[agent].name, Percent: String(percent) });

export function withdrawChallenge(wallet: PublicKey, agent: AgentId, percent: number) {
  return issueMessage(WITHDRAW, `Withdraw ${percent}% of your funding from ${AGENTS[agent].name}.`, fields(wallet.toBase58(), agent, percent));
}

export async function withdraw(
  wallet: PublicKey,
  agent: AgentId,
  percent: number,
  message: string,
  token: string,
  signatureB64: string,
): Promise<FundResult<{ signature: string; gross: number; fee: number; received: number; pending: boolean }>> {
  const cfg = fundConfig();
  const on = live(cfg);
  if (!on) return fail(cfg.reason ?? "Funding is not available.");
  const address = wallet.toBase58();

  const problem = checkMessage(message, token, WITHDRAW, fields(address, agent, percent));
  if (problem) return fail(problem);
  if (!verifySignature(wallet, message, signatureB64)) return fail("The signature doesn't match this wallet.");
  const nonce = message.match(/^Nonce: (.+)$/m)?.[1] ?? "";

  const sql = await db();
  await settle(address);
  if ((await sql`select 1 from fund_events where nonce = ${nonce}`).length) return fail("This withdrawal request was already used. Start again.");

  type Out = FundResult<{ signed: Awaited<ReturnType<typeof signTransfer>>; gross: number; fee: number; received: number }>;
  const reserved = await withBooks<Out>(async (state, prices, version) => {
    const [pos] = await sql`select shares, principal from fund_positions where wallet = ${address} and agent = ${agent}`;
    const held = num(pos?.shares);
    if (held <= DUST) return { done: true, value: fail(`You have no funding in ${AGENTS[agent].name}.`) };

    const shares = percent >= 100 ? held : (held * percent) / 100;
    const principal = percent >= 100 ? num(pos.principal) : cents((num(pos.principal) * percent) / 100);
    const out = fundOut(state.portfolio, agent, shares, prices);
    if (!out.ok) {
      return {
        done: true,
        value: fail(
          `${AGENTS[agent].name} has $${out.freeUsd.toFixed(2)} free right now; the rest is in open positions. Withdraw a smaller share, or wait for the position to close.`,
        ),
      };
    }
    const fee = withdrawFee(cfg.terms, out.usd);
    const received = cents(out.usd - fee);
    if (received <= 0) return { done: true, value: fail(`After the $${fee.toFixed(2)} route fee there would be nothing left to send.`) };
    if ((await treasuryBalance(on.conn, cfg.chain, on.treasury)) < received) return { done: true, value: fail("The treasury can't cover this withdrawal right now. Try again later.") };

    const signed = await signTransfer(on.conn, cfg.chain, on.treasury, wallet, received);
    const next = trimmed({ ...state, portfolio: out.portfolio });
    const rows = await sql.query(
      `with upd as (
         update council_state set data = $1::jsonb, version = version + 1, updated_at = now()
         where id = 1 and version = $2
           and exists (select 1 from fund_positions where wallet = $3 and agent = $4 and shares >= $5::numeric - 0.000000001)
         returning 1
       ), pos as (
         update fund_positions set shares = greatest(shares - $5::numeric, 0), principal = greatest(principal - $6::numeric, 0), updated_at = now()
         where wallet = $3 and agent = $4 and exists (select 1 from upd)
       ), ev as (
         insert into fund_events (wallet, agent, kind, usd, fee, shares, nav, principal, status, signature, last_valid_block_height, nonce)
         select $3, $4, 'withdraw', $7, $8, $5, $9, $6, 'pending', $10, $11, $12 from upd
       ), lost as (
         -- Taking the deposit out before the lock ends gives up the bonus.
         update fund_bonuses set status = 'forfeited'
         where wallet = $3 and agent = $4 and status = 'locked' and unlock_at > now() and exists (select 1 from upd)
       )
       select (select count(*) from upd)::int as ok`,
      [JSON.stringify(next), version, address, agent, shares, principal, out.usd, fee, out.nav, signed.signature, signed.lastValidBlockHeight, nonce],
    );
    return rows[0].ok === 1 ? { done: true, value: { ok: true, signed, gross: out.usd, fee, received } } : { done: false };
  });
  if (!reserved.ok) return reserved;

  const { signed, gross, fee, received } = reserved;
  try {
    await broadcast(on.conn, signed);
    await sql`update fund_events set status = 'done' where signature = ${signed.signature}`;
    return { ok: true, signature: signed.signature, gross, fee, received, pending: false };
  } catch (e) {
    console.error("[fund] withdrawal did not confirm:", e);
    await settle(address).catch(() => {});
    const [event] = await sql`select status from fund_events where signature = ${signed.signature}`;
    if (event?.status === "failed") return fail("The payment didn't go through. Your funding was put back; you can try again.");
    return { ok: true, signature: signed.signature, gross, fee, received, pending: event?.status !== "done" };
  }
}

// --- recovery ---

/**
 * Resolves payments left undecided by a timeout or crash: marks them done if they
 * landed, and puts the money back on the books if they provably never will.
 */
export async function settle(address: string): Promise<void> {
  const cfg = fundConfig();
  const on = live(cfg);
  if (!on) return;
  const sql = await db();

  const pending = await sql`select * from fund_events where wallet = ${address} and kind = 'withdraw' and status = 'pending'`;
  for (const ev of pending) {
    const outcome = await fate(on.conn, ev.signature as string, num(ev.last_valid_block_height));
    if (outcome === "landed") await sql`update fund_events set status = 'done' where id = ${ev.id} and status = 'pending'`;
    if (outcome !== "dead") continue;

    const agent = ev.agent as AgentId;
    await withBooks(async (state, _prices, version) => {
      const p = state.portfolio;
      const next = trimmed({
        ...state,
        portfolio: {
          ...p,
          cash: { ...p.cash, [agent]: cents(p.cash[agent] + num(ev.usd)) },
          capital: { ...p.capital, [agent]: cents(p.capital[agent] + num(ev.usd)) },
          shares: { ...p.shares, [agent]: p.shares[agent] + num(ev.shares) },
        },
      });
      const rows = await sql.query(
        `with upd as (
           update council_state set data = $1::jsonb, version = version + 1, updated_at = now()
           where id = 1 and version = $2 and exists (select 1 from fund_events where id = $3 and status = 'pending')
           returning 1
         ), ev as (
           update fund_events set status = 'failed' where id = $3 and exists (select 1 from upd)
         ), pos as (
           update fund_positions set shares = shares + $4::numeric, principal = principal + $5::numeric, updated_at = now()
           where wallet = $6 and agent = $7 and exists (select 1 from upd)
         )
         select (select count(*) from upd)::int as ok, exists (select 1 from fund_events where id = $3 and status = 'pending') as open`,
        [JSON.stringify(next), version, ev.id, ev.shares, ev.principal, address, agent],
      );
      return rows[0].ok === 1 || !rows[0].open ? { done: true, value: null } : { done: false };
    });
  }

  const [paying] = await sql`select * from fund_bonuses where wallet = ${address} and status = 'paying'`;
  if (paying) {
    const outcome = await fate(on.conn, paying.signature as string, num(paying.last_valid_block_height));
    if (outcome === "landed") await sql`update fund_bonuses set status = 'paid' where wallet = ${address} and status = 'paying'`;
    if (outcome === "dead") await sql`update fund_bonuses set status = 'locked', signature = null where wallet = ${address} and status = 'paying'`;
  }
  await payBonus(cfg, address).catch((e) => console.error("[fund] bonus payment failed:", e));
}

// --- faucet ---

/** Hands out free test tokens so the demo needs nothing from outside. Devnet only. */
export async function faucet(wallet: PublicKey): Promise<FundResult<{ signature: string; usd: number }>> {
  const cfg = fundConfig();
  const on = live(cfg);
  if (!on) return fail(cfg.reason ?? "Funding is not available.");
  if (!cfg.faucet) return fail("This server does not hand out test tokens.");
  const address = wallet.toBase58();
  const sql = await db();

  const mint = await getMint(on.conn, cfg.chain.mint);
  if (!mint.mintAuthority?.equals(on.treasury.publicKey)) return fail("The treasury can't mint this token, so the faucet is unavailable.");

  const { blockhash, lastValidBlockHeight } = await on.conn.getLatestBlockhash("confirmed");
  const dest = getAssociatedTokenAddressSync(cfg.chain.mint, wallet);
  const tx = new Transaction({ feePayer: on.treasury.publicKey, blockhash, lastValidBlockHeight }).add(
    createAssociatedTokenAccountIdempotentInstruction(on.treasury.publicKey, dest, wallet, cfg.chain.mint),
    createMintToCheckedInstruction(cfg.chain.mint, dest, on.treasury.publicKey, units(cfg.faucetAmount), USDC_DECIMALS),
  );
  tx.sign(on.treasury);
  const signature = bs58.encode(tx.signature!);

  // One statement checks the daily limit and records the grant.
  const granted = await sql`
    insert into fund_events (wallet, kind, usd, status, signature, last_valid_block_height)
    select ${address}, 'faucet', ${cfg.faucetAmount}, 'pending', ${signature}, ${lastValidBlockHeight}
    where not exists (
      select 1 from fund_events
      where wallet = ${address} and kind = 'faucet' and status <> 'failed' and created_at > now() - make_interval(hours => ${FAUCET_GAP_HOURS})
    )
    returning id`;
  if (granted.length === 0) return fail(`You already received test tokens in the last ${FAUCET_GAP_HOURS} hours.`);

  try {
    await broadcast(on.conn, { tx, signature, blockhash, lastValidBlockHeight });
    await sql`update fund_events set status = 'done' where id = ${granted[0].id}`;
    return { ok: true, signature, usd: cfg.faucetAmount };
  } catch (e) {
    console.error("[fund] faucet failed:", e);
    await sql`update fund_events set status = 'failed' where id = ${granted[0].id}`;
    return fail("The network did not accept the faucet transfer. Try again.");
  }
}
