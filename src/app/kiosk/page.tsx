import type { Metadata } from "next";
import { Kiosk } from "@/components/kiosk/kiosk";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `${BRAND} · Display`,
  description: "Full-screen view of the trading floor for a wall display.",
};

export default function KioskPage() {
  return <Kiosk />;
}
