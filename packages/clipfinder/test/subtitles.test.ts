import { describe, expect, it } from "vitest";
import {
  buildCues,
  cuesToSrt,
  generateSrt,
  resolveSubtitleOptions,
  subtitleStyleToAss,
} from "../src/subtitles.js";
import { validateSourceUrl, looksLikeVideoMime, hasVideoExtension } from "../src/ssrf.js";
import { retimedMockTranscript, MOCK_PROVIDER_TAG } from "../src/providers/mock.js";

const segments = [
  { text: "Hello world", start: 0, end: 2 },
  { text: "کیا حال ہے", start: 2.5, end: 5 },
  { text: "This is fine.", start: 10, end: 12 },
];

describe("subtitle generation", () => {
  it("clips and re-times cues to the window", () => {
    const cues = buildCues(segments, 2, 6);
    expect(cues).toHaveLength(1);
    expect(cues[0]?.text).toBe("کیا حال ہے");
    expect(cues[0]?.start).toBeCloseTo(0.5, 5);
    expect(cues[0]?.end).toBeCloseTo(3, 5);
  });

  it("emits valid SRT with CRLF and Unicode intact", () => {
    const srt = generateSrt(segments, 0, 12);
    expect(srt).toContain("1\r\n00:00:00,000 --> 00:00:02,000\r\nHello world");
    expect(srt).toContain("کیا حال ہے");
  });

  it("supports uppercase styling without changing meaning", () => {
    const srt = generateSrt(segments, 0, 3, { uppercase: true });
    expect(srt).toContain("HELLO WORLD");
    expect(srt).not.toContain("This is fine."); // outside the window
  });

  it("numbering is contiguous after clipping", () => {
    const srt = cuesToSrt(buildCues(segments, 9, 12));
    expect(srt.startsWith("1\r\n")).toBe(true);
  });

  it("style presets produce distinct ASS force_style strings", () => {
    const styles = ["classic", "modern", "minimal", "large", "shorts"] as const;
    const rendered = styles.map((s) => subtitleStyleToAss(resolveSubtitleOptions(s)));
    expect(new Set(rendered).size).toBe(styles.length);
    for (const s of rendered) {
      expect(s).toContain("FontName=Noto Sans");
      expect(s).toContain("FontSize=");
    }
  });

  it("shorts style uses a larger font and raised margin", () => {
    const shorts = subtitleStyleToAss(resolveSubtitleOptions("shorts"));
    const classic = subtitleStyleToAss(resolveSubtitleOptions("classic"));
    const sizeOf = (s: string) => Number(/FontSize=(\d+)/.exec(s)?.[1]);
    expect(sizeOf(shorts)).toBeGreaterThan(sizeOf(classic));
  });
});

describe("mock transcript labeling", () => {
  it("is clearly labeled as DEMO/MOCK", () => {
    const t = retimedMockTranscript(180, "auto");
    expect(t.provider).toContain("MOCK");
    expect(t.provider).toContain(MOCK_PROVIDER_TAG);
    expect(t.segments.length).toBeGreaterThan(5);
    // covers the full duration
    expect(t.segments[t.segments.length - 1]?.end).toBeGreaterThan(170);
  });
});

describe("URL safety (SSRF guard)", () => {
  it("accepts public https URLs", () => {
    expect(validateSourceUrl("https://cdn.example.com/video.mp4").ok).toBe(true);
    expect(validateSourceUrl("http://example.com/v.mkv").ok).toBe(true);
  });

  it("rejects private/loopback/link-local targets", () => {
    for (const url of [
      "http://localhost/v.mp4",
      "http://127.0.0.1/v.mp4",
      "http://10.0.0.5/v.mp4",
      "http://192.168.1.10/v.mp4",
      "http://172.16.0.9/v.mp4",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/v.mp4",
      "http://[fd00::1]/v.mp4",
    ]) {
      expect(validateSourceUrl(url).ok).toBe(false);
    }
  });

  it("rejects non-http protocols and embedded credentials", () => {
    expect(validateSourceUrl("ftp://example.com/v.mp4").ok).toBe(false);
    expect(validateSourceUrl("file:///etc/passwd").ok).toBe(false);
    expect(validateSourceUrl("https://user:pass@example.com/v.mp4").ok).toBe(false);
  });

  it("mime/extension helpers recognize video content", () => {
    expect(looksLikeVideoMime("video/mp4")).toBe(true);
    expect(looksLikeVideoMime("application/octet-stream")).toBe(true);
    expect(looksLikeVideoMime("text/html")).toBe(false);
    expect(hasVideoExtension("https://x.com/a/b/c.MP4?token=1")).toBe(true);
    expect(hasVideoExtension("https://x.com/page.html")).toBe(false);
  });
});
