"use client";

import { useActionState } from "react";
import { login } from "@/app/admin/actions";
import { Logo } from "@/components/site/logo";

const FIELD = "w-full border-b border-white/25 bg-transparent py-1.5 font-mono text-sm text-white outline-none placeholder:text-white/20 focus:border-white";

/** The way in to the admin's display. There is one account, and it is set on the server. */
export function LoginForm({ configured }: { configured: boolean }) {
  const [state, action, pending] = useActionState(login, undefined);

  return (
    <main className="stage flex min-h-dvh flex-1 items-center justify-center bg-black px-4 font-mono text-white">
      <form action={action} className="w-full max-w-sm border border-white/15 bg-black">
        <div className="flex items-center gap-2 border-b border-white/15 px-3 py-2 text-[11px] text-white/50">
          <Logo className="size-4" />
          <span>council@desk: login</span>
        </div>
        <div className="space-y-4 p-4 text-sm">
          <p className="text-xs leading-relaxed text-white/50">
            The Council · admin display.
            <br />
            Sign in to go on.
          </p>
          <label className="block">
            <span className="text-[11px] uppercase tracking-widest text-white/40">login</span>
            <input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus className={FIELD} />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-widest text-white/40">password</span>
            <input name="password" type="password" autoComplete="current-password" required className={FIELD} />
          </label>
          {!configured && <p className="text-xs text-red-400">No admin account is set up on this server. Set ADMIN_USERNAME, ADMIN_PASSWORD_HASH and ADMIN_SESSION_SECRET.</p>}
          {state?.error && (
            <p role="alert" className="text-xs text-red-400">
              {state.error}
            </p>
          )}
          <button type="submit" disabled={pending || !configured} className="w-full border border-white bg-white py-2 text-xs font-semibold uppercase tracking-widest text-black disabled:opacity-40">
            {pending ? "checking…" : "sign in"}
          </button>
        </div>
      </form>
    </main>
  );
}
