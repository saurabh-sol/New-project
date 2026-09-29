import type { DepositProof } from "@/lib/chains";
import { confirmDeposit, prepareDeposit } from "@/server/fund/service";
import { isAgentId } from "@/server/rewards/challenge";
import { fail } from "@/server/rewards/http";

// Waits for the network to confirm the transfer.
export const maxDuration = 120;

interface Body {
  step?: unknown;
  wallet?: unknown;
  agent?: unknown;
  usd?: unknown;
  intentId?: unknown;
  proof?: unknown;
  /** Address of a token the funder asks the agent to trade. Optional. */
  token?: unknown;
}

function asProof(v: unknown): DepositProof | null {
  const p = v as { kind?: unknown; hash?: unknown } | null;
  if (p?.kind === "robinhood" && typeof p.hash === "string") return { kind: "robinhood", hash: p.hash as `0x${string}` };
  return null;
}

/** Two steps: "prepare" says what the wallet must do, "confirm" checks that it happened and credits the deposit. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Body | null;

  if (body?.step === "prepare") {
    if (!isAgentId(body.agent)) return fail(400, "Pick an agent to fund.");
    const usd = Number(body.usd);
    if (!isFinite(usd) || usd <= 0) return fail(400, "Enter an amount to deposit.");
    const result = await prepareDeposit(body.wallet, body.agent, usd, body.token);
    return Response.json(result, { status: result.ok ? 200 : 400 });
  }

  if (body?.step === "confirm") {
    const proof = asProof(body.proof);
    if (typeof body.intentId !== "string" || !proof) return fail(400, "The proof of transfer is missing. Start again.");
    const result = await confirmDeposit(body.intentId, proof);
    return Response.json(result, { status: result.ok ? 200 : 400 });
  }

  return fail(400, "Unknown step.");
}
