/**
 * Funding an agent: deposits, withdrawals, the first-deposit bonus and the testnet faucet.
 * Everything that touches the network sits behind `Chain`.
 *
 * Every change to a user's balance is written in the same database statement as the
 * change to the agent's books, guarded by the state's version, so the two can't drift apart.
 * Every payout records its id before it is sent, so a crash can't pay twice.
 */
import { randomBytes } from "node:crypto";
import { AGENT_ORDER, AGENTS } from "@/lib/agents";
import type { TradeRequest } from "@/lib/assets";
import type { DepositProof, PreparedDeposit } from "@/lib/chains";
import { agentNav, fundIn, fundOut, userFunding, type Portfolio } from "@/lib/council";
import { bonusFor, withdrawFee } from "@/lib/funding";
import type { AgentFunding, FundBonus, FundEvent, FundPosition, FundResult, FundStatus } from "@/lib/funding-types";
import type { Prices } from "@/lib/market";
import type { AgentId } from "@/lib/types";
import { chain as network, chainFor, type Chain } from "../chains";
import { releaseForPayment, settleOnChain } from "../chains/desk";
import { FUNDING_LEVELS, fundingLevel } from "../council/skills";
import { deskPrices } from "../council/stats";
import { inTurn, readVersioned, trimmed, type CouncilState } from "../council/store";
import { db, num } from "../db";
import { checkRequest, openRequest, requestsFor, type PendingRequest } from "../requests/service";
import { checkMessage, issueMessage } from "../rewards/challenge";
import { fundConfig, type FundConfig } from "./config";

type Row = Record<string, unknown>;

const INTENT_TTL_MS = 10 * 60_000;
const FAUCET_GAP_HOURS = 24;
const MAX_ATTEMPTS = 6;
const DUST = 1e-9;

const cents = (n: number) => Math.round(n * 100) / 100;
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const NOT_A_WALLET = "That doesn't look like a wallet address.";

