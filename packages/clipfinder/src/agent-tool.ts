/**
 * `video_clip_finder` agent tool — the Sara-orchestrator seam (the full
 * orchestrator lands in Phase 3; this manifest is its contract).
 *
 * Permissions: READ_VIDEO + ANALYZE_VIDEO to analyze; CREATE_DERIVATIVE is
 * additionally required for rendering/export. Publishing is explicitly NOT
 * part of this tool — social upload flows arrive separately with approval.
 */
import { clipFinderOptionsSchema } from "./schema.js";
import {
  CLIP_FINDER_SCOPES,
  type AgentContext,
  type AgentToolDefinition,
  type AgentToolResult,
} from "./types.js";
import { DuplicateJobError, type JobManager, SourceRejectedError } from "./jobs.js";
import { describeCriteria, parseSearchQuery } from "./nl-search.js";

export const VIDEO_CLIP_FINDER_TOOL: AgentToolDefinition = {
  name: "video_clip_finder",
  description:
    "Analyze a drama video the user has rights to use: transcribe dialogue, detect scenes, score and rank the most interesting moments, and prepare vertical clips with subtitles. Analysis only — publishing is a separate, approval-gated flow.",
  requiredScopes: [CLIP_FINDER_SCOPES.READ_VIDEO, CLIP_FINDER_SCOPES.ANALYZE_VIDEO],
  renderScopes: [CLIP_FINDER_SCOPES.CREATE_DERIVATIVE],
  inputSchema: {
    type: "object",
    properties: {
      source: { type: "string", description: "Public video URL, or an uploaded file reference." },
      clipCount: { type: "integer", minimum: 1, maximum: 50, default: 10 },
      categories: {
        type: "array",
        items: {
          type: "string",
          enum: [
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
          ],
        },
      },
      minDuration: { type: "number", minimum: 3, default: 15 },
      maxDuration: { type: "number", minimum: 5, default: 60 },
      aspectRatio: { type: "string", enum: ["9:16", "16:9", "1:1"], default: "9:16" },
      language: { type: "string", default: "auto" },
      query: {
        type: "string",
        description: "Free-text request, e.g. 'funniest scenes under 30 seconds'.",
      },
    },
    required: ["source"],
  },
};

export interface ClipFinderToolDeps {
  manager: JobManager;
}

/** Parse a user phrase like "Sara, find 10 emotional scenes from this video." */
export function parseClipFinderUtterance(utterance: string): {
  intent: "clip_finder" | "unknown";
  criteria: ReturnType<typeof parseSearchQuery>;
  reply: string;
} {
  const lower = utterance.toLowerCase();
  const looksLikeClipFinder =
    /\b(clips?|scenes?|moments?|highlights?|shorts?)\b/.test(lower) &&
    /\b(find|show|get|prepare|analyz\w+|extract|cut\w*|rank)\b/.test(lower);
  if (!looksLikeClipFinder) {
    return { intent: "unknown", criteria: { categories: [], unmatched: [] }, reply: "" };
  }
  const criteria = parseSearchQuery(utterance);
  const count = criteria.clipCount ?? 10;
  const focus =
    criteria.categories.length > 0 ? criteria.categories.slice(0, 2).join("/") : "highlight";
  return {
    intent: "clip_finder",
    criteria,
    reply: `I'll analyze the video and rank ${count} ${focus} moment${count === 1 ? "" : "s"} for you. ${describeCriteria(criteria)}.`,
  };
}

/** Invoke the tool with permission checks (denied → FORBIDDEN, audited upstream). */
export async function invokeClipFinderTool(
  input: {
    source?: string;
    query?: string;
    clipCount?: number;
    categories?: string[];
    minDuration?: number;
    maxDuration?: number;
    aspectRatio?: string;
    language?: string;
  },
  ctx: AgentContext,
  deps: ClipFinderToolDeps,
): Promise<AgentToolResult> {
  for (const scope of VIDEO_CLIP_FINDER_TOOL.requiredScopes) {
    if (!ctx.hasScope(scope)) {
      return {
        accepted: false,
        message: `Permission denied: the video_clip_finder tool requires the "${scope}" scope.`,
      };
    }
  }
  if (input.source === undefined || input.source.length === 0) {
    return { accepted: false, message: "A video source (public URL) is required." };
  }
  const options = clipFinderOptionsSchema.parse({
    clipCount: input.clipCount ?? 10,
    minDurationSeconds: input.minDuration ?? 15,
    maxDurationSeconds: input.maxDuration ?? 60,
    aspectRatio: input.aspectRatio ?? "9:16",
    language: input.language ?? "auto",
    categories:
      input.categories ??
      (input.query !== undefined ? parseSearchQuery(input.query).categories : ["general"]),
    query: input.query,
  });
  try {
    const { jobId } = await deps.manager.createJobFromUrl(input.source, options);
    const job = deps.manager.getJob(jobId);
    return {
      accepted: true,
      jobId,
      status: "queued",
      message: `I'll analyze the video and rank the most interesting moments for you. Job ${jobId} is queued.`,
      statusUrl: `/api/v1/clip-finder/jobs/${jobId}`,
      ...job,
    } as AgentToolResult;
  } catch (err) {
    if (err instanceof SourceRejectedError) {
      return { accepted: false, message: err.message };
    }
    if (err instanceof DuplicateJobError) {
      return {
        accepted: true,
        jobId: err.jobId,
        status: "queued",
        message: "This video is already being analyzed — showing the existing job.",
        statusUrl: `/api/v1/clip-finder/jobs/${err.jobId}`,
      };
    }
    return {
      accepted: false,
      message: `Could not start the analysis: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
