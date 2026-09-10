/**
 * Typed client for the Clip Finder API. Same-origin relative URLs (ADR 0002).
 */
import type { ApiResponse } from "@sara/types";

export interface ClipJobView {
  id: string;
  status:
    | "queued"
    | "processing"
    | "transcribing"
    | "analyzing"
    | "rendering"
    | "completed"
    | "failed"
    | "cancelled";
  progress: number;
  stage: string;
  error: string | null;
  mock: boolean;
  counts: { clips: number };
  source: {
    id: string;
    kind: "url" | "upload";
    url: string | null;
    originalName: string | null;
    durationSeconds: number | null;
    width: number | null;
    height: number | null;
  } | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface ClipView {
  id: string;
  jobId: string;
  rank: number;
  category: string;
  categoryLabel: string;
  startTime: number;
  endTime: number;
  duration: number;
  score: number;
  reason: string;
  transcriptPreview: string;
  selected: boolean;
  hasThumbnail: boolean;
}

export interface RenderView {
  id: string;
  clipId: string;
  status: string;
  progress: number;
  aspectRatio: string;
  width: number | null;
  height: number | null;
  subtitleStyle: string;
  framing: string;
  error: string | null;
  sizeBytes: number | null;
  hasOutput: boolean;
}

export interface ClipTitlesView {
  clipId: string;
  mock: boolean;
  titles: string[];
  descriptions: string[];
  hashtags: string[];
}

export interface JobOptions {
  clipCount: number;
  minDurationSeconds: number;
  maxDurationSeconds: number;
  aspectRatio: "9:16" | "16:9" | "1:1";
  language: string;
  categories: string[];
  query?: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json()) as ApiResponse<T>;
  if (!body.ok) {
    throw new Error(body.error.message);
  }
  return body.data;
}

export const clipFinderApi = {
  createJobFromUrl(sourceUrl: string, options: JobOptions): Promise<ClipJobView> {
    return request<ClipJobView>("/api/v1/clip-finder/jobs", {
      method: "POST",
      body: JSON.stringify({ sourceUrl, options }),
    });
  },

  createJobFromUpload(file: File, options: JobOptions): Promise<ClipJobView> {
    const form = new FormData();
    form.append("file", file);
    form.append("options", JSON.stringify(options));
    return fetch("/api/v1/clip-finder/jobs", { method: "POST", body: form }).then(async (res) => {
      const body = (await res.json()) as ApiResponse<ClipJobView>;
      if (!body.ok) throw new Error(body.error.message);
      return body.data;
    });
  },

  getJob(id: string): Promise<ClipJobView> {
    return request<ClipJobView>(`/api/v1/clip-finder/jobs/${id}`);
  },

  getClips(jobId: string): Promise<{ mock: boolean; notice: string; clips: ClipView[] }> {
    return request(`/api/v1/clip-finder/jobs/${jobId}/clips`);
  },

  search(
    jobId: string,
    query: string,
  ): Promise<{ criteriaDescription: string; results: ClipView[] }> {
    return request(`/api/v1/clip-finder/jobs/${jobId}/search`, {
      method: "POST",
      body: JSON.stringify({ query }),
    });
  },

  cancelJob(id: string): Promise<ClipJobView> {
    return request<ClipJobView>(`/api/v1/clip-finder/jobs/${id}/cancel`, { method: "POST" });
  },

  retryJob(id: string): Promise<ClipJobView> {
    return request<ClipJobView>(`/api/v1/clip-finder/jobs/${id}/retry`, { method: "POST" });
  },

  deleteJob(id: string): Promise<{ deleted: boolean }> {
    return request(`/api/v1/clip-finder/jobs/${id}`, { method: "DELETE" });
  },

  patchClip(id: string, startTime: number, endTime: number): Promise<ClipView> {
    return request<ClipView>(`/api/v1/clip-finder/clips/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ startTime, endTime }),
    });
  },

  regenerateSubtitles(id: string, style: string, uppercase: boolean): Promise<{ srt: string }> {
    return request(`/api/v1/clip-finder/clips/${id}/subtitles`, {
      method: "POST",
      body: JSON.stringify({ style, uppercase }),
    });
  },

  render(id: string, options: Record<string, unknown>): Promise<RenderView> {
    return request<RenderView>(`/api/v1/clip-finder/clips/${id}/render`, {
      method: "POST",
      body: JSON.stringify(options),
    });
  },

  getRender(id: string): Promise<RenderView> {
    return request<RenderView>(`/api/v1/clip-finder/renders/${id}`);
  },

  patchClipSelect(id: string, selected: boolean): Promise<ClipView> {
    return request<ClipView>(`/api/v1/clip-finder/clips/${id}/select`, {
      method: "POST",
      body: JSON.stringify({ selected }),
    });
  },

  deleteClip(id: string): Promise<{ deleted: boolean }> {
    return request(`/api/v1/clip-finder/clips/${id}`, { method: "DELETE" });
  },

  cancelRender(id: string): Promise<RenderView> {
    return request<RenderView>(`/api/v1/clip-finder/renders/${id}/cancel`, { method: "POST" });
  },

  titles(id: string): Promise<ClipTitlesView> {
    return request(`/api/v1/clip-finder/clips/${id}/titles`, { method: "POST" });
  },
};

export function formatTimecode(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
