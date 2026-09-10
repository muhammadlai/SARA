import type { Metadata } from "next";
import { SaraLiveApp } from "@/components/sara-live/sara-live-app";

export const metadata: Metadata = {
  title: "Sara AI — Live Control Center",
  description: "Sara, the AI virtual LIVE host: control center, simulator, memory and safety.",
};

export default function SaraPage() {
  return <SaraLiveApp />;
}
