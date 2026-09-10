"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Download,
  FileJson,
  Film,
  LinkIcon,
  ListVideo,
  Loader2,
  Play,
  RefreshCw,
  Scissors,
  Search,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  Type,
  Upload,
  WandSparkles,
} from "lucide-react";
import { Badge, Card, CardContent, CardHeader, ErrorState, PageHeader, Spinner } from "@sara/ui";
import {
  clipFinderApi,
  formatTimecode,
  type ClipJobView,
  type ClipTitlesView,
  type ClipView,
  type JobOptions,
  type RenderView,
} from "@/lib/clip-finder-client";

const CATEGORIES: Array<{ id: string; label: string }> = [
  { id: "emotional", label: "Emotional" },
  { id: "funny", label: "Funny" },
  { id: "romantic", label: "Romantic" },
  { id: "sad", label: "Sad" },
  { id: "shocking", label: "Shocking" },
  { id: "suspense", label: "Suspense" },
  { id: "argument", label: "Argument" },
  { id: "inspirational", label: "Inspirational" },
  { id: "story", label: "Story Moment" },
  { id: "dialogue", label: "Best Dialogue" },
  { id: "hook", label: "Best Hook" },
  { id: "general", label: "General" },
];

const COPYRIGHT_NOTICE =
  "Make sure you have the necessary rights or permission to use the source video. AI editing does not make copyrighted material copyright-free.";

type View = "input" | "processing" | "results";

export function ClipFinderApp() {
  const [view, setView] = useState<View>("input");
  const [job, setJob] = useState<ClipJobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mock, setMock] = useState(false);

  const startJob = (created: ClipJobView) => {
    setJob(created);
    setMock(created.mock);
    setView("processing");
  };

  return (
    <>
      <PageHeader
        title="Clip Finder"
        description="Find the most engaging moments of a drama video: transcribed, scored, ranked and ready for vertical shorts."
        badge={<Badge variant="success">Live</Badge>}
      />
      {mock ? (
        <div className="mb-6 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200">
          <AlertTriangle className="size-4 shrink-0" />
          DEMO / MOCK DATA — no AI transcription credentials are configured, so speech understanding
          and scene analysis use clearly-labeled mock providers. Media processing (probe, scene
          cuts, renders) runs for real with ffmpeg.
        </div>
      ) : null}
      {error !== null ? (
        <div className="mb-6">
          <ErrorState message={error} onRetry={() => setError(null)} retryLabel="Dismiss" />
        </div>
      ) : null}
      {view === "input" ? (
        <InputPanel onStart={startJob} onError={setError} />
      ) : view === "processing" && job !== null ? (
        <JobProgress
          job={job}
          onUpdated={setJob}
          onCompleted={() => setView("results")}
          onFailed={() => setView("input")}
        />
      ) : view === "results" && job !== null ? (
        <ResultsView job={job} onNewJob={() => setView("input")} />
      ) : null}
    </>
  );
}

// ── Input panel ─────────────────────────────────────────────────────────────

