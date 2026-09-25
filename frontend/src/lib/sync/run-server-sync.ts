/**
 * `runServerSync`, the body of `useSyncJob`'s starter, with its I/O injected.
 *
 * The hook binds the network, the toasts and its own state setters and calls
 * this; a test passes fakes instead, which is how the rules below are pinned
 * without `mock.module` (process-wide in Bun). What it decides: when a sync is
 * refused outright, which channels show as syncing and for how long, when the
 * failure streak pauses auto-sync, and which toast a failure gets.
 */

import type { Dispatch, SetStateAction } from "react"

import type { SyncJobStatus } from "@/api"
import { logger } from "@/lib/logger"
import {
  isTerminalSyncStatus,
  shouldFallBackToPolling,
} from "@/lib/sync/job-state"
import type { ChannelStats } from "@/types"

/** How the sync was triggered; the server records it on the job. */
export type SyncMode = "sync_all" | "bulk" | "individual" | "recheck_restricted"

type SyncedChannel = SyncJobStatus["channels"][number]

export interface RunServerSyncIO {
  isOffline: boolean
  channelCount: number
  startSyncJob: (body: {
    channelIds: string[]
    source: string
    syncMode: SyncMode
  }) => Promise<{ jobId: string }>
  waitSyncJob: (jobId: string) => Promise<SyncJobStatus>
  getChannelStats: (channelId: string) => Promise<ChannelStats | null>
  loadChannels: () => Promise<void>
  invalidatePostViews: () => void
  setScrapingChannels: Dispatch<SetStateAction<Set<string>>>
  setChannelStats: Dispatch<SetStateAction<Record<string, ChannelStats>>>
  setConsecutiveFailures: Dispatch<SetStateAction<number>>
  setAutoSyncPauseUntil: Dispatch<SetStateAction<number | null>>
  notify: {
    warning: (message: string) => void
    error: (message: string) => void
  }
  now: () => number
}

export interface RunServerSyncArgs {
  channelIds: string[]
  channelNames: string[]
  source: string
  refresh: boolean
  syncMode: SyncMode
}

export const OFFLINE_MESSAGE =
  "Server offline — sync disabled. Browsing cached data only."
export const NO_CHANNELS_MESSAGE =
  "No channels available to sync. Try re-adding the channel or run the user_id backfill script."
export const PAUSED_MESSAGE =
  "Auto-sync paused for 10 minutes due to consecutive failures."
export const AUTO_SYNC_PAUSE_MS = 10 * 60 * 1000

/** Auto-sync pauses after `max(3, channelCount)` failures in a row. */
export function failureStreakPauses(streak: number, channelCount: number) {
  return streak >= Math.max(3, channelCount)
}

export function failureToast(failures: SyncedChannel[]): string {
  if (failures.length === 1) {
    return `Sync failed for @${failures[0].channelName}: ${failures[0].error || "Sync failed"}`
  }
  return `${failures.length} channel sync(s) failed`
}

function withNames(prev: Set<string>, names: string[], add: boolean) {
  const next = new Set(prev)
  for (const name of names) {
    if (add) next.add(name)
    else next.delete(name)
  }
  return next
}

async function startJob(io: RunServerSyncIO, args: RunServerSyncArgs) {
  try {
    const { jobId } = await io.startSyncJob({
      channelIds: args.channelIds,
      source: args.source,
      syncMode: args.syncMode,
    })
    return jobId
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes("No channels to sync"))
      io.notify.error(NO_CHANNELS_MESSAGE)
    throw err
  }
}

/** A success clears the streak and refreshes each synced channel's stats. */
async function applySuccesses(io: RunServerSyncIO, successes: SyncedChannel[]) {
  if (successes.length === 0) return
  io.setConsecutiveFailures(0)
  io.setAutoSyncPauseUntil(null)
  for (const ch of successes) {
    const stats = await io.getChannelStats(ch.channelId)
    if (!stats) continue
    // `newLatestId` is genuinely nullable — `sync_orchestrator` sends
    // `final_latest_id or None` — and `ChannelStats.latestId` is not.
    io.setChannelStats((prev) => ({
      ...prev,
      [ch.channelName]: { ...stats, latestId: ch.newLatestId ?? undefined },
    }))
  }
}

