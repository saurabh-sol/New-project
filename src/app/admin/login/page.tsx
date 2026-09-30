import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/admin/login-form";
import { BRAND } from "@/lib/brand";
import { adminConfigured } from "@/server/admin/auth";
import { currentAdmin } from "@/server/admin/session";

export const metadata: Metadata = {
  title: `${BRAND} · Admin sign-in`,
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage() {
  if (await currentAdmin()) redirect("/admin");
  return <LoginForm configured={adminConfigured()} />;
}
