import type { Metadata } from "next";
import { AdminDisplay } from "@/components/admin/display";
import { BRAND } from "@/lib/brand";
import { requireAdmin } from "@/server/admin/session";

export const metadata: Metadata = {
  title: `${BRAND} · Admin`,
  description: "The desk on one screen, for the admin.",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const admin = await requireAdmin();
  return <AdminDisplay user={admin.user} />;
}
