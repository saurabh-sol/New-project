import { currentAdmin, renewIfDue } from "@/server/admin/session";
import { adminStatus } from "@/server/admin/status";

/** The state of the things the desk runs on. For the admin only. */
export async function GET() {
  const session = await currentAdmin();
  if (!session) return Response.json({ error: "Sign in first." }, { status: 401, headers: { "cache-control": "no-store" } });
  // The display asks every half minute, which is what keeps it signed in.
  await renewIfDue(session);
  return Response.json(await adminStatus(session.user), { headers: { "cache-control": "no-store" } });
}