function applyFailures(io: RunServerSyncIO, failures: SyncedChannel[]) {
  if (failures.length === 0) return
  io.setConsecutiveFailures((prev) => {
    const next = prev + failures.length
    if (failureStreakPauses(next, io.channelCount)) {
      io.setAutoSyncPauseUntil(io.now() + AUTO_SYNC_PAUSE_MS)
      io.notify.error(PAUSED_MESSAGE)
    }
    return next
  })
  io.notify.error(failureToast(failures))
}

/**
 * Apply each progress event in turn and stop at the first terminal one.
 * `null` means the stream ended before the job did.
 */
export async function followUntilTerminal(
  events: AsyncIterable<SyncJobStatus>,
  apply: (status: SyncJobStatus) => void,
): Promise<SyncJobStatus | null> {
  for await (const status of events) {
    apply(status)
    if (isTerminalSyncStatus(status.status)) return status
  }
  return null
}

export interface WaitSyncJobIO {
  subscribe: (
    jobId: string,
    signal: AbortSignal,
  ) => AsyncIterable<SyncJobStatus>
  getStatus: (jobId: string) => Promise<SyncJobStatus>
  cancel: (jobId: string) => Promise<unknown>
  apply: (status: SyncJobStatus) => void
  /** Poll to a terminal state; used when the event stream fails. */
  pollFallback: (jobId: string) => Promise<SyncJobStatus>
  timeoutMs: number
}

export const SYNC_TIMED_OUT_MESSAGE = "Sync job timed out"

/**
 * Follow a job to a terminal state over its event stream.
 *
 * A stream that ends before the job does is settled by one status read. A
 * stream that fails falls back to polling, unless the failure is the deadline
 * aborting it: then the job is cancelled server-side, because nobody is left
 * watching it.
 */
export async function waitSyncJob(
  io: WaitSyncJobIO,
  jobId: string,
): Promise<SyncJobStatus> {
  const abortController = new AbortController()
  const timeoutId = setTimeout(() => abortController.abort(), io.timeoutMs)
  try {
    const terminal = await followUntilTerminal(
      io.subscribe(jobId, abortController.signal),
      io.apply,
    )
    if (terminal) return terminal
    const finalStatus = await io.getStatus(jobId)
    io.apply(finalStatus)
    return finalStatus
  } catch (err) {
    if (!shouldFallBackToPolling(abortController.signal.aborted)) {
      await io.cancel(jobId)
      throw new Error(SYNC_TIMED_OUT_MESSAGE)
    }
    console.warn(
      "[Scraper] SSE sync progress failed, falling back to polling:",
      err,
    )
    return io.pollFallback(jobId)
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function runServerSync(
  io: RunServerSyncIO,
  args: RunServerSyncArgs,
): Promise<void> {
  if (io.isOffline) {
    io.notify.warning(OFFLINE_MESSAGE)
    return
  }
  if (args.channelIds.length === 0) return
  logger.debug(
    `[Scraper] Starting server sync for ${args.channelIds.length} channel(s) from ${args.source}`,
  )
  io.setScrapingChannels((prev) => withNames(prev, args.channelNames, true))
  try {
    const result = await io.waitSyncJob(await startJob(io, args))
    const failures = result.channels.filter((ch) => ch.status === "failed")
    const successes = result.channels.filter((ch) => ch.status === "success")
    await applySuccesses(io, successes)
    applyFailures(io, failures)
    // Always reload channels so resolved startId appears after first sync.
    await io.loadChannels()
    if (args.refresh) io.invalidatePostViews()
    if (failures.length > 0 && successes.length === 0) {
      throw new Error(failures[0].error || "Sync failed")
    }
  } finally {
    io.setScrapingChannels((prev) => withNames(prev, args.channelNames, false))
  }
}
