/**
 * Subtitle generation: transcript → clipped, re-timed SRT with full Unicode
 * support (Urdu/Hindi/English). Dialogue text is never altered — only cut to
 * the clip window, re-timed, and optionally uppercased for a chosen style.
 */
import type { SubtitleOptions, TranscriptSegment } from "./types.js";
import { type SUBTITLE_STYLES, type SubtitleStyle } from "./types.js";

function formatTimestamp(seconds: number, comma: boolean): string {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  const sep = comma ? "," : ".";
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${sep}${String(ms).padStart(3, "0")}`;
}

export interface SubtitleCue {
  index: number;
  start: number;
  end: number;
  text: string;
}

/** Build cues from transcript segments intersecting [clipStart, clipEnd]. */
export function buildCues(
  segments: TranscriptSegment[],
  clipStart: number,
  clipEnd: number,
  options: { uppercase?: boolean } = {},
): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  for (const segment of segments) {
    if (segment.end <= clipStart || segment.start >= clipEnd) continue;
    let text = segment.text.trim();
    if (text.length === 0) continue;
    if (options.uppercase === true) text = text.toLocaleUpperCase();
    cues.push({
      index: cues.length + 1,
      start: Math.max(0, segment.start - clipStart),
      end: Math.min(clipEnd - clipStart, segment.end - clipStart),
      text,
    });
  }
  return cues;
}

/** cues → SRT content (CRLF line endings per the SRT convention). */
export function cuesToSrt(cues: SubtitleCue[]): string {
  return (
    cues
      .map((cue) =>
        [
          String(cue.index),
          `${formatTimestamp(cue.start, true)} --> ${formatTimestamp(cue.end, true)}`,
          cue.text,
        ].join("\r\n"),
      )
      .join("\r\n\r\n") + (cues.length > 0 ? "\r\n\r\n" : "")
  );
}

export function generateSrt(
  segments: TranscriptSegment[],
  clipStart: number,
  clipEnd: number,
  options: { uppercase?: boolean } = {},
): string {
  return cuesToSrt(buildCues(segments, clipStart, clipEnd, options));
}

/** ASS force_style string per named style, honoring user overrides. */
export function subtitleStyleToAss(style: SubtitleOptions): string {
  const size = style.fontSize;
  const alignment = style.position === "top" ? 8 : style.position === "center" ? 5 : 2;
  const marginV = style.position === "center" ? 0 : style.position === "top" ? 40 : 60;
  switch (style.style) {
    case "classic":
      return `FontName=Noto Sans,FontSize=${size},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=${alignment},MarginV=${marginV},Bold=0`;
    case "modern":
      return `FontName=Noto Sans,FontSize=${size},PrimaryColour=&H00FFFFFF,BackColour=&H80000000,BorderStyle=4,Outline=0,Shadow=0,Alignment=${alignment},MarginV=${marginV},Bold=1`;
    case "minimal":
      return `FontName=Noto Sans,FontSize=${Math.round(size * 0.8)},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1,Shadow=0,Alignment=${alignment},MarginV=${marginV},Bold=0`;
    case "large":
      return `FontName=Noto Sans,FontSize=${Math.round(size * 1.35)},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Shadow=1,Alignment=${alignment},MarginV=${marginV},Bold=1`;
    case "shorts":
      return `FontName=Noto Sans,FontSize=${Math.round(size * 1.2)},PrimaryColour=&H00FFFFFF,BackColour=&H60000000,BorderStyle=4,Outline=0,Shadow=0,Alignment=${alignment},MarginV=${Math.round(marginV + 120)},Bold=1`;
    default: {
      const exhaustive: never = style.style;
      return exhaustive;
    }
  }
}

export const DEFAULT_SUBTITLE_OPTIONS: SubtitleOptions = {
  style: "modern",
  fontSize: 26,
  position: "bottom",
  background: true,
  uppercase: false,
};

export function resolveSubtitleOptions(
  style: SubtitleStyle,
  overrides: Partial<SubtitleOptions> = {},
): SubtitleOptions {
  const styleDefaults: Record<(typeof SUBTITLE_STYLES)[number], Partial<SubtitleOptions>> = {
    classic: { fontSize: 26 },
    modern: { fontSize: 26 },
    minimal: { fontSize: 24 },
    large: { fontSize: 36 },
    shorts: { fontSize: 32, position: "bottom", background: true },
  };
  return {
    ...DEFAULT_SUBTITLE_OPTIONS,
    ...styleDefaults[style],
    ...overrides,
    style,
  };
}
