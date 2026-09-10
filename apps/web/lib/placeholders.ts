import {
  Bot,
  Brain,
  ListTodo,
  MessageCircle,
  Mic,
  Plug,
  ScrollText,
  Settings,
  Share2,
  Wand2,
  type LucideIcon,
} from "lucide-react";

export interface PlaceholderPage {
  title: string;
  description: string;
  phase: number;
  icon: LucideIcon;
  /** Planned capabilities, shown so every route is honest about what's next. */
  points: string[];
}

/**
 * Per-route placeholder content. Future phases replace the body of each page
 * while keeping the route, layout and navigation intact.
 */
export const PLACEHOLDER_PAGES: Record<string, PlaceholderPage> = {
  "/chat": {
    title: "Chat",
    description: "Talk with Sara naturally — streaming replies with conversation memory.",
    phase: 3,
    icon: MessageCircle,
    points: [
      "Streaming chat powered by the agent orchestrator",
      "Short-term conversation memory that survives reloads",
      "Pluggable LLM provider (OpenAI, Anthropic, local models)",
    ],
  },
  "/tasks": {
    title: "Tasks",
    description: "Sara's personal task system — the backbone of schedules and reminders.",
    phase: 6,
    icon: ListTodo,
    points: [
      "Create, complete and organize tasks",
      "Due dates with reminders",
      "Background workers for scheduled jobs",
    ],
  },
  "/memory": {
    title: "Memory",
    description: "What Sara remembers about you — with full inspection and deletion control.",
    phase: 4,
    icon: Brain,
    points: [
      "User preferences and long-term facts",
      "Memory inspection UI",
      "One-click deletion, always audited",
    ],
  },
  "/content-studio": {
    title: "Content Studio",
    description: "Draft, refine and preview content before it goes anywhere.",
    phase: 10,
    icon: Wand2,
    points: [
      "Titles, descriptions, captions and hashtags",
      "Platform-aware previews",
      "Revision history",
    ],
  },
  "/social-media": {
    title: "Social Media",
    description: "Publishing workflows for Facebook, Instagram, YouTube and TikTok.",
    phase: 11,
    icon: Share2,
    points: [
      "Provider adapters behind one abstraction",
      "Official platform APIs only",
      "Human approval before anything is published",
    ],
  },
  "/avatar": {
    title: "Avatar",
    description: "Sara's virtual face — expressions, blinking, idle and talking animations.",
    phase: 8,
    icon: Bot,
    points: [
      "Original character design (never a real person)",
      "Emotion-driven facial expressions",
      "Lip sync with voice output",
    ],
  },
  "/voice": {
    title: "Voice",
    description: "Speak to Sara and hear her answer.",
    phase: 7,
    icon: Mic,
    points: [
      "Push-to-talk speech input",
      "Text-to-speech output for replies",
      "Voice and speed settings",
    ],
  },
  "/activity": {
    title: "Activity",
    description: "A transparent audit log of everything Sara does on your behalf.",
    phase: 2,
    icon: ScrollText,
    points: [
      "Append-only audit log",
      "Agent actions, approvals, config changes",
      "Filter and search history",
    ],
  },
  "/integrations": {
    title: "Integrations",
    description: "Connect Sara to the platforms and providers you use.",
    phase: 11,
    icon: Plug,
    points: [
      "LLM and voice provider setup",
      "Social platform connections via official APIs",
      "Credential handling stays in environment secrets",
    ],
  },
  "/settings": {
    title: "Settings",
    description: "Persona, safety and system configuration.",
    phase: 2,
    icon: Settings,
    points: [
      "Persona name, tone and boundaries",
      "Permission scopes for what Sara may do",
      "Approval requirements for external actions",
    ],
  },
};

export function getPlaceholderPage(pathname: string): PlaceholderPage {
  const page = PLACEHOLDER_PAGES[pathname];
  if (page === undefined) {
    throw new Error(`No placeholder registered for route: ${pathname}`);
  }
  return page;
}
