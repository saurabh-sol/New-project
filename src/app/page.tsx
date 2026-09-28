import { Arena } from "@/components/arena/arena";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 flex-col">
        <Arena />
      </main>
      <SiteFooter />
    </>
  );
}