function InputPanel({
  onStart,
  onError,
}: {
  onStart: (job: ClipJobView) => void;
  onError: (message: string) => void;
}) {
  const [mode, setMode] = useState<"url" | "upload">("url");
  const [sourceUrl, setSourceUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<JobOptions>({
    clipCount: 10,
    minDurationSeconds: 15,
    maxDurationSeconds: 60,
    aspectRatio: "9:16",
    language: "auto",
    categories: ["general"],
  });
  const [query, setQuery] = useState("");

  const submit = async () => {
    setBusy(true);
    try {
      const opts: JobOptions = { ...options, query: query.length > 0 ? query : undefined };
      const job =
        mode === "url"
          ? await clipFinderApi.createJobFromUrl(sourceUrl.trim(), opts)
          : await clipFinderApi.createJobFromUpload(file as File, opts);
      onStart(job);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not start the job.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader
          title="Video source"
          description="Local upload or a publicly accessible direct video URL."
        />
        <CardContent className="space-y-5">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode("url")}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${mode === "url" ? "bg-violet-500/15 text-violet-200 ring-1 ring-violet-500/30" : "text-zinc-400 hover:bg-zinc-800/60"}`}
            >
              <LinkIcon className="size-4" /> Source URL
            </button>
            <button
              type="button"
              onClick={() => setMode("upload")}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${mode === "upload" ? "bg-violet-500/15 text-violet-200 ring-1 ring-violet-500/30" : "text-zinc-400 hover:bg-zinc-800/60"}`}
            >
              <Upload className="size-4" /> Upload video
            </button>
          </div>

          {mode === "url" ? (
            <input
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://example.com/drama-episode.mp4 (direct link, no login/DRM)"
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-500/50"
            />
          ) : (
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-700 bg-zinc-950/50 px-4 py-10 text-sm text-zinc-400 hover:border-violet-500/40">
              <Film className="size-6 text-violet-300" />
              {file === null ? "Click to choose a video file (MP4, MKV, MOV, WebM…)" : file.name}
              <input
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          )}

          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
              <Sparkles className="size-3.5 text-violet-300" /> Natural language request (optional)
            </label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='e.g. "find the best emotional scenes between 20 and 45 seconds"'
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-500/50"
            />
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <NumberField
              label="Clip count"
              value={options.clipCount}
              min={1}
              max={50}
              onChange={(v) => setOptions({ ...options, clipCount: v })}
            />
            <NumberField
              label="Min length (s)"
              value={options.minDurationSeconds}
              min={3}
              max={600}
              onChange={(v) => setOptions({ ...options, minDurationSeconds: v })}
            />
            <NumberField
              label="Max length (s)"
              value={options.maxDurationSeconds}
              min={5}
              max={900}
              onChange={(v) => setOptions({ ...options, maxDurationSeconds: v })}
            />
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">Aspect ratio</label>
              <select
                value={options.aspectRatio}
                onChange={(e) =>
                  setOptions({
                    ...options,
                    aspectRatio: e.target.value as JobOptions["aspectRatio"],
                  })
                }
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500/50"
              >
                <option value="9:16">9:16 vertical</option>
                <option value="16:9">16:9 landscape</option>
                <option value="1:1">1:1 square</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium text-zinc-400">Clip categories</label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => {
                const active = options.categories.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() =>
                      setOptions({
                        ...options,
                        categories: active
                          ? options.categories.filter((x) => x !== c.id)
                          : [...options.categories.filter((x) => x !== "general"), c.id],
                      })
                    }
                    className={`rounded-lg px-2.5 py-1 text-xs transition ${active ? "bg-violet-500/20 text-violet-200 ring-1 ring-violet-500/40" : "bg-zinc-800/60 text-zinc-400 hover:bg-zinc-800"}`}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-zinc-800 pt-4">
            <p className="max-w-md text-[11px] leading-4 text-amber-300/80">{COPYRIGHT_NOTICE}</p>
            <button
              type="button"
              disabled={busy || (mode === "url" ? sourceUrl.trim().length === 0 : file === null)}
              onClick={() => void submit()}
              className="flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <WandSparkles className="size-4" />
              )}
              Analyze video
            </button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="How it works" />
        <CardContent>
          <ol className="space-y-3 text-sm text-zinc-400">
            {[
              "Read video and extract audio",
              "Transcribe dialogue (Urdu / Hindi / English…)",
              "Detect scene boundaries",
              "Score 14 dramatic dimensions per scene",
              "Rank and deduplicate candidate clips",
              "Generate subtitles and 9:16 renders",
            ].map((step, i) => (
              <li key={step} className="flex gap-3">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-[10px] font-bold text-violet-300">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-zinc-400">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
        className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500/50"
      />
    </div>
  );
}

// ── Job progress ────────────────────────────────────────────────────────────

const STAGE_LIST: Array<{ at: number; label: string }> = [
  { at: 0, label: "Preparing" },
  { at: 10, label: "Reading video" },
  { at: 20, label: "Extracting audio" },
  { at: 35, label: "Transcribing" },
  { at: 50, label: "Detecting scenes" },
  { at: 65, label: "Understanding scenes" },
  { at: 75, label: "Ranking clips" },
  { at: 85, label: "Generating subtitles" },
  { at: 95, label: "Rendering clips" },
  { at: 100, label: "Complete" },
];

function JobProgress({
  job,
  onUpdated,
  onCompleted,
  onFailed,
}: {
  job: ClipJobView;
  onUpdated: (job: ClipJobView) => void;
  onCompleted: () => void;
  onFailed: () => void;
}) {
  const doneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const fresh = await clipFinderApi.getJob(job.id);
        if (cancelled) return;
        onUpdated(fresh);
        if (!doneRef.current && fresh.status === "completed") {
          doneRef.current = true;
          onCompleted();
        }
        if (!doneRef.current && (fresh.status === "failed" || fresh.status === "cancelled")) {
          doneRef.current = true;
          onFailed();
        }
      } catch {
        // transient poll errors are ignored; the next tick retries
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);

  const failed = job.status === "failed";
  const cancelled = job.status === "cancelled";

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader
        title="Processing video"
        description={job.source?.originalName ?? job.source?.url ?? job.id}
        actions={
          failed || cancelled ? (
            <button
              type="button"
              onClick={() => void clipFinderApi.retryJob(job.id)}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              <RefreshCw className="size-3.5" /> Retry
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void clipFinderApi.cancelJob(job.id)}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10"
            >
              <Square className="size-3.5" /> Cancel
            </button>
          )
        }
      />
      <CardContent className="space-y-6">
        <div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium text-zinc-200">{job.stage}</span>
            <span className="font-mono text-xs text-zinc-400">{job.progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
            <div
              className={`h-full rounded-full transition-all duration-500 ${failed ? "bg-red-500" : cancelled ? "bg-zinc-500" : "bg-gradient-to-r from-violet-500 to-fuchsia-500"}`}
              style={{ width: `${job.progress}%` }}
            />
          </div>
        </div>

        {failed || cancelled ? (
          <ErrorState
            title={failed ? "Processing failed" : "Job cancelled"}
            message={job.error ?? "The job did not complete."}
          />
        ) : (
          <ul className="space-y-1.5">
            {STAGE_LIST.map((stage) => {
              const reached = job.progress >= stage.at;
              const current =
                (reached && STAGE_LIST.find((s) => s.at > job.progress) === undefined) ||
                (reached &&
                  STAGE_LIST.find((s) => s.at > job.progress)?.at !== undefined &&
                  job.progress < (STAGE_LIST.find((s) => s.at > job.progress)?.at ?? 101));
              return (
                <li
                  key={stage.label}
                  className={`flex items-center gap-2.5 text-sm ${reached ? "text-zinc-200" : "text-zinc-600"}`}
                >
                  {reached ? (
                    current ? (
                      <Spinner className="size-3.5 text-violet-300" />
                    ) : (
                      <span className="flex size-3.5 items-center justify-center text-emerald-400">
                        ✓
                      </span>
                    )
                  ) : (
                    <span className="size-3.5 rounded-full border border-zinc-700" />
                  )}
                  {stage.label}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ── Results ─────────────────────────────────────────────────────────────────

function ResultsView({ job, onNewJob }: { job: ClipJobView; onNewJob: () => void }) {
  const [clips, setClips] = useState<ClipView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<"rank" | "score" | "duration" | "category">("rank");
  const [category, setCategory] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<ClipView | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await clipFinderApi.getClips(job.id);
      setClips(data.clips);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load clips.");
    }
  }, [job.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const runSearch = async () => {
    if (query.trim().length === 0) return;
    try {
      const result = await clipFinderApi.search(job.id, query.trim());
      setClips(result.results);
      setSearchNote(result.criteriaDescription);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    }
  };

  const visible = useMemo(() => {
    let list = clips ?? [];
    if (category !== "all") list = list.filter((c) => c.category === category);
    const sorted = [...list];
    sorted.sort((a, b) =>
      sort === "score"
        ? b.score - a.score
        : sort === "duration"
          ? b.duration - a.duration
          : sort === "category"
            ? a.categoryLabel.localeCompare(b.categoryLabel) || a.rank - b.rank
            : a.rank - b.rank,
    );
    return sorted;
  }, [clips, category, sort]);

  const selectAll = async (selected: boolean) => {
    const list = clips ?? [];
    await Promise.allSettled(list.map((c) => clipFinderApi.patchClipSelect(c.id, selected)));
    await reload();
  };

  if (error !== null) {
    return <ErrorState message={error} onRetry={() => void reload()} />;
  }
  if (clips === null) {
    return (
      <div className="flex justify-center py-20 text-violet-300">
        <Spinner className="size-8" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onNewJob}
          className="flex items-center gap-2 rounded-lg bg-violet-500 px-3 py-2 text-xs font-medium text-white hover:bg-violet-400"
        >
          <Upload className="size-3.5" /> New analysis
        </button>
        <div className="relative flex-1 min-w-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void runSearch()}
            placeholder='e.g. "funniest moments under 30 seconds"'
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-2 pl-9 pr-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-500/50"
          />
        </div>
        <button
          type="button"
          onClick={() => void runSearch()}
          className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          Search
        </button>
        {clips.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => void selectAll(true)}
              className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => void selectAll(false)}
              className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              Deselect all
            </button>
          </>
        )}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300 outline-none"
        >
          <option value="rank">Sort: Rank</option>
          <option value="score">Sort: Score</option>
          <option value="duration">Sort: Duration</option>
          <option value="category">Sort: Category</option>
        </select>
      </div>

      {searchNote !== null ? (
        <p className="text-xs text-zinc-500">Search criteria: {searchNote}</p>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        <FilterChip active={category === "all"} label="All" onClick={() => setCategory("all")} />
        {[...new Set(clips.map((c) => c.category))].map((cat) => (
          <FilterChip
            key={cat}
            active={category === cat}
            label={clips.find((c) => c.category === cat)?.categoryLabel ?? cat}
            onClick={() => setCategory(cat)}
          />
        ))}
      </div>

      {visible.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center text-sm text-zinc-500">
            No clips matched. Try a different category or clear the search.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {visible.map((clip) => (
            <ClipCard
              key={clip.id}
              clip={clip}
              mock={job.mock}
              onEdit={() => setEditing(clip)}
              onChanged={() => void reload()}
              onError={setError}
            />
          ))}
        </div>
      )}

      {editing !== null ? (
        <ClipEditor
          clip={editing}
          mock={job.mock}
          onClose={() => setEditing(null)}
          onChanged={() => void reload()}
          onError={setError}
        />
      ) : null}
    </div>
  );
}

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-2.5 py-1 text-xs transition ${active ? "bg-violet-500/20 text-violet-200 ring-1 ring-violet-500/40" : "bg-zinc-800/60 text-zinc-400 hover:bg-zinc-800"}`}
    >
      {label}
    </button>
  );
}

function ClipCard({
  clip,
  mock,
  onEdit,
  onChanged,
  onError,
}: {
  clip: ClipView;
  mock: boolean;
  onEdit: () => void;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const scoreTone = clip.score >= 75 ? "success" : clip.score >= 55 ? "warning" : "default";
  return (
    <Card className="overflow-hidden">
      <div className="relative">
        <img
          src={`/api/v1/clip-finder/clips/${clip.id}/thumbnail`}
          alt={`Clip #${clip.rank} thumbnail`}
          className="h-40 w-full object-cover"
          loading="lazy"
        />
        <div className="absolute left-2 top-2 flex gap-1.5">
          <span className="rounded-md bg-black/70 px-2 py-0.5 text-xs font-bold text-white">
            #{clip.rank}
          </span>
          {mock ? (
            <span className="rounded-md bg-violet-600/80 px-2 py-0.5 text-[10px] font-bold text-white">
              MOCK
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="absolute inset-0 flex items-center justify-center bg-black/0 transition hover:bg-black/30"
          aria-label={`Preview clip #${clip.rank}`}
        >
          <span className="flex size-11 items-center justify-center rounded-full bg-white/90 opacity-0 transition hover:scale-105 group-hover:opacity-100">
            <Play className="size-5 text-zinc-900" />
          </span>
        </button>
      </div>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="accent">{clip.categoryLabel}</Badge>
          <Badge variant={scoreTone as "success" | "warning" | "default"}>
            Score {Math.round(clip.score)}
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-400">
          <span className="font-mono">
            {formatTimecode(clip.startTime)} – {formatTimecode(clip.endTime)}
          </span>
          <span>·</span>
          <span>{Math.round(clip.duration)}s</span>
        </div>
        <p className="line-clamp-2 text-sm text-zinc-300">{clip.reason}</p>
        <p className="line-clamp-2 text-xs italic leading-5 text-zinc-500">
          “{clip.transcriptPreview}”
        </p>
        <div className="flex flex-wrap gap-1.5 border-t border-zinc-800 pt-3">
          <CardAction icon={<Play className="size-3.5" />} label="Preview" onClick={onEdit} />
          <CardAction icon={<Scissors className="size-3.5" />} label="Edit" onClick={onEdit} />
          <CardAction
            icon={<WandSparkles className="size-3.5" />}
            label="Render"
            onClick={async () => {
              try {
                await clipFinderApi.render(clip.id, {
                  aspectRatio: "9:16",
                  subtitleStyle: "modern",
                  framing: "blur-pad",
                  quality: 1080,
                });
                onEdit();
              } catch (err) {
                onError(err instanceof Error ? err.message : "Render failed to queue.");
              }
            }}
          />
          <CardAction
            icon={<Trash2 className="size-3.5" />}
            label="Delete"
            danger
            onClick={async () => {
              try {
                await clipFinderApi.deleteClip(clip.id);
                onChanged();
              } catch (err) {
                onError(err instanceof Error ? err.message : "Delete failed.");
              }
            }}
          />
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={clip.selected}
              onChange={async (e) => {
                try {
                  await clipFinderApi.patchClipSelect(clip.id, e.target.checked);
                  onChanged();
                } catch {
                  onError("Could not update selection.");
                }
              }}
            />
            Select
          </label>
        </div>
      </CardContent>
    </Card>
  );
}

function CardAction({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition ${danger ? "text-red-400 hover:bg-red-500/10" : "text-zinc-300 hover:bg-zinc-800"}`}
    >
      {icon} {label}
    </button>
  );
}

// ── Clip editor ─────────────────────────────────────────────────────────────

function ClipEditor({
  clip,
  mock,
  onClose,
  onChanged,
  onError,
}: {
  clip: ClipView;
  mock: boolean;
  onClose: () => void;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [start, setStart] = useState(clip.startTime);
  const [end, setEnd] = useState(clip.endTime);
  const [busy, setBusy] = useState(false);
  const [style, setStyle] = useState("modern");
  const [aspect, setAspect] = useState("9:16");
  const [framing, setFraming] = useState("blur-pad");
  const [quality, setQuality] = useState(1080);
  const [commentary, setCommentary] = useState("");
  const [render, setRender] = useState<RenderView | null>(null);
  const [titles, setTitles] = useState<ClipTitlesView | null>(null);
  const [previewKey, setPreviewKey] = useState(0);

  const renderDone = render !== null && render.status === "completed" && render.hasOutput;

  useEffect(() => {
    if (
      render === null ||
      renderDone ||
      render.status === "failed" ||
      render.status === "cancelled"
    )
      return;
    const id = setInterval(async () => {
      try {
        const fresh = await clipFinderApi.getRender(render.id);
        setRender(fresh);
        if (fresh.status === "completed") setPreviewKey((k) => k + 1);
      } catch {
        // ignore transient
      }
    }, 1500);
    return () => clearInterval(id);
  }, [render, renderDone]);

  const applyTimes = async () => {
    setBusy(true);
    try {
      await clipFinderApi.patchClip(clip.id, start, end);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not update the clip.");
    } finally {
      setBusy(false);
    }
  };

  const regenSubtitles = async (uppercase = false) => {
    setBusy(true);
    try {
      await clipFinderApi.regenerateSubtitles(clip.id, style, uppercase);
      const srt = await fetch(`/api/v1/clip-finder/clips/${clip.id}/subtitles?style=${style}`).then(
        (r) => r.text(),
      );
      const blob = new Blob([srt], { type: "application/x-subrip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${clip.id}.srt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Subtitle generation failed.");
    } finally {
      setBusy(false);
    }
  };

  const startRender = async () => {
    setBusy(true);
    try {
      const created = await clipFinderApi.render(clip.id, {
        aspectRatio: aspect,
        subtitleStyle: style,
        framing,
        quality,
        commentaryText: commentary.length > 0 ? commentary : undefined,
      });
      setRender(created);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not queue the render.");
    } finally {
      setBusy(false);
    }
  };

  const genTitles = async () => {
    setBusy(true);
    try {
      setTitles(await clipFinderApi.titles(clip.id));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Title generation failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl border border-zinc-800 bg-zinc-900 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <ListVideo className="size-5 text-violet-300" />
            <h3 className="font-semibold text-zinc-100">
              Clip #{clip.rank} · {clip.categoryLabel}
            </h3>
            {mock ? <Badge variant="warning">MOCK</Badge> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="Close editor"
          >
            ✕
          </button>
        </div>

        <div className="space-y-6 p-6">
          {/* Timeline / preview */}
          <div>
            <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
              <span>Timeline</span>
              <span className="font-mono">
                {formatTimecode(start)} – {formatTimecode(end)} · {(end - start).toFixed(1)}s
              </span>
            </div>
            <div className="relative h-9 overflow-hidden rounded-lg bg-zinc-800">
              {renderDone && render !== null ? (
                <video
                  key={previewKey}
                  src={`/api/v1/clip-finder/renders/${render.id}/file`}
                  controls
                  className="h-full w-full object-contain"
                />
              ) : null}
              {!(renderDone && render !== null) ? (
                <>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(clip.endTime * 2, 60)}
                    step={0.1}
                    value={start}
                    onChange={(e) => setStart(Math.min(Number(e.target.value), end - 1))}
                    className="absolute inset-0 w-full accent-violet-500"
                    aria-label="Clip start"
                  />
                  <input
                    type="range"
                    min={0}
                    max={Math.max(clip.endTime * 2, 60)}
                    step={0.1}
                    value={end}
                    onChange={(e) => setEnd(Math.max(Number(e.target.value), start + 1))}
                    className="absolute inset-0 w-full accent-fuchsia-500"
                    aria-label="Clip end"
                  />
                </>
              ) : null}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <NumberField
                label="Start (s)"
                value={Math.round(start * 10) / 10}
                min={0}
                max={100000}
                onChange={(v) => setStart(v)}
              />
              <NumberField
                label="End (s)"
                value={Math.round(end * 10) / 10}
                min={1}
                max={100000}
                onChange={(v) => setEnd(v)}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void applyTimes()}
                className="mt-5 rounded-lg bg-violet-500 px-3 py-2 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-40"
              >
                Apply times
              </button>
            </div>
          </div>

          {/* Render settings */}
          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">Aspect ratio</label>
              <select
                value={aspect}
                onChange={(e) => setAspect(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              >
                <option value="9:16">9:16</option>
                <option value="16:9">16:9</option>
                <option value="1:1">1:1</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                Subtitle style
              </label>
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              >
                <option value="classic">Classic</option>
                <option value="modern">Modern</option>
                <option value="minimal">Minimal</option>
                <option value="large">Large</option>
                <option value="shorts">Shorts</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">Framing</label>
              <select
                value={framing}
                onChange={(e) => setFraming(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              >
                <option value="blur-pad">Blur pad (keeps everyone visible)</option>
                <option value="center-crop">Center crop</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">Quality</label>
              <select
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              >
                <option value={1080}>1080p</option>
                <option value={720}>720p</option>
              </select>
            </div>
          </div>

          {/* Commentary */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
              <Type className="size-3.5" /> Optional commentary (your own words, overlaid &amp;
              labeled)
            </label>
            <textarea
              value={commentary}
              onChange={(e) => setCommentary(e.target.value)}
              rows={2}
              placeholder="Optional — text commentary is clearly marked [Commentary] and stays distinct from the original audio."
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-500/50"
            />
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-4">
            <button
              type="button"
              disabled={busy}
              onClick={() => void startRender()}
              className="flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-40"
            >
              <Settings2 className="size-4" /> Render {aspect} clip
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void regenSubtitles(false)}
              className="flex items-center gap-2 rounded-xl border border-zinc-700 px-3 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
            >
              <RefreshCw className="size-4" /> Regenerate subtitles ({style})
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void genTitles()}
              className="flex items-center gap-2 rounded-xl border border-zinc-700 px-3 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
            >
              <Sparkles className="size-4" /> Generate titles &amp; hashtags
            </button>
          </div>

          {/* Render status */}
          {render !== null && !renderDone ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-zinc-300">
                  <Loader2 className="size-4 animate-spin text-violet-300" /> Render {render.status}{" "}
                  — {render.progress}%
                </span>
                <button
                  type="button"
                  onClick={() => void clipFinderApi.cancelRender(render.id)}
                  className="text-xs text-red-400 hover:underline"
                >
                  Cancel render
                </button>
              </div>
              {render.status === "failed" ? (
                <p className="text-xs text-red-300">{render.error}</p>
              ) : null}
            </div>
          ) : null}

          {renderDone && render !== null ? (
            <div className="space-y-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <p className="flex items-center gap-2 text-sm font-medium text-emerald-300">
                <Download className="size-4" /> Export ready — {render.width}×{render.height} ·
                H.264 · AAC · MP4
              </p>
              <video
                key={previewKey}
                src={`/api/v1/clip-finder/renders/${render.id}/file`}
                controls
                className="max-h-72 w-full rounded-lg bg-black"
              />
              <div className="flex flex-wrap gap-2 text-xs">
                <a
                  href={`/api/v1/clip-finder/renders/${render.id}/file`}
                  download
                  className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 px-3 py-2 text-emerald-200 hover:bg-emerald-500/10"
                >
                  <Download className="size-3.5" /> clip.mp4
                </a>
                <a
                  href={`/api/v1/clip-finder/renders/${render.id}/srt`}
                  download
                  className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 px-3 py-2 text-emerald-200 hover:bg-emerald-500/10"
                >
                  <FileJson className="size-3.5" /> clip.srt
                </a>
                <a
                  href={`/api/v1/clip-finder/renders/${render.id}/metadata`}
                  download
                  className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 px-3 py-2 text-emerald-200 hover:bg-emerald-500/10"
                >
                  <FileJson className="size-3.5" /> clip.json
                </a>
              </div>
              <p className="text-[11px] leading-4 text-amber-300/80">{COPYRIGHT_NOTICE}</p>
            </div>
          ) : null}

          {/* Titles */}
          {titles !== null ? (
            <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                AI metadata {titles.mock ? "· DEMO / MOCK DATA" : ""}
              </p>
              <ul className="space-y-1.5 text-sm text-zinc-200">
                {titles.titles.map((t) => (
                  <li key={t} className="flex gap-2">
                    <span className="text-violet-400">•</span> {t}
                  </li>
                ))}
              </ul>
              <ul className="space-y-1 text-xs text-zinc-400">
                {titles.descriptions.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-1.5">
                {titles.hashtags.map((h) => (
                  <span
                    key={h}
                    className="rounded-md bg-zinc-800/80 px-2 py-0.5 text-[11px] text-violet-300"
                  >
                    {h}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
