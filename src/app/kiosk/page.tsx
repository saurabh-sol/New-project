import type { Metadata } from "next";
import { Kiosk } from "@/components/kiosk/kiosk";

export const metadata: Metadata = {
  title: "The Council · Display",
  description: "Full-screen view of the trading floor for a wall display.",
};

export default function KioskPage() {
  return <Kiosk />;
}
