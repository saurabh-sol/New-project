import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, cookieOptions, dueForRenewal, issue, read, type AdminSession } from "./auth";

export const LOGIN_PATH = "/admin/login";

/** The admin using this browser, if it has signed in. */
export async function currentAdmin(): Promise<AdminSession | null> {
  return read((await cookies()).get(ADMIN_COOKIE)?.value);
}

/** For a page only the admin may see. Anyone else is sent to sign in. */
export async function requireAdmin(): Promise<AdminSession> {
  const session = await currentAdmin();
  if (!session) redirect(LOGIN_PATH);
  return session;
}

/** Signs this browser in. Only a server action or a route may call it: a page cannot set cookies. */
export async function signIn(user: string): Promise<AdminSession> {
  const { token, session } = issue(user);
  (await cookies()).set(ADMIN_COOKIE, token, cookieOptions());
  return session;
}

export async function signOut() {
  (await cookies()).delete(ADMIN_COOKIE);
}

/** Gives a session in use a fresh cookie once a day, so a display that is left on stays signed in. */
export async function renewIfDue(session: AdminSession): Promise<AdminSession> {
  return dueForRenewal(session) ? signIn(session.user) : session;
}
