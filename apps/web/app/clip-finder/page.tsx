import type { Metadata } from "next";
import { ClipFinderApp } from "@/components/clip-finder/clip-finder-app";

export const metadata: Metadata = { title: "Clip Finder" };

export default function ClipFinderPage() {
  return <ClipFinderApp />;
}