/** The wallet's address in standard form, once funding is known to be working. */
async function ready(wallet: unknown): Promise<{ ok: true; chain: Chain; address: string } | { ok: false; error: string }> {
  const found = chainFor(wallet);
  if (!found) return fail(NOT_A_WALLET);
  const status = await found.chain.status();
  if (!status.enabled) return fail(status.reason ?? "Funding is not available.");
  return { ok: true, ...found };
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

const toBonus = (r: Row): FundBonus => {
  const unlockAt = new Date(r.unlock_at as string).getTime();
  return {
    usd: num(r.usd),
    depositUsd: num(r.deposit_usd),
    agent: r.agent as AgentId,
    unlockAt,
    status: r.status as FundBonus["status"],
    signature: (r.signature as string | null) ?? null,
    // A withdrawal before the lock ends gives the bonus up, so one still locked here was kept in all the while.
    claimable: r.status === "locked" && unlockAt <= Date.now(),
    waitUntil: null,
  };
};

/**
 * One bonus is claimed from an address on the network per cooldown, whichever wallet asks.
 * Returns when `ip` may claim again, if another wallet claimed from it inside the cooldown, and null if it may claim now.
 */
async function coolingUntil(address: string, ip: string, hours: number): Promise<number | null> {
  if (hours <= 0) return null;
  const sql = await db();
  const [row] = await sql`
    select max(claimed_at) as at from fund_bonuses
    where claim_ip = ${ip} and wallet <> ${address} and status in ('paying', 'paid') and claimed_at > now() - make_interval(secs => ${hours * 3600})`;
  return row?.at ? new Date(row.at as string).getTime() + hours * 3_600_000 : null;
}

/** The wallet's bonus as it stands, or null if it never earned one. `ip` is where the wallet is asking from, if it is asking. */
async function bonusOf(address: string, ip?: string): Promise<FundBonus | null> {
  const sql = await db();
  // With no lock, a bonus promised under an earlier lock can be claimed now.
  if (fundConfig().terms.bonusLockHours === 0) await sql`update fund_bonuses set unlock_at = now() where wallet = ${address} and status = 'locked' and unlock_at > now()`;
  const [row] = await sql`select * from fund_bonuses where wallet = ${address}`;
  if (!row) return null;
  const bonus = toBonus(row);
  if (ip && bonus.status === "locked") bonus.waitUntil = await coolingUntil(address, ip, fundConfig().terms.bonusCooldownHours);
  return bonus;
}


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

/** `ip` is where the request came from. The wallet's bonus is shown as that address on the network may claim it. */
export async function fundStatus(wallet: unknown, ip?: string): Promise<FundStatus> {
  const cfg = fundConfig();
  const { state } = await readVersioned();
  const [prices, chain] = await Promise.all([deskPrices(state).catch(() => ({}) as Prices), network().status()]);
  const found = chainFor(wallet);

  const base: FundStatus = { chain, terms: cfg.terms, agents: agentView(state.portfolio, prices), wallet: null };
  if (!found || !chain.enabled) return base;

  const { address } = found;
  await resolvePayments(found.chain, address).catch((e) => console.error("[fund] settle failed:", e));
  const sql = await db();
  const [positions, bonus, events, balance, requests] = await Promise.all([
    sql`select * from fund_positions where wallet = ${address} and shares > ${DUST}`,
    bonusOf(address, ip),
    sql`select * from fund_events where wallet = ${address} order by id desc limit 12`,
    found.chain.balance(address),
    requestsFor(address),
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
      bonus,
      bonusAvailable: bonus === null,
      events: events.map(toEvent),
      requests,
    },
  };
}

// --- deposit ---

/** `token` is the address of a token the funder asks the agent to trade, if they ask for one. */
export async function prepareDeposit(
  wallet: unknown,
  agent: AgentId,
  usd: number,
  token?: unknown,
): Promise<FundResult<{ intentId: string; deposit: PreparedDeposit; request: PendingRequest | null }>> {
  const on = await ready(wallet);
  if (!on.ok) return on;
  const { chain, address } = on;
  const { terms } = fundConfig();
  const amount = cents(usd);
  if (!isFinite(amount) || amount < terms.minDeposit) return fail(`The smallest deposit is $${terms.minDeposit}.`);

  const sql = await db();
  const [pos] = await sql`select principal from fund_positions where wallet = ${address} and agent = ${agent}`;
  if (num(pos?.principal) + amount > terms.maxDeposit) return fail(`You can fund one agent with at most $${terms.maxDeposit}.`);

  const balance = await chain.balance(address);
  if (balance < amount) return fail(`Your wallet holds ${balance.toFixed(2)} of the funding token, which is less than $${amount.toFixed(2)}.`);

  let request: PendingRequest | null = null;
  if (token !== undefined && token !== null && token !== "") {
    const checked = await checkRequest(address, token, amount);
    if (!checked.ok) return checked;
    request = checked.request;
  }

  const { payload, check } = await chain.prepareDeposit(address, amount);
  const intentId = randomBytes(12).toString("hex");
  await sql`
    insert into fund_intents (id, wallet, agent, usd, status, expires_at, message_hash, request)
    values (${intentId}, ${address}, ${agent}, ${amount}, 'pending', ${new Date(Date.now() + INTENT_TTL_MS).toISOString()}, ${check}, ${request ? JSON.stringify(request) : null}::jsonb)`;
  return { ok: true, intentId, deposit: payload, request };
}

/**
 * Runs `work` against the latest books. `work` saves the books and the user's records
 * in one statement; if the books changed underneath, it reports not done and runs again.
 */
async function withBooks<T>(work: (state: CouncilState, prices: Prices, version: number) => Promise<{ done: true; value: T } | { done: false }>): Promise<T> {
  return inTurn(async () => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { state, version } = await readVersioned();
      const result = await work(state, await deskPrices(state), version);
      if (result.done) return result.value;
    }
    throw new Error("The agent's books changed too often to complete this. Try again.");
  });
}

