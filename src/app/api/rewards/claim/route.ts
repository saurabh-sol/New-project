import type { ClaimResponse } from "@/lib/rewards-types";
import { checkChallenge, isAgentId, parseWallet, verifySignature } from "@/server/rewards/challenge";
import { rewardsConfig } from "@/server/rewards/config";
import { clientIp, fail, passesCaptcha, publicClaim } from "@/server/rewards/http";
import { getClaim, reserveClaim, updateClaim } from "@/server/rewards/ledger";
import { connect, hasEnoughHistory, payReward, settlePending, treasuryBalance } from "@/server/rewards/payout";

interface Body {
  wallet?: unknown;
  agent?: unknown;
  message?: unknown;
  token?: unknown;
  signature?: unknown;
  captcha?: unknown;
}

const ok = (body: ClaimResponse) => Response.json(body);

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Body | null;
  const wallet = parseWallet(body?.wallet);
  if (!wallet) return fail(400, "That doesn't look like a Solana wallet address.");
  if (!isAgentId(body?.agent)) return fail(400, "Pick an agent to back first.");
  const { message, token, signature } = body ?? {};
  if (typeof message !== "string" || typeof token !== "string" || typeof signature !== "string") {
    return fail(400, "The signed message is missing. Start again.");
  }
  const address = wallet.toBase58();
  const agent = body.agent;

  const problem = checkChallenge(message, token, address, agent);
  if (problem) return fail(400, problem);
  if (!verifySignature(wallet, message, signature)) return fail(401, "The signature doesn't match this wallet.");

  const cfg = rewardsConfig();
  if (cfg.treasuryError) return fail(500, "Rewards are not set up correctly on the server.");
  const ip = clientIp(request);
  if (!(await passesCaptcha(cfg, body.captcha, ip))) return fail(403, "Captcha check failed. Try again.");

  // Demo mode: the wallet check above is real, but there is no treasury and nothing is sent.
  if (!cfg.treasury) return ok({ ok: true, mode: "demo", amount: cfg.amount });

  const conn = connect(cfg);
  try {
    const existing = await getClaim(address);
    const settled = existing ? await settlePending(conn, existing) : null;
    if (settled) return fail(409, "This wallet has already claimed its reward.", { claim: publicClaim(settled) });

    if (!(await hasEnoughHistory(conn, wallet, cfg.minWalletTxs))) {
      return fail(403, `Rewards are for wallets with at least ${cfg.minWalletTxs} past transactions. This one is too new.`);
    }
    if ((await treasuryBalance(conn, cfg, cfg.treasury)) < cfg.amount) {
      return fail(503, "The reward pool is empty right now. Check back later.");
    }
  } catch {
    return fail(503, "Can't reach the Solana network right now. Try again in a moment.");
  }

  const reserved = await reserveClaim({ wallet: address, agent, amount: cfg.amount, ip }, cfg);
  if (!reserved.ok) {
    if (reserved.reason === "claimed") {
      return fail(409, "This wallet has already claimed its reward.", reserved.claim && { claim: publicClaim(reserved.claim) });
    }
    if (reserved.reason === "daily_cap") return fail(429, "Today's rewards are all claimed. Come back tomorrow.");
    return fail(429, "Too many claims from this network today.");
  }

  try {
    await payReward(conn, cfg, cfg.treasury, wallet, cfg.amount);
    const claim = await updateClaim(address, { status: "sent" });
    return ok({ ok: true, mode: "live", cluster: cfg.cluster, claim: publicClaim(claim!) });
  } catch (e) {
    console.error("[rewards] payout did not confirm", address, e);
    // The transfer may or may not have landed. Ask the chain before telling the user anything.
    const claim = await getClaim(address);
    const settled = claim ? await settlePending(conn, claim).catch(() => claim) : null;
    if (!settled) return fail(502, "The payment didn't go through. Nothing was sent; you can try again.");
    return ok({ ok: true, mode: "live", cluster: cfg.cluster, claim: publicClaim(settled) });
  }
}
