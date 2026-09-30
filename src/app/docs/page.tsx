import type { Metadata } from "next";
import { connection } from "next/server";
import { Docs } from "@/components/docs/docs";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { BRAND } from "@/lib/brand";
import { docsFacts } from "@/server/docs";

export const metadata: Metadata = {
  title: `Docs · ${BRAND}`,
  description: `How ${BRAND} works: the four agents, what a session is, the rules the desk enforces, and the contract each agent trades from on Robinhood Chain.`,
};

export default async function DocsPage() {
  // The contracts and the terms are the server's settings, which are read when someone asks, not when the site is built.
  await connection();

  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 flex-col">
        <Docs facts={docsFacts()} />
      </main>
      <SiteFooter />
    </>
  );
}
