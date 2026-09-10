/**
 * URL safety for the "public video URL" input. We ONLY fetch URLs that are
 * unambiguous, public, and served over https/http — and we never attach
 * credentials or cookies. This is not a login/DRM/paywall bypass: restricted
 * sources are expected to fail with a clear message.
 */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "metadata.google.internal",
]);

export interface UrlCheck {
  ok: boolean;
  url?: URL;
  reason?: string;
}

function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast/reserved
  return false;
}

function isPrivateIPv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    h === "::1" || h === "::" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")
  );
}

export function validateSourceUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Invalid URL — expected an http(s) link to a video file." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `Unsupported protocol "${url.protocol}" — use http(s).` };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "URLs with embedded credentials are not allowed." };
  }
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || isPrivateIPv4(host) || isPrivateIPv6(host)) {
    return {
      ok: false,
      reason: "Private, loopback or link-local addresses are not allowed (possible SSRF).",
    };
  }
  return { ok: true, url };
}

export const VIDEO_MIME_PREFIX = "video/";
export const ALLOWED_VIDEO_EXT = [
  ".mp4",
  ".m4v",
  ".mov",
  ".mkv",
  ".webm",
  ".avi",
  ".ts",
  ".mpg",
  ".mpeg",
  ".flv",
  ".wmv",
];

export function hasVideoExtension(pathOrUrl: string): boolean {
  const clean = pathOrUrl.split(/[?#]/)[0] ?? "";
  return ALLOWED_VIDEO_EXT.some((ext) => clean.toLowerCase().endsWith(ext));
}

export function looksLikeVideoMime(mime: string | null | undefined): boolean {
  if (!mime) return false;
  const m = mime.toLowerCase();
  return (
    m.startsWith(VIDEO_MIME_PREFIX) ||
    m === "application/octet-stream" ||
    m === "binary/octet-stream"
  );
}
