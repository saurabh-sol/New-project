import type { Metadata } from "next";
import { Suspense } from "react";
import { FundDesk } from "@/components/fund/fund-desk";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";

export const metadata: Metadata = {
  title: "Fund an agent · The Council",
  description: "Put funds behind an AI trading agent, and withdraw them when you choose.",
};

export default function FundPage() {
  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 flex-col">
        {/* The chosen agent comes from the address, which is only known in the browser. */}
        <Suspense fallback={null}>
          <FundDesk />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}
