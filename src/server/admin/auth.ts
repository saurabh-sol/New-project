import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * The admin's account. There is one, and it is set in the server's environment:
 * ADMIN_USERNAME, ADMIN_PASSWORD_HASH (made by scripts/admin-password.mjs, never the
 * password itself) and ADMIN_SESSION_SECRET, which signs the cookie a signed-in browser keeps.
 */

export const ADMIN_COOKIE = "council_admin";
/** A display stays signed in for this long after it was last used. */
export const SESSION_DAYS = 90;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
/** A session this old is given a fresh cookie when it is next used, so a display in use never runs out. */
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;

const KEY_BYTES = 32;
const WORK = 16384;

export interface AdminSession {
  user: string;
  /** When the cookie was signed, and when it stops being accepted. */
  since: number;
  until: number;
}

interface Account {
  username: string;
  hash: string;
  secret: string;
}

function account(env: NodeJS.ProcessEnv = process.env): Account | null {
  const username = env.ADMIN_USERNAME?.trim();
  const hash = env.ADMIN_PASSWORD_HASH?.trim();
  const secret = env.ADMIN_SESSION_SECRET?.trim();
  // A short secret could be guessed, and with it anyone could sign a cookie of their own.
  if (!username || !hash || !secret || secret.length < 32) return null;
  return { username, hash, secret };
}

/** Whether there is an admin account to sign in to. */
export const adminConfigured = (env: NodeJS.ProcessEnv = process.env) => account(env) !== null;

const derive = (password: string, salt: Buffer, work: number): Promise<Buffer> =>
  new Promise((resolve, reject) => scrypt(password, salt, KEY_BYTES, { N: work }, (err, key) => (err ? reject(err) : resolve(key))));

/** The form a password is kept in: `scrypt:<work>:<salt>:<key>`. It has no `$`, which an env file would read as a variable. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, WORK);
  return `scrypt:${WORK}:${salt.toString("base64url")}:${key.toString("base64url")}`;
}

async function matches(password: string, hash: string): Promise<boolean> {
  const [kind, work, salt, key] = hash.split(":");
  if (kind !== "scrypt" || !salt || !key) return false;
  const n = Number(work);
  if (!Number.isInteger(n) || n < 1024 || n > 1 << 20) return false;
  const wanted = Buffer.from(key, "base64url");
  if (wanted.length !== KEY_BYTES) return false;
  return timingSafeEqual(await derive(password, Buffer.from(salt, "base64url"), n), wanted);
}

const sign = (text: string, secret: string) => createHmac("sha256", secret).update(text).digest();

/** Compares two strings without the time taken saying where they differ. */
const same = (a: string, b: string, secret: string) => timingSafeEqual(sign(a, secret), sign(b, secret));

/** True if these are the admin's username and password. */
export async function checkLogin(username: string, password: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const acc = account(env);
  if (!acc) return false;
  // The password is checked even when the username is wrong, so both answers take as long.
  const [rightName, rightPassword] = [same(username, acc.username, acc.secret), await matches(password, acc.hash).catch(() => false)];
  return rightName && rightPassword;
}

/** The cookie a browser keeps once it has signed in. */
export function issue(user: string, now = Date.now(), env: NodeJS.ProcessEnv = process.env): { token: string; session: AdminSession } {
  const acc = account(env);
  if (!acc) throw new Error("No admin account is configured");
  const session: AdminSession = { user, since: now, until: now + SESSION_MS };
  const body = Buffer.from(JSON.stringify(session)).toString("base64url");
  return { token: `${body}.${sign(body, acc.secret).toString("base64url")}`, session };
}

/** The session a cookie stands for. Null if it was not signed here, has run out, or names someone who is not the admin. */
export function read(token: string | undefined, now = Date.now(), env: NodeJS.ProcessEnv = process.env): AdminSession | null {
  const acc = account(env);
  if (!acc || !token) return null;
  const [body, signature, more] = token.split(".");
  if (!body || !signature || more !== undefined) return null;
  const given = Buffer.from(signature, "base64url");
  const wanted = sign(body, acc.secret);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString()) as Partial<AdminSession>;
    if (typeof s.user !== "string" || typeof s.since !== "number" || typeof s.until !== "number") return null;
    // Changing the username signs everyone out, as changing the secret does.
    if (s.user !== acc.username || s.until <= now || s.since > now + 60_000) return null;
    return { user: s.user, since: s.since, until: s.until };
  } catch {
    return null;
  }
}

export const dueForRenewal = (s: AdminSession, now = Date.now()) => now - s.since > RENEW_AFTER_MS;

export const cookieOptions = (env: NodeJS.ProcessEnv = process.env) => ({
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MS / 1000,
});

// --- wrong guesses ---

const MAX_TRIES = 5;
const WINDOW_MS = 15 * 60 * 1000;
/** Wrong guesses from everywhere at once. Past this, nobody is let in to try until the window has passed. */
const MAX_TRIES_BY_ALL = 40;
const EVERYONE = "*";

const shared = globalThis as typeof globalThis & { __adminTries?: Map<string, { count: number; since: number }> };
const tries = () => (shared.__adminTries ??= new Map());

function left(key: string, most: number, now: number): number {
  const t = tries().get(key);
  if (!t || now - t.since >= WINDOW_MS) return 0;
  return t.count >= most ? t.since + WINDOW_MS - now : 0;
}

/** How long this address must wait before it may try again, in ms. Zero if it may try now. */
export const mustWait = (ip: string, now = Date.now()) => Math.max(left(ip, MAX_TRIES, now), left(EVERYONE, MAX_TRIES_BY_ALL, now));

export function noteWrongGuess(ip: string, now = Date.now()) {
  const all = tries();
  for (const key of [ip, EVERYONE]) {
    const t = all.get(key);
    if (!t || now - t.since >= WINDOW_MS) all.set(key, { count: 1, since: now });
    else t.count++;
  }
  // Addresses that stopped trying are forgotten, so the list cannot grow without end.
  if (all.size > 5000) for (const [key, t] of all) if (now - t.since >= WINDOW_MS) all.delete(key);
}

export const forgetGuesses = (ip: string) => void tries().delete(ip);
