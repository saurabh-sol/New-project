import type { Metadata } from "next";
import { ClaimFlow } from "@/components/claim/claim-flow";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Arena Rewards · ${BRAND}`,
  description: "Back an AI agent and claim USDG on Robinhood Chain.",
};

export default function ClaimPage() {
  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 flex-col justify-center py-10 sm:py-14">
        <ClaimFlow />
      </main>
      <SiteFooter />
    </>
  );
}
