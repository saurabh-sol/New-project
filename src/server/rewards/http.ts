import type { ClaimRecord } from "@/lib/rewards-types";
import type { RewardsConfig } from "./config";
import type { Claim } from "./ledger";

export const fail = (status: number, error: string, extra?: object) => Response.json({ ok: false, error, ...extra }, { status });

export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

/** The parts of a claim that are safe to show the claimant. */
export const publicClaim = (c: Claim): ClaimRecord => ({
  status: c.status,
  signature: c.signature,
  amount: c.amount,
  agent: c.agent,
  ts: c.ts,
});

export async function passesCaptcha(cfg: RewardsConfig, token: unknown, ip: string): Promise<boolean> {
  if (!cfg.turnstileSecret) return true;
  if (typeof token !== "string" || !token) return false;
  const body = new URLSearchParams({ secret: cfg.turnstileSecret, response: token });
  if (ip !== "local") body.set("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  return res.ok && ((await res.json()) as { success?: boolean }).success === true;
}