export async function confirmDeposit(
  intentId: string,
  proof: DepositProof,
): Promise<FundResult<{ signature: string; usd: number; shares: number; nav: number; bonus: FundBonus | null; request: TradeRequest | null }>> {
  const sql = await db();
  const [intent] = await sql`select * from fund_intents where id = ${intentId}`;
  if (!intent) return fail("This deposit request was not found. Start again.");
  const on = await ready(intent.wallet);
  if (!on.ok) return on;
  const { chain, address } = on;
  const agent = intent.agent as AgentId;
  const usd = num(intent.usd);

  // A request that was never paid is dropped after a while. One that was paid is honoured whenever it is confirmed.
  const expired = intent.status === "pending" && new Date(intent.expires_at as string).getTime() < Date.now();
  const settled = await chain.settleDeposit({ wallet: address, usd, check: intent.message_hash as string, createdAt: new Date(intent.created_at as string).getTime() }, proof);
  if (!settled.ok) return fail(expired ? "This deposit request expired. Start again." : settled.error);
  const signature = settled.id;

  await withBooks(async (state, prices, version) => {
    const inn = fundIn(state.portfolio, agent, usd, prices);
    const next = trimmed({ ...state, portfolio: inn.portfolio });
    const rows = await sql.query(
      `with upd as (
         update council_state set data = $1::jsonb, version = version + 1, updated_at = now()
         where id = 1 and version = $2
           and not exists (select 1 from fund_events where signature = $8)
           and exists (select 1 from fund_intents where id = $9 and status = 'pending')
         returning 1
       ), ev as (
         insert into fund_events (wallet, agent, kind, usd, shares, nav, principal, status, signature, intent)
         select $3, $4, 'deposit', $5, $6, $7, $5, 'done', $8, $9 from upd
       ), pos as (
         insert into fund_positions (wallet, agent, shares, principal)
         select $3, $4, $6, $5 from upd
         on conflict (wallet, agent) do update
           set shares = fund_positions.shares + excluded.shares, principal = fund_positions.principal + excluded.principal, updated_at = now()
       ), done as (
         update fund_intents set status = 'done' where id = $9 and exists (select 1 from upd)
       )
       select (select count(*) from upd)::int as ok,
              exists (select 1 from fund_events where signature = $8) as seen,
              exists (select 1 from fund_intents where id = $9 and status = 'done') as used`,
      [JSON.stringify(next), version, address, agent, usd, inn.shares, inn.nav, signature, intentId],
    );
    // Credited now, or by an earlier attempt.
    return rows[0].ok === 1 || rows[0].seen || rows[0].used ? { done: true, value: null } : { done: false };
  });

  // Each transfer pays for one request, and each request is paid by one transfer.
  const [event] = await sql`select shares, nav, intent from fund_events where signature = ${signature}`;
  if (!event) return fail("This deposit request was already paid by another transfer.");
  if (event.intent !== intentId) return fail("That transfer was already used for an earlier deposit.");
  // The agent's new cash is put behind it on-chain too, without holding up the answer.
  void settleOnChain(true);
  const bonus = await grantBonus(fundConfig(), address, agent, usd);
  // The deposit stands whether or not its request could be queued.
  const request = await openRequest(intent).catch((e) => (console.error("[fund] could not queue the trade request:", e), null));
  return { ok: true, signature, usd, shares: num(event.shares), nav: num(event.nav), bonus, request };
}

// --- bonus ---

/** Promises the first-deposit bonus, if this wallet has never had one and today's budget allows. It is paid when the wallet claims it. */
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
  return bonusOf(address);
}

/**
 * Sends a bonus whose lock has passed, to a wallet asking from `ip`. "short" means the treasury holds less than the bonus.
 * The claim and the address it came from are written in one statement, which also refuses it if another
 * wallet claimed from that address inside the cooldown: two wallets asking at once can't both get through.
 */
async function payBonus(chain: Chain, address: string, ip: string, cooldownHours: number): Promise<"paid" | "short" | "none"> {
  const sql = await db();
  // This server's clock, as `claimable` is reckoned by it.
  const [bonus] = await sql`select * from fund_bonuses where wallet = ${address} and status = 'locked' and unlock_at <= ${new Date().toISOString()}`;
  if (!bonus) return "none";

  return chain.withTreasury(async () => {
    if ((await chain.treasuryBalance()) < num(bonus.usd)) return "short";
    const signed = await chain.signPayment(address, num(bonus.usd));
    const claimed = await sql`
      update fund_bonuses set status = 'paying', signature = ${signed.id}, last_valid_block_height = ${signed.expiry}, claim_ip = ${ip}, claimed_at = now()
      where wallet = ${address} and status = 'locked'
        and not exists (
          select 1 from fund_bonuses other
          where other.claim_ip = ${ip} and other.wallet <> ${address} and other.status in ('paying', 'paid')
            and other.claimed_at > now() - make_interval(secs => ${cooldownHours * 3600})
        )
      returning wallet`;
    if (claimed.length === 0) return "none";
    await signed.send();
    await sql`update fund_bonuses set status = 'paid' where wallet = ${address} and status = 'paying'`;
    return "paid";
  });
}

