import {
  jobsCancelSyncJob,
  jobsGetRuntimeConfig,
  jobsGetSyncJobStatus,
  jobsStartSyncJob,
  type SyncJobStatusResponse,
  utilsHealthCheck,
} from "@/client"
import { request, sseJsonStream } from "./base"

/**
 * Jobs API — split between the two clients along **response-model openness**.
 *
 * F2's rule: a call moves to the generated client when its response model is
 * *closed*, and stays hand-written when the model is open
 * (`ConfigDict(extra="allow")`). An open model renders in OpenAPI as a
 * top-level `[key: string]: unknown` index signature, so every conditional key
 * riding in `extra` arrives typed as `unknown` — the generated type is then
 * strictly *worse* than the hand-written one. See ADR-006.
 *
 * The prize here was never the call wrappers; it was the four server response
 * shapes this file used to re-declare by hand (`RuntimeConfig`,
 * `SyncJobStatus`, `SyncJobChannelStatus`, and the two inline sync-job
 * envelopes). Those are now aliases onto the generated types, so the compiler
 * keeps them in step with the backend the way B7 did for domain types.
 */

/**
 * The scheduler's view of one job — **hand-written on purpose.**
 *
 * `app/schemas/jobs.py::JobStatusEntry` is open: `pauseUntil` and `detail` are
 * conditional and travel through `extra` rather than being declared, because
 * declaring them would emit an explicit `null` on every job that lacks them.
 * The generated `JobStatusEntry` therefore carries an index signature and types
 * `pauseUntil` as `unknown`. This declaration is more precise, so it stays.
 */
export type JobStatusEntry = {
  enabled: boolean
  lastRun: number | null
  lastStatus: string
  lastError?: string | null
  nextRun?: number | null
  pauseUntil?: number | null
}

export type {
  /** One channel's progress inside a sync job. */
  ChannelSyncProgress as SyncJobChannelStatus,
  /**
   * The resolved runtime configuration.
   *
   * The generated type is a large upgrade: `sync`, `scraper`, `network`,
   * `jobs`, `retention` and `constants` were each `Record<string, unknown>`
   * here and are now their own declared models.
   */
  RuntimeConfigResponse as RuntimeConfig,
  SyncJobStatusResponse as SyncJobStatus,
} from "@/client"

export const jobsApi = {
  // Open response model (`JobStatusEntry`) — stays on the hand-written client.
  jobsStatus: () =>
    request<Record<string, JobStatusEntry>>("/api/v1/jobs/status"),

  triggerJob: (jobId: string) =>
    request<JobStatusEntry>(`/api/v1/jobs/${jobId}/trigger`, {
      method: "POST",
    }),

  updateJob: (jobId: string, enabled: boolean) =>
    request<JobStatusEntry>(`/api/v1/jobs/${jobId}`, {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    }),

  // Closed response models — generated.
  startSyncJob: (body: {
    channelIds?: string[]
    source?: string
    syncMode?: "sync_all" | "bulk" | "individual" | "recheck_restricted"
  }) => jobsStartSyncJob({ body }),

  getSyncJobStatus: (jobId: string) =>
    jobsGetSyncJobStatus({ path: { job_id: jobId } }),

  cancelSyncJob: (jobId: string) =>
    jobsCancelSyncJob({ path: { job_id: jobId } }),

  healthCheck: () => utilsHealthCheck(),

  getRuntimeConfig: () => jobsGetRuntimeConfig(),
}

/**
 * Subscribe to sync job progress via SSE (full status snapshots).
 *
 * Stays hand-written whatever the model's openness: codegen cannot express a
 * long-lived `text/event-stream`. It is typed off the *generated* status model
 * so the stream and the one-shot `getSyncJobStatus` reconnect fallback cannot
 * drift apart.
 */
export async function* subscribeSyncJobEvents(
  jobId: string,
  signal?: AbortSignal,
): AsyncGenerator<SyncJobStatusResponse> {
  yield* sseJsonStream<SyncJobStatusResponse>(
    `/api/v1/jobs/sync/${jobId}/events`,
    { signal },
  )
}
