import {
  Bot,
  Radio,
  Brain,
  Clapperboard,
  LayoutDashboard,
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

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Roadmap phase where the module becomes real; null = already live. */
  phase: number | null;
}

/** Main navigation — matches the dashboard architecture (ARCHITECTURE.md §4). */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, phase: null },
  { href: "/chat", label: "Chat", icon: MessageCircle, phase: 3 },
  { href: "/clip-finder", label: "Clip Finder", icon: Clapperboard, phase: null },
  { href: "/sara", label: "Sara LIVE", icon: Radio, phase: null },
  { href: "/tasks", label: "Tasks", icon: ListTodo, phase: 6 },
  { href: "/memory", label: "Memory", icon: Brain, phase: 4 },
  { href: "/content-studio", label: "Content Studio", icon: Wand2, phase: 10 },
  { href: "/social-media", label: "Social Media", icon: Share2, phase: 11 },
  { href: "/avatar", label: "Avatar", icon: Bot, phase: 8 },
  { href: "/voice", label: "Voice", icon: Mic, phase: 7 },
  { href: "/activity", label: "Activity", icon: ScrollText, phase: 2 },
  { href: "/integrations", label: "Integrations", icon: Plug, phase: 11 },
  { href: "/settings", label: "Settings", icon: Settings, phase: 2 },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
