/**
 * Zod schemas for every Clip Finder trust boundary: job creation, search,
 * clip patching and render requests.
 */
import { z } from "zod";
import { ASPECT_RATIOS, SUBTITLE_STYLES, FRAMING_MODES } from "./types.js";

export type ClipCategory = (typeof CLIP_CATEGORIES)[number];

export const CLIP_CATEGORIES = [
  "emotional",
  "funny",
  "romantic",
  "sad",
  "shocking",
  "suspense",
  "argument",
  "inspirational",
  "story",
  "dialogue",
  "hook",
  "general",
] as const;

export const CLIP_CATEGORY_LABELS: Record<(typeof CLIP_CATEGORIES)[number], string> = {
  emotional: "Emotional",
  funny: "Funny",
  romantic: "Romantic",
  sad: "Sad",
  shocking: "Shocking",
  suspense: "Suspense",
  argument: "Argument",
  inspirational: "Inspirational",
  story: "Important Story Moment",
  dialogue: "Best Dialogue",
  hook: "Best Hook",
  general: "General Highlight",
};

export const clipFinderOptionsSchema = z.object({
  clipCount: z.coerce.number().int().min(1).max(50).default(10),
  minDurationSeconds: z.coerce.number().min(3).max(600).default(15),
  maxDurationSeconds: z.coerce.number().min(5).max(900).default(60),
  aspectRatio: z.enum(ASPECT_RATIOS).default("9:16"),
  language: z.string().min(2).max(12).default("auto"),
  categories: z.array(z.enum(CLIP_CATEGORIES)).max(CLIP_CATEGORIES.length).default(["general"]),
  query: z.string().max(500).optional(),
  paddingBeforeSeconds: z.coerce.number().min(0).max(10).default(1.5),
  paddingAfterSeconds: z.coerce.number().min(0).max(10).default(2.5),
});

export const searchSchema = z.object({ query: z.string().min(1).max(500) });

export const renderOptionsSchema = z.object({
  aspectRatio: z.enum(ASPECT_RATIOS).default("9:16"),
  subtitleStyle: z.enum(SUBTITLE_STYLES).default("modern"),
  subtitleOptions: z
    .object({
      fontSize: z.coerce.number().min(8).max(120).optional(),
      position: z.enum(["bottom", "center", "top"]).optional(),
      background: z.coerce.boolean().optional(),
      uppercase: z.coerce.boolean().optional(),
    })
    .default({}),
  framing: z.enum(FRAMING_MODES).default("blur-pad"),
  quality: z.union([z.literal(1080), z.literal(720)]).default(1080),
  /** Optional user-written commentary, overlaid and clearly labeled. */
  commentaryText: z.string().max(2000).optional(),
});

export const patchClipSchema = z
  .object({
    startTime: z.coerce.number().min(0),
    endTime: z.coerce.number().min(0),
  })
  .refine((v) => v.endTime > v.startTime, {
    message: "endTime must be greater than startTime",
  })
  .refine((v) => v.endTime - v.startTime <= 900, {
    message: "clip may not exceed 900 seconds",
  });

export type ClipFinderOptionsInput = z.input<typeof clipFinderOptionsSchema>;
export type ParsedClipFinderOptions = z.output<typeof clipFinderOptionsSchema>;
export type ParsedRenderOptions = z.output<typeof renderOptionsSchema>;

/** Validate min/max coherence after defaults are applied. */
export const resolvedOptionsSchema = clipFinderOptionsSchema.refine(
  (o) => o.maxDurationSeconds > o.minDurationSeconds,
  { message: "maxDurationSeconds must be greater than minDurationSeconds" },
);