/**
 * Pays a wallet its first-deposit bonus, when the wallet asks for it. The bonus can only go to
 * the wallet that earned it, so the request needs no signature. `ip` is where the request came
 * from: a second wallet asking from the same address waits out the cooldown.
 */
export async function claimBonus(wallet: unknown, ip: string): Promise<FundResult<{ bonus: FundBonus }>> {
  const on = await ready(wallet);
  if (!on.ok) return on;
  const { chain, address } = on;
  const cooldown = fundConfig().terms.bonusCooldownHours;
  const cooling = (until: number) => fail(`A bonus was already claimed from this network by another wallet. Yours can be claimed from ${new Date(until).toUTCString()}.`);

  await resolvePayments(chain, address);
  const bonus = await bonusOf(address, ip);
  if (!bonus) return fail("This wallet has no bonus to claim. A bonus comes with a wallet's first deposit.");
  if (bonus.status === "paid") return { ok: true, bonus };
  if (bonus.status === "forfeited") return fail("This bonus was given up by withdrawing before it unlocked.");
  if (bonus.status === "paying") return fail("Your bonus is on its way. Look again in a minute.");
  if (!bonus.claimable) return fail(`Your bonus is still locked. It can be claimed from ${new Date(bonus.unlockAt).toUTCString()}.`);
  if (bonus.waitUntil) return cooling(bonus.waitUntil);

  try {
    if ((await payBonus(chain, address, ip, cooldown)) === "short") return fail("The bonus can't be paid right now. Nothing was sent; try again later.");
  } catch (e) {
    // The payment may or may not have landed. The chain is asked before the wallet is told anything.
    console.error("[fund] bonus payment did not confirm:", e);
    await resolvePayments(chain, address).catch(() => {});
  }
  const after = await bonusOf(address, ip);
  if (after && (after.status === "paid" || after.status === "paying")) return { ok: true, bonus: after };
  // Another wallet at the same address got in first.
  if (after?.waitUntil) return cooling(after.waitUntil);
  return fail("The payment didn't go through. Nothing was sent; you can claim again.");
}

// --- withdraw ---

const WITHDRAW = "Withdraw";
const fields = (address: string, agent: AgentId, percent: number) => ({ Wallet: address, Agent: AGENTS[agent].name, Percent: String(percent) });

export function withdrawChallenge(wallet: unknown, agent: AgentId, percent: number): FundResult<{ message: string; token: string }> {
  const found = chainFor(wallet);
  if (!found) return fail(NOT_A_WALLET);
  return { ok: true, ...issueMessage(WITHDRAW, `Withdraw ${percent}% of your funding from ${AGENTS[agent].name}.`, fields(found.address, agent, percent)) };
}

