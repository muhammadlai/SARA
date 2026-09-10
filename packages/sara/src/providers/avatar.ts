/**
 * Sara AI — avatar providers.
 *
 * 1. EngineAvatarProvider — real-time MuseTalk lip-sync via the vendored
 *    AvatarAI engine (requires GPU + SARA_AVATAR_ENGINE_URL).
 * 2. PhotoAvatarProvider — the bundled photorealistic Sara portrait with
 *    idle animation driven by the dashboard (blink/breathe CSS) and an
 *    emotion overlay; honest about "no lip-sync".
 * 3. UnavailableAvatarProvider — explicit degraded state (never a fake).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import type {
  AvatarCapability,
  AvatarFrameRequest,
  AvatarProvider,
  AvatarRender,
  SaraEmotion,
} from "../types.js";
import { emotionToExpression } from "../emotion.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const PORTRAIT_PATH = path.resolve(here, "../../../sara-assets/sara-portrait.png");

/** Locate the portrait both from source trees and built dist trees. */
export function portraitPublicPath(): string | null {
  const candidates = [
    PORTRAIT_PATH,
    path.resolve(here, "../../../../services/sara-assets/sara-portrait.png"),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export interface EngineAvatarOptions {
  baseUrl: string;
  avatarId?: string | null;
  fetchImpl?: typeof fetch;
}

export class EngineAvatarProvider implements AvatarProvider {
  readonly name = "avatar-engine";
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: EngineAvatarOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  capabilities(): AvatarCapability[] {
    return ["photo", "lipsync", "expressions"];
  }

  async render(req: AvatarFrameRequest): Promise<AvatarRender> {
    const base = this.opts.baseUrl.replace(/\/+$/, "");
    const res = await this.fetchImpl(`${base}/api/v1/animate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        avatar_id: this.opts.avatarId ?? undefined,
        text: req.text,
        audio_path: req.audioPath,
        emotion: req.emotion,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`engine animate http ${res.status}`);
    const data = (await res.json()) as { video_url?: string; video_path?: string };
    const url = data.video_url ?? data.video_path ?? null;
    if (!url) throw new Error("engine: no video in response");
    return {
      mode: "engine-lipsync",
      assetUrl: url,
      capabilities: this.capabilities(),
      provider: this.name,
    };
  }
}

export class PhotoAvatarProvider implements AvatarProvider {
  readonly name = "photo-avatar";

  capabilities(): AvatarCapability[] {
    return ["photo", "expressions"];
  }

  async render(req: AvatarFrameRequest): Promise<AvatarRender> {
    const expr = emotionToExpression(req.emotion);
    const found = portraitPublicPath();
    return {
      mode: "photo",
      assetUrl: found ? "/sara/sara-portrait.png" : null,
      capabilities: this.capabilities(),
      provider: this.name,
      note: `photo mode (idle animation + expression overlay: smile=${expr.smile.toFixed(2)}, energy=${expr.energyLevel.toFixed(2)}) — lip-sync requires the GPU avatar engine`,
    };
  }
}

export class UnavailableAvatarProvider implements AvatarProvider {
  readonly name = "unavailable";
  capabilities(): AvatarCapability[] {
    return [];
  }
  async render(_req: AvatarFrameRequest): Promise<AvatarRender> {
    void _req;
    return {
      mode: "unavailable",
      assetUrl: null,
      capabilities: [],
      provider: this.name,
      note: "avatar assets missing — showing status card only",
    };
  }
}

export function resolveAvatarProvider(opts: {
  engineBaseUrl?: string | null;
  engineAvatarId?: string | null;
}): AvatarProvider {
  if (opts.engineBaseUrl)
    return new EngineAvatarProvider({
      baseUrl: opts.engineBaseUrl,
      avatarId: opts.engineAvatarId ?? null,
    });
  if (portraitPublicPath()) return new PhotoAvatarProvider();
  return new UnavailableAvatarProvider();
}

/** Emotion overlay descriptor the dashboard uses in photo mode. */
export function photoOverlayFor(emotion: SaraEmotion): { cssClass: string; label: string } {
  const map: Record<SaraEmotion, { cssClass: string; label: string }> = {
    neutral: { cssClass: "calm", label: "Neutral" },
    happy: { cssClass: "joy", label: "Happy" },
    excited: { cssClass: "burst", label: "Excited ✨" },
    surprised: { cssClass: "burst", label: "Surprised" },
    sad: { cssClass: "low", label: "Sad" },
    confused: { cssClass: "thinking", label: "Confused" },
    curious: { cssClass: "thinking", label: "Curious" },
    playful: { cssClass: "joy", label: "Playful 😄" },
    thankful: { cssClass: "joy", label: "Thankful ❤️" },
    calm: { cssClass: "calm", label: "Calm" },
    thinking: { cssClass: "thinking", label: "Thinking…" },
  };
  return map[emotion];
}
