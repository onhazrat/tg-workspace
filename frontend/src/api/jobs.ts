import { request } from "./base";

export type JobStatusEntry = {
  enabled: boolean;
  lastRun: number | null;
  lastStatus: string;
  lastError?: string | null;
  nextRun?: number | null;
  pauseUntil?: number | null;
};

export type SyncJobChannelStatus = {
  channelId: string;
  channelName: string;
  status: string;
  postsFetched: number;
  newLatestId?: number;
  error?: string;
};

export type SyncJobStatus = {
  jobId: string;
  status: string;
  source: string;
  channels: SyncJobChannelStatus[];
  createdAt: number;
  finishedAt?: number;
};

export const jobsApi = {
  jobsStatus: () => request<Record<string, JobStatusEntry>>("/api/v1/jobs/status"),

  triggerJob: (jobId: string) =>
    request<JobStatusEntry>(`/api/v1/jobs/${jobId}/trigger`, { method: "POST" }),

  updateJob: (jobId: string, enabled: boolean) =>
    request<JobStatusEntry>(`/api/v1/jobs/${jobId}`, {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    }),

  startSyncJob: (body: { channelIds?: string[]; source?: string }) =>
    request<{ jobId: string }>("/api/v1/jobs/sync", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getSyncJobStatus: (jobId: string) =>
    request<SyncJobStatus>(`/api/v1/jobs/sync/${jobId}`),

  cancelSyncJob: (jobId: string) =>
    request<{ jobId: string; status: string }>(`/api/v1/jobs/sync/${jobId}/cancel`, {
      method: "POST",
    }),

  healthCheck: () => request<boolean>("/api/v1/utils/health-check/"),
};
