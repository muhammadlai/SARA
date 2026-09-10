"use client";
/**
 * Sara AI — LIVE control center.
 *
 * The main Sara screen: photorealistic avatar preview (idle animation +
 * emotion overlay in photo mode), LIVE controls with emergency stop, live
 * feed (viewer comments, Sara replies with voice playback, moderation),
 * simulator box, memory / moderation / settings / health panels.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createSaraClient,
  formatUptime,
  type SaraFeedItem,
  type SaraSettings,
  type SaraStatusResponse,
} from "@/lib/sara-client";
import { Card } from "@sara/ui";

const client = createSaraClient();

const STATE_STYLES: Record<string, string> = {
  idle: "bg-zinc-200 text-zinc-700",
  starting: "bg-amber-100 text-amber-800",
  live: "bg-rose-600 text-white",
  paused: "bg-amber-100 text-amber-800",
  takeover: "bg-indigo-600 text-white",
  muted: "bg-zinc-400 text-white",
  stopped: "bg-zinc-200 text-zinc-700",
  error: "bg-red-700 text-white",
};

const EMOTION_EMOJI: Record<string, string> = {
  neutral: "🙂",
  happy: "😊",
  excited: "🤩",
  surprised: "😲",
  sad: "🥺",
  confused: "😕",
  curious: "🤔",
  playful: "😄",
  thankful: "🥰",
  calm: "😌",
  thinking: "💭",
};

function Pill({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      {children}
    </span>
  );
}

function AvatarPanel({
  status,
  speaking,
}: {
  status: SaraStatusResponse | null;
  speaking: boolean;
}) {
  const emotion = status?.emotion.emotion ?? "neutral";
  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-[4/5] max-h-[420px] w-full bg-gradient-to-b from-sky-100 to-teal-50">
        <img
          src="/sara/sara-portrait.png"
          alt="Sara — AI virtual host (fictional character)"
          className={`h-full w-full object-cover transition-transform duration-700 ${speaking ? "sara-speaking" : "sara-idle"}`}
        />
        {speaking && (
          <div className="absolute inset-x-0 bottom-0 h-1.5 animate-pulse bg-gradient-to-r from-teal-400 via-sky-400 to-teal-400" />
        )}
        <div className="absolute left-3 top-3 flex flex-col gap-1.5">
          <Pill className="bg-white/85 text-zinc-800 shadow">
            {EMOTION_EMOJI[emotion] ?? "🙂"} {emotion} ·{" "}
            {Math.round((status?.emotion.intensity ?? 0) * 100)}%
          </Pill>
          <Pill className="bg-white/85 text-xs text-zinc-700 shadow">
            {speaking ? "🔊 speaking" : "💬 listening"}
          </Pill>
        </div>
        <div className="absolute bottom-3 left-3 right-3">
          <Pill className="bg-white/90 text-zinc-700 shadow">
            🤖 {status?.aiDisclosure ?? "Sara is an AI virtual character."}
          </Pill>
        </div>
      </div>
      <div className="space-y-1 border-t border-zinc-100 p-3 text-xs text-zinc-600">
        <div>
          Avatar: <strong>{status?.avatar.provider ?? "…"}</strong> · capabilities:{" "}
          {(status?.avatar.capabilities ?? []).join(", ") || "none"}
        </div>
        {status?.avatar.provider === "photo-avatar" && (
          <div className="text-amber-700">
            Photo mode: real portrait with idle animation + expression overlay. Real-time lip-sync
            needs the GPU avatar engine (AvatarAI/MuseTalk).
          </div>
        )}
        <div>
          Voice: <strong>{status?.live.tts.provider ?? "…"}</strong>
          {status?.live.tts.degraded && (
            <span className="ml-1 text-amber-700">(offline fallback — labeled)</span>
          )}
        </div>
        <div>
          Brain: <strong>{status?.live.brain.provider ?? "…"}</strong>
          {status?.live.brain.fallback && (
            <span className="ml-1 text-amber-700">(fallback: {status.live.brain.fallback})</span>
          )}
        </div>
      </div>
    </Card>
  );
}

function ControlStrip({
  state,
  onControl,
  busy,
}: {
  state: string;
  onControl: (action: string) => void;
  busy: boolean;
}) {
  const btn = "rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}
        disabled={busy || state === "live"}
        onClick={() => onControl("start")}
      >
        ▶ START LIVE
      </button>
      <button
        className={`${btn} bg-zinc-700 text-white hover:bg-zinc-800`}
        disabled={busy || state === "idle" || state === "stopped"}
        onClick={() => onControl("stop")}
      >
        ■ STOP
      </button>
      <button
        className={`${btn} bg-amber-500 text-white hover:bg-amber-600`}
        disabled={busy || state !== "live"}
        onClick={() => onControl("pause")}
      >
        ⏸ Pause Sara
      </button>
      <button
        className={`${btn} bg-teal-600 text-white hover:bg-teal-700`}
        disabled={busy || (state !== "paused" && state !== "takeover")}
        onClick={() => onControl("resume")}
      >
        ▶ Resume
      </button>
      <button
        className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}
        disabled={busy || (state !== "live" && state !== "muted")}
        onClick={() => onControl("takeover")}
      >
        🎧 Human takeover
      </button>
      {state === "muted" ? (
        <button
          className={`${btn} bg-teal-600 text-white hover:bg-teal-700`}
          disabled={busy}
          onClick={() => onControl("unmute")}
        >
          🔊 Unmute
        </button>
      ) : (
        <button
          className={`${btn} bg-zinc-200 text-zinc-800 hover:bg-zinc-300`}
          disabled={busy || state !== "live"}
          onClick={() => onControl("mute")}
        >
          🔇 Mute
        </button>
      )}
      <button
        className={`${btn} ml-auto bg-red-600 text-white hover:bg-red-700`}
        disabled={busy}
        onClick={() => onControl("emergency-stop")}
      >
        🛑 EMERGENCY STOP
      </button>
    </div>
  );
}

function FeedRow({
  item,
  onPlay,
  playingId,
}: {
  item: SaraFeedItem;
  onPlay: (item: SaraFeedItem) => void;
  playingId: string | null;
}) {
  const meta = (item.meta ?? {}) as {
    provider?: string;
    fallback?: boolean;
    tts?: string;
    degraded?: boolean;
    language?: string;
    latencyMs?: number;
    replyTo?: string;
    replyText?: string;
    queued?: boolean;
    reason?: string;
  };

  if (item.kind === "viewer") {
    return (
      <div
        className={`rounded-lg px-3 py-2 text-sm ${meta.queued === false ? "bg-zinc-50 text-zinc-400" : "bg-sky-50 text-zinc-800"}`}
      >
        <span className="font-medium">{item.username}</span>
        <span className="ml-2">{item.text}</span>
        {meta.queued === false && <span className="ml-2 text-xs">({meta.reason})</span>}
      </div>
    );
  }
  if (item.kind === "sara") {
    return (
      <div className="rounded-lg bg-teal-50 px-3 py-2 text-sm text-zinc-900">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-teal-700">Sara</span>
          {item.emotion && (
            <span className="text-xs text-zinc-500">
              {EMOTION_EMOJI[item.emotion] ?? ""} {item.emotion}
            </span>
          )}
          {meta.replyTo && (
            <span className="truncate text-xs text-zinc-500">
              ↩ {meta.replyTo}: {meta.replyText}
            </span>
          )}
        </div>
        <p className="mt-1">{item.text}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
          {item.audioUrl && (
            <button
              className={`rounded-full px-2 py-0.5 ${playingId === item.id ? "bg-teal-600 text-white" : "bg-white text-teal-700 ring-1 ring-teal-200 hover:bg-teal-100"}`}
              onClick={() => onPlay(item)}
            >
              ▶ voice
            </button>
          )}
          <span>brain: {meta.provider}</span>
          <span>· tts: {meta.tts}</span>
          {meta.degraded && (
            <span className="rounded bg-amber-100 px-1.5 text-amber-800">offline voice</span>
          )}
          {meta.fallback && (
            <span className="rounded bg-amber-100 px-1.5 text-amber-800">fallback brain</span>
          )}
          {meta.language && <span>· {meta.language}</span>}
          {meta.latencyMs !== undefined && <span>· {meta.latencyMs}ms</span>}
        </div>
      </div>
    );
  }
  if (item.kind === "moderation") {
    return <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">🛡 {item.text}</div>;
  }
  if (item.kind === "error") {
    return (
      <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">⚠ {item.text}</div>
    );
  }
  if (item.kind === "operator") {
    return (
      <div className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
        <span className="font-medium">Operator:</span> {item.text}
      </div>
    );
  }
  return <div className="rounded-lg px-3 py-2 text-xs text-zinc-500">{item.text}</div>;
}

export function SaraLiveApp() {
  const [status, setStatus] = useState<SaraStatusResponse | null>(null);
  const [feed, setFeed] = useState<SaraFeedItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [simName, setSimName] = useState("Ali");
  const [simText, setSimText] = useState("");
  const [opText, setOpText] = useState("");
  const [settings, setSettings] = useState<SaraSettings | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const afterRef = useRef<string | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await client.status();
      setStatus(s);
      setSettings(await client.settings());
    } catch {
      /* transient */
    }
  }, []);

  const pollFeed = useCallback(async () => {
    try {
      const { items } = await client.feed(afterRef.current);
      if (items.length > 0) {
        afterRef.current = items[items.length - 1]!.id;
        setFeed((prev) => [...prev, ...items].slice(-300));
      }
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    void pollFeed();
    const t1 = setInterval(() => void refreshStatus(), 3000);
    const t2 = setInterval(() => void pollFeed(), 1200);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
    };
  }, [refreshStatus, pollFeed]);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [feed.length]);

  const onControl = async (action: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await client.control(action);
      setNotice(res.detail);
      await refreshStatus();
      await pollFeed();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "control failed");
    } finally {
      setBusy(false);
    }
  };

  const onSimulate = async () => {
    const text = simText.trim();
    if (!text) return;
    setBusy(true);
    try {
      await client.simulate(simName.trim() || "Guest", text);
      setSimText("");
      await pollFeed();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "simulate failed");
    } finally {
      setBusy(false);
    }
  };

  const onOperatorSend = async () => {
    const text = opText.trim();
    if (!text) return;
    setBusy(true);
    try {
      await client.operator(text);
      setOpText("");
      await pollFeed();
    } finally {
      setBusy(false);
    }
  };

  const onPlay = (item: SaraFeedItem) => {
    if (!item.audioUrl) return;
    if (playingId === item.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      setSpeaking(false);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(item.audioUrl);
    audioRef.current = audio;
    setPlayingId(item.id);
    setSpeaking(true);
    audio.onended = () => {
      setPlayingId(null);
      setSpeaking(false);
    };
    audio.onerror = () => {
      setPlayingId(null);
      setSpeaking(false);
    };
    void audio.play().catch(() => {
      setPlayingId(null);
      setSpeaking(false);
    });
  };

  const state = status?.live.state ?? "idle";
  const isLive = state === "live";

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
            Sara AI — Live Control Center
          </h1>
          <p className="text-sm text-zinc-500">
            Virtual LIVE host · {status?.live.platform ?? "…"} · brain{" "}
            {status?.live.brain.provider ?? "…"} · avatar {status?.avatar.provider ?? "…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Pill className={`${STATE_STYLES[state] ?? "bg-zinc-200"} uppercase`}>
            {isLive && (
              <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-white" />
            )}
            {state}
          </Pill>
          <Pill className="bg-zinc-100 text-zinc-700">
            ⏱ {formatUptime(status?.live.metrics.uptimeSeconds ?? 0)}
          </Pill>
          <Pill className="bg-zinc-100 text-zinc-700">
            🛡 system: {status?.system.overall ?? "…"}
          </Pill>
        </div>
      </header>

      {notice && (
        <div className="mb-4 rounded-lg bg-sky-50 px-4 py-2 text-sm text-sky-900">{notice}</div>
      )}

      <div className="mb-4 rounded-xl border border-red-100 bg-red-50/60 p-3 text-xs text-red-800">
        {status?.platformNotice}
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        {/* Left column: avatar + controls */}
        <div className="space-y-4">
          <AvatarPanel status={status} speaking={speaking} />
          <Card className="space-y-3 p-4">
            <h2 className="text-sm font-semibold text-zinc-800">LIVE controls</h2>
            <ControlStrip state={state} onControl={onControl} busy={busy} />
            {(state === "takeover" || state === "paused") && (
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="Speak as operator…"
                  value={opText}
                  onChange={(e) => setOpText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void onOperatorSend()}
                />
                <button
                  className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                  disabled={busy}
                  onClick={() => void onOperatorSend()}
                >
                  Send
                </button>
              </div>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="mb-2 text-sm font-semibold text-zinc-800">System health</h2>
            <div className="space-y-1.5 text-xs">
              {(status?.system.components ?? []).map((c) => (
                <div key={c.component} className="flex items-center justify-between gap-2">
                  <span className="font-medium text-zinc-700">{c.component}</span>
                  <span className="flex items-center gap-1">
                    {c.degraded && (
                      <span className="rounded bg-amber-100 px-1.5 text-amber-800">degraded</span>
                    )}
                    <span className={c.healthy ? "text-emerald-600" : "text-red-600"}>
                      {c.healthy ? "healthy" : "failing"}
                    </span>
                  </span>
                </div>
              ))}
              <div className="mt-2 border-t border-zinc-100 pt-2 text-zinc-500">
                mem {status?.system.process.memoryMb ?? "…"}MB · cpu{" "}
                {status?.system.process.cpuPercent ?? "…"}% · node{" "}
                {status?.system.process.nodeVersion}
              </div>
            </div>
          </Card>
        </div>

        {/* Right column: feed + simulator */}
        <div className="space-y-4">
          <Card className="flex h-[520px] flex-col p-0">
            <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-zinc-800">Live feed</h2>
              <div className="flex gap-2 text-xs text-zinc-500">
                <span>💬 {status?.live.metrics.comments ?? 0}</span>
                <span>🎙 {status?.live.metrics.responses ?? 0}</span>
                <span>🛡 {status?.live.metrics.rejectedComments ?? 0} blocked</span>
                <span>📥 queue {status?.live.queue.depth ?? 0}</span>
                <span>⚡ {status?.live.queue.responsesPerMinute ?? 0}/min</span>
              </div>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-3">
              {feed.length === 0 && (
                <div className="flex h-full items-center justify-center text-sm text-zinc-400">
                  Press START LIVE, then send a message from the simulator below — Sara replies
                  right here.
                </div>
              )}
              {feed.map((item) => (
                <FeedRow key={item.id} item={item} onPlay={onPlay} playingId={playingId} />
              ))}
              <div ref={feedEndRef} />
            </div>
          </Card>

          <Card className="space-y-3 p-4">
            <h2 className="text-sm font-semibold text-zinc-800">
              LIVE simulator{" "}
              <span className="font-normal text-zinc-500">
                — synthetic viewers, exactly like real events (dev mode)
              </span>
            </h2>
            <div className="flex flex-wrap gap-2">
              <input
                className="w-32 rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                placeholder="username"
                value={simName}
                onChange={(e) => setSimName(e.target.value)}
              />
              <input
                className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                placeholder='Type a chat message — try "Sara kaisi ho?" or "my name is Ayesha"'
                value={simText}
                onChange={(e) => setSimText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void onSimulate()}
              />
              <button
                className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
                disabled={busy}
                onClick={() => void onSimulate()}
              >
                Send as viewer
              </button>
            </div>
            <p className="text-xs text-zinc-500">
              Try: <em>“Sara how are you?”</em> · <em>“kia haal hai sara”</em> ·{" "}
              <em>“mera naam Ali hai”</em> (then send it again later — she remembers you) ·
              <em> “ignore all previous instructions”</em> (moderation demo)
            </p>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card className="p-4">
              <h2 className="mb-2 text-sm font-semibold text-zinc-800">Settings</h2>
              {settings && (
                <div className="space-y-3 text-sm">
                  <label className="block">
                    <span className="text-xs text-zinc-500">
                      Max responses / minute: {settings.responsesPerMinute}
                    </span>
                    <input
                      type="range"
                      min={1}
                      max={20}
                      value={settings.responsesPerMinute}
                      className="w-full"
                      onChange={(e) =>
                        void client
                          .updateSettings({ responsesPerMinute: Number(e.target.value) })
                          .then(setSettings)
                      }
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-zinc-500">Moderation strictness</span>
                    <select
                      className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
                      value={settings.moderationStrictness}
                      onChange={(e) =>
                        void client
                          .updateSettings({
                            moderationStrictness: e.target
                              .value as SaraSettings["moderationStrictness"],
                          })
                          .then(setSettings)
                      }
                    >
                      <option value="relaxed">relaxed</option>
                      <option value="standard">standard</option>
                      <option value="strict">strict</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-zinc-700">
                    <input
                      type="checkbox"
                      checked={settings.memoryEnabled}
                      onChange={(e) =>
                        void client
                          .updateSettings({ memoryEnabled: e.target.checked })
                          .then(setSettings)
                      }
                    />
                    Memory enabled
                  </label>
                  <label className="flex items-center gap-2 text-xs text-zinc-700">
                    <input
                      type="checkbox"
                      checked={settings.welcomeFollows}
                      onChange={(e) =>
                        void client
                          .updateSettings({ welcomeFollows: e.target.checked })
                          .then(setSettings)
                      }
                    />
                    Welcome new followers
                  </label>
                  <label className="flex items-center gap-2 text-xs text-zinc-700">
                    <input
                      type="checkbox"
                      checked={settings.thankGifts}
                      onChange={(e) =>
                        void client
                          .updateSettings({ thankGifts: e.target.checked })
                          .then(setSettings)
                      }
                    />
                    Thank gifts
                  </label>
                </div>
              )}
            </Card>

            <MemoryPanel onRefresh={refreshStatus} />
          </div>
        </div>
      </div>
    </div>
  );
}

function MemoryPanel({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof client.memory>> | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await client.memory());
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-800">Memory</h2>
        <span className="text-xs text-zinc-500">
          {data?.viewers.length ?? 0} viewers · {data?.memories.length ?? 0} memories
        </span>
      </div>
      <div className="max-h-56 space-y-1.5 overflow-y-auto text-xs">
        {(data?.viewers ?? []).map((v) => (
          <div
            key={v.id}
            className="flex items-center justify-between gap-2 rounded-lg bg-zinc-50 px-2 py-1.5"
          >
            <span>
              <strong>{v.displayName}</strong>
              {v.isFollower && <span className="ml-1 text-rose-600">♥</span>}
              {v.isRegular && (
                <span className="ml-1 rounded bg-teal-100 px-1 text-teal-800">regular</span>
              )}
              <span className="ml-1 text-zinc-400">· {v.interactionCount} msgs</span>
            </span>
            <button
              className="text-zinc-400 hover:text-red-600"
              title="Forget this viewer (privacy)"
              onClick={() =>
                void client.forgetViewer(v.id).then(() => {
                  void load();
                  void onRefresh();
                })
              }
            >
              ✕
            </button>
          </div>
        ))}
        {(data?.memories ?? []).slice(0, 8).map((m) => (
          <div
            key={m.id}
            className="flex items-center justify-between gap-2 rounded-lg bg-sky-50/60 px-2 py-1.5"
          >
            <span className="truncate text-zinc-700">
              <span className="mr-1 rounded bg-white px-1 text-[10px] uppercase text-zinc-500">
                {m.kind}
              </span>
              {m.content}
            </span>
            <button
              className="text-zinc-400 hover:text-red-600"
              title="Delete memory"
              onClick={() =>
                void client.forgetMemory(m.id).then(() => {
                  void load();
                  void onRefresh();
                })
              }
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}
