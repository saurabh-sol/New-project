import { withdraw, withdrawChallenge } from "@/server/fund/service";
import { isAgentId } from "@/server/rewards/challenge";
import { fail } from "@/server/rewards/http";

export const maxDuration = 120;

interface Body {
  step?: unknown;
  wallet?: unknown;
  agent?: unknown;
  percent?: unknown;
  message?: unknown;
  token?: unknown;
  signature?: unknown;
}

const PERCENTS = [25, 50, 75, 100];

/** Two steps: "challenge" returns a message for the wallet to sign, "submit" checks it and pays out. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!isAgentId(body?.agent)) return fail(400, "Pick an agent to withdraw from.");
  const percent = Number(body.percent);
  if (!PERCENTS.includes(percent)) return fail(400, "Choose 25, 50, 75 or 100 percent.");

  if (body.step === "challenge") {
    const result = withdrawChallenge(body.wallet, body.agent, percent);
    return Response.json(result, { status: result.ok ? 200 : 400 });
  }

  if (body.step === "submit") {
    const { message, token, signature } = body;
    if (typeof message !== "string" || typeof token !== "string" || typeof signature !== "string") {
      return fail(400, "The signed message is missing. Start again.");
    }
    const result = await withdraw(body.wallet, body.agent, percent, message, token, signature);
    return Response.json(result, { status: result.ok ? 200 : 400 });
  }

  return fail(400, "Unknown step.");
}
