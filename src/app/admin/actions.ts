"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { adminConfigured, checkLogin, forgetGuesses, mustWait, noteWrongGuess } from "@/server/admin/auth";
import { LOGIN_PATH, signIn, signOut } from "@/server/admin/session";

export interface LoginState {
  error: string;
  /** The name that was typed, put back in the form so that only the password is typed again. */
  username?: string;
}

/** A wrong guess is answered no sooner than this, so guessing is slow. */
const PAUSE_MS = 600;
const pause = () => new Promise((done) => setTimeout(done, PAUSE_MS));

const text = (value: FormDataEntryValue | null) => (typeof value === "string" ? value.slice(0, 200) : "");

export async function login(_: LoginState | undefined, form: FormData): Promise<LoginState> {
  if (!adminConfigured()) return { error: "No admin account is set up on this server." };

  // The host puts the visitor's address first in this header.
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const wait = mustWait(ip);
  if (wait > 0) return { error: `Too many wrong guesses. Try again in ${Math.ceil(wait / 60_000)} min.` };

  const username = text(form.get("username")).trim();
  const password = text(form.get("password"));
  if (!username || !password || !(await checkLogin(username, password))) {
    noteWrongGuess(ip);
    await pause();
    return { error: "Wrong username or password.", username };
  }

  forgetGuesses(ip);
  await signIn(username);
  redirect("/admin");
}

export async function logout() {
  await signOut();
  redirect(LOGIN_PATH);
}
