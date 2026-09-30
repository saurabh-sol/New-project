/**
 * The numbers behind funding an agent. Pure functions, shared by server and UI,
 * so the estimate a user sees is the same arithmetic the server applies.
 */

export interface FundingTerms {
  minDeposit: number;
  maxDeposit: number;
  /** First-deposit bonus by deposit size, largest tier first. One bonus per wallet. */
  bonusTiers: Array<{ from: number; bonus: number }>;
  /** Route fee on withdrawal: the larger of a flat minimum and a percentage. */
  feeMin: number;
  feePct: number;
  /** Hours the deposit must stay in before the bonus is paid. 0 pays it straight after the deposit. */
  bonusLockHours: number;
  /** A trade request that comes with at least this much funding binds the agent to take the trade. */
  commitFrom: number;
}

export const DEFAULT_TERMS: FundingTerms = {
  minDeposit: 5,
  maxDeposit: 500,
  bonusTiers: [
    { from: 50, bonus: 4.5 },
    { from: 25, bonus: 3 },
    { from: 10, bonus: 2 },
    { from: 5, bonus: 1.3 },
  ],
  feeMin: 1,
  feePct: 2,
  bonusLockHours: 0,
  commitFrom: 20,
};

const cents = (n: number) => Math.round(n * 100) / 100;

export const bonusFor = (terms: FundingTerms, deposit: number) => terms.bonusTiers.find((t) => deposit >= t.from)?.bonus ?? 0;

export const withdrawFee = (terms: FundingTerms, amount: number) => cents(Math.min(amount, Math.max(terms.feeMin, (amount * terms.feePct) / 100)));

export interface Estimate {
  deposit: number;
  bonus: number;
  /** Value of the funding at withdrawal, given the agent's return. */
  valueAtExit: number;
  fee: number;
  /** What reaches the wallet on withdrawal. */
  received: number;
  /** Everything the user gets back, bonus included, minus what they put in. */
  net: number;
  /** What the round trip costs the platform: the bonus paid minus the fee collected. */
  platformCost: number;
}

/**
 * What a deposit comes to if the agent's value changes by `agentReturnPct` before the
 * user withdraws everything. `firstDeposit` says whether the wallet still qualifies for a bonus.
 */
export function estimate(terms: FundingTerms, deposit: number, agentReturnPct = 0, firstDeposit = true): Estimate {
  const bonus = firstDeposit ? bonusFor(terms, deposit) : 0;
  const valueAtExit = cents(deposit * (1 + agentReturnPct / 100));
  const fee = withdrawFee(terms, valueAtExit);
  const received = cents(valueAtExit - fee);
  return { deposit, bonus, valueAtExit, fee, received, net: cents(received + bonus - deposit), platformCost: cents(bonus - fee) };
}
