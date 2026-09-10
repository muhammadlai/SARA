import type { Metadata } from "next";
import { Shell } from "@/components/shell";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Sara — Personal AI Agent",
    template: "%s · Sara",
  },
  description:
    "Sara is a personal AI agent and virtual character: chat, memory, tasks, content creation and social-media workflows.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