export async function withdraw(
  wallet: unknown,
  agent: AgentId,
  percent: number,
  message: string,
  token: string,
  signature: string,
): Promise<FundResult<{ signature: string; gross: number; fee: number; received: number; pending: boolean }>> {
  const on = await ready(wallet);
  if (!on.ok) return on;
  const { chain, address } = on;
  const { terms } = fundConfig();

  const problem = checkMessage(message, token, WITHDRAW, fields(address, agent, percent));
  if (problem) return fail(problem);
  if (!(await chain.verify(address, message, signature))) return fail("The signature doesn't match this wallet.");
  const nonce = message.match(/^Nonce: (.+)$/m)?.[1] ?? "";

  const sql = await db();
  await resolvePayments(chain, address);
  if ((await sql`select 1 from fund_events where nonce = ${nonce}`).length) return fail("This withdrawal request was already used. Start again.");

  // The treasury is held from signing to sending, so payments leave in the order they were signed.
  return chain.withTreasury(async () => {
    type Reserved = FundResult<{ signed: Awaited<ReturnType<Chain["signPayment"]>>; gross: number; fee: number; received: number }>;
    const reserved = await withBooks<Reserved>(async (state, prices, version) => {
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
      const fee = withdrawFee(terms, out.usd);
      const received = cents(out.usd - fee);
      if (received <= 0) return { done: true, value: fail(`After the $${fee.toFixed(2)} route fee there would be nothing left to send.`) };
      // The agent's cash is held on its contract. What the treasury is short of is released from there first.
      let inTreasury = await chain.treasuryBalance();
      if (inTreasury < received) {
        await releaseForPayment(agent, received - inTreasury).catch((e) => console.error("[fund] could not release cash for a withdrawal:", e instanceof Error ? e.message.split("\n")[0] : e));
        inTreasury = await chain.treasuryBalance();
      }
      if (inTreasury < received) return { done: true, value: fail("The treasury can't cover this withdrawal right now. Try again later.") };

      const signed = await chain.signPayment(address, received);
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
        [JSON.stringify(next), version, address, agent, shares, principal, out.usd, fee, out.nav, signed.id, signed.expiry, nonce],
      );
      return rows[0].ok === 1 ? { done: true, value: { ok: true, signed, gross: out.usd, fee, received } } : { done: false };
    });
    if (!reserved.ok) return reserved;

    const { signed, gross, fee, received } = reserved;
    try {
      await signed.send();
      await sql`update fund_events set status = 'done' where signature = ${signed.id}`;
      void settleOnChain(true);
      return { ok: true, signature: signed.id, gross, fee, received, pending: false };
    } catch (e) {
      console.error("[fund] withdrawal did not confirm:", e);
      await resolvePayments(chain, address).catch(() => {});
      const [event] = await sql`select status from fund_events where signature = ${signed.id}`;
      if (event?.status === "failed") return fail("The payment didn't go through. Your funding was put back; you can try again.");
      return { ok: true, signature: signed.id, gross, fee, received, pending: event?.status !== "done" };
    }
  });
}

// --- recovery ---

const age = (row: Row) => Date.now() - new Date(row.created_at as string).getTime();

/**
 * Resolves payments left undecided by a timeout or crash: marks them done if they
 * landed, and puts the money back on the books if they provably never will.
 */
async function resolvePayments(chain: Chain, address: string): Promise<void> {
  const sql = await db();

  const pending = await sql`select * from fund_events where wallet = ${address} and kind = 'withdraw' and status = 'pending'`;
  for (const ev of pending) {
    const outcome = await chain.fate(ev.signature as string, num(ev.last_valid_block_height), age(ev));
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
    const outcome = await chain.fate(paying.signature as string, num(paying.last_valid_block_height), age(paying));
    if (outcome === "landed") await sql`update fund_bonuses set status = 'paid' where wallet = ${address} and status = 'paying'`;
    // A claim that was never paid does not count against the address it came from.
    if (outcome === "dead") await sql`update fund_bonuses set status = 'locked', signature = null, claim_ip = null, claimed_at = null where wallet = ${address} and status = 'paying'`;
  }
}

// --- faucet ---

/** Hands out free test tokens so the demo needs nothing from outside. Testnets only. */
export async function faucet(wallet: unknown): Promise<FundResult<{ signature: string; usd: number }>> {
  const on = await ready(wallet);
  if (!on.ok) return on;
  const { chain, address } = on;
  const status = await chain.status();
  if (!status.faucet) return fail(`Free test tokens are not available on ${status.network}.`);
  const sql = await db();

  return chain.withTreasury(async () => {
    const signed = await chain.signFaucet(address, status.faucetAmount);
    // One statement checks the daily limit and records the grant.
    const granted = await sql`
      insert into fund_events (wallet, kind, usd, status, signature, last_valid_block_height)
      select ${address}, 'faucet', ${status.faucetAmount}, 'pending', ${signed.id}, ${signed.expiry}
      where not exists (
        select 1 from fund_events
        where wallet = ${address} and kind = 'faucet' and status <> 'failed' and created_at > now() - make_interval(hours => ${FAUCET_GAP_HOURS})
      )
      returning id`;
    if (granted.length === 0) return fail(`You already received test tokens in the last ${FAUCET_GAP_HOURS} hours.`);

    try {
      await signed.send();
      await sql`update fund_events set status = 'done' where id = ${granted[0].id}`;
      return { ok: true, signature: signed.id, usd: status.faucetAmount };
    } catch (e) {
      console.error("[fund] faucet failed:", e);
      await sql`update fund_events set status = 'failed' where id = ${granted[0].id}`;
      return fail("The network did not accept the faucet transfer. Try again.");
    }
  });
}
