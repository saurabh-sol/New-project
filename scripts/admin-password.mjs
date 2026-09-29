#!/usr/bin/env node
/**
 * Makes the three settings of the admin account: the username, the password in the form it is
 * kept in (never the password itself), and the secret that signs the cookie of a signed-in browser.
 *
 *   node scripts/admin-password.mjs                     a password is made up for you
 *   node scripts/admin-password.mjs --user ops          the same, for another username
 *   node scripts/admin-password.mjs --ask               you type the password, unseen
 *   node scripts/admin-password.mjs --out .data/admin.env
 *
 * With --out, the settings and the password are written to that file and nothing secret is
 * printed. Keep the file out of git. Set the three ADMIN_ settings on the server, and keep
 * the password somewhere safe: it cannot be read back out of the hash.
 */
import { randomBytes, scrypt } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const WORK = 16384;
const MIN_LENGTH = 12;

function typed(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // What is typed is not shown.
    rl._writeToOutput = (text) => rl.output.write(text.includes(question) ? text : "");
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

/** Letters and digits that can't be mistaken for one another when read off a screen. */
function madeUp(length = 20) {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  while (out.length < length) {
    const byte = randomBytes(1)[0];
    // Bytes past the last whole run of the alphabet are thrown away, so every letter is as likely.
    if (byte < Math.floor(256 / letters.length) * letters.length) out += letters[byte % letters.length];
  }
  return out.replace(/(.{5})(?=.)/g, "$1-");
}

const user = value("--user") ?? "admin";
const password = flag("--ask") ? await typed("Password: ") : madeUp();
if (password.length < MIN_LENGTH) {
  console.error(`The password must have at least ${MIN_LENGTH} characters.`);
  process.exit(1);
}

const salt = randomBytes(16);
const key = await new Promise((resolve, reject) => scrypt(password, salt, 32, { N: WORK }, (err, k) => (err ? reject(err) : resolve(k))));
const settings = [
  `ADMIN_USERNAME=${user}`,
  `ADMIN_PASSWORD_HASH=scrypt:${WORK}:${salt.toString("base64url")}:${key.toString("base64url")}`,
  `ADMIN_SESSION_SECRET=${randomBytes(48).toString("base64url")}`,
];

const out = value("--out");
if (out) {
  writeFileSync(out, [`# The admin account of The Council. Made ${new Date().toISOString()}. Keep this file out of git.`, `# Sign in at /admin with the username below and this password:`, `# ${password}`, ...settings, ""].join("\n"), { mode: 0o600 });
  console.log(`Written to ${out}. The password is on its third line.`);
} else {
  if (!flag("--ask")) console.log(`Password (keep it safe, it is not stored anywhere):\n  ${password}\n`);
  console.log(`Set these on the server:\n${settings.join("\n")}`);
}
process.exit(0);
