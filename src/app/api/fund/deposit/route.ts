import { confirmDeposit, prepareDeposit } from "@/server/fund/service";
import { isAgentId, parseWallet } from "@/server/rewards/challenge";
import { fail } from "@/server/rewards/http";

// Waits for the network to confirm the transfer.
export const maxDuration = 120;

interface Body {
  step?: unknown;
  wallet?: unknown;
  agent?: unknown;
  usd?: unknown;
  intentId?: unknown;
  transaction?: unknown;
}

/** Two steps: "prepare" returns a transfer for the wallet to sign, "confirm" sends it and credits the deposit. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Body | null;

  if (body?.step === "prepare") {
    const wallet = parseWallet(body.wallet);
    if (!wallet) return fail(400, "That doesn't look like a Solana wallet address.");
    if (!isAgentId(body.agent)) return fail(400, "Pick an agent to fund.");
    const usd = Number(body.usd);
    if (!isFinite(usd) || usd <= 0) return fail(400, "Enter an amount to deposit.");
    const result = await prepareDeposit(wallet, body.agent, usd);
    return Response.json(result, { status: result.ok ? 200 : 400 });
  }

  if (body?.step === "confirm") {
    if (typeof body.intentId !== "string" || typeof body.transaction !== "string") return fail(400, "The signed transfer is missing. Start again.");
    const result = await confirmDeposit(body.intentId, body.transaction);
    return Response.json(result, { status: result.ok ? 200 : 400 });
  }

  return fail(400, "Unknown step.");
}
