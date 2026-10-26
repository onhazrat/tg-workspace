/**
 * The rules `AIContext`'s Summary actions follow, with no React, so they can be
 * tested directly. The context keeps the streaming, the saving and the state;
 * the lookup and count calls are passed in.
 */
import { ApiError } from "@/api/base"
import type { AttemptFrame } from "@/api/data"
import {
  isFailedSummary,
  isPendingSummary,
  resolvePastedSummaryModel,
} from "@/constants"
import { scopeRange } from "@/lib/scope/artifact-scope"
import type { Post, Summary } from "@/types"
import { extractCitedPosts, parseCitationRefs } from "./summary-model"

export const NO_POSTS_MESSAGE =
  "No posts found in the selected date range. Try scraping first."

type CitationRef = { channelName: string; postId: number }

/**
 * The posts a summary cites. `held` is what the run already had in hand (the
 * semantic path); the scope path never holds its posts, so it looks up only the
 * cited ones by natural key instead of refetching the whole range.
 */
export async function resolveCitedPosts(
  text: string,
  held: Post[] | undefined,
  lookup: (refs: CitationRef[]) => Promise<Post[]>,
): Promise<Record<string, Post>> {
  const pool = held ?? (await lookup(parseCitationRefs(text)))
  return extractCitedPosts(text, pool)
}

/** A pasted response the pending Summary can take, or why it cannot. */
/** A Generate failure the server already recorded as an Attempt. */
export class RecordedFailure extends Error {}

/**
 * Feed an Attempt's watch to `onText`, piece by piece (SFR-02). True when the
 * watch ended by itself, which is the cue to read the Summary again; false
 * when the page stopped watching. A broken connection ends it too: the
 * Summary's rows say how the Attempt really stands.
 */
export async function followAttempt(
  frames: AsyncIterable<AttemptFrame>,
  onText: (text: string) => void,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    for await (const frame of frames) if ("text" in frame) onText(frame.text)
  } catch (err: unknown) {
    if (!signal.aborted) console.error(err)
  }
  return !signal.aborted
}

/**
 * How a watched Attempt ended, or null when the watch broke first; the
 * Attempt itself keeps running on the worker either way (SFR-03).
 */
export async function attemptOutcome(
  frames: AsyncIterable<AttemptFrame>,
): Promise<string | null> {
  let outcome: string | null = null
  try {
    for await (const frame of frames)
      if ("outcome" in frame) outcome = frame.outcome
  } catch (err: unknown) {
    console.error(err)
    return null
  }
  return outcome
}

/**
 * What the browser reports when a Generate broke before an Attempt started
 * (SFR-01): the reason, and the HTTP status if anything answered. The server
 * decides the kind from that status, so the status is all that is sent.
 */
export function failureReport(
  err: unknown,
  model: string,
): { error: string; status: number | null; model: string } {
  const message = (err instanceof Error && err.message) || "The summary failed."
  return {
    // The server takes at most 2,000 characters.
    error: message.slice(0, 2000),
    status: err instanceof ApiError ? err.status : null,
    model,
  }
}

export function checkPastedSummary(
  pending: Summary | undefined,
  text: string,
): { ok: true; pending: Summary; text: string } | { ok: false; error: string } {
  if (!pending || !(isPendingSummary(pending) || isFailedSummary(pending)))
    return {
      ok: false,
      error: "This history item is not awaiting an external AI response.",
    }
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, error: "Summary text cannot be empty." }
  return { ok: true, pending, text: trimmed }
}

/**
 * The completed Summary a pasted response writes. A model typed beside the
 * paste wins; otherwise the one the prompt was built for, then the generic
 * pasted label. `status: null` clears `pending` server-side.
 */
export function pastedSummaryRecord(
  pending: Summary,
  text: string,
  modelName: string | undefined,
  citedPosts: Record<string, Post>,
): Summary {
  return {
    ...pending,
    text,
    model: modelName?.trim()
      ? resolvePastedSummaryModel(modelName)
      : pending.model || resolvePastedSummaryModel(),
    source: "pasted",
    citedPosts,
    status: null,
  } as unknown as Summary
}

/**
 * The window a regenerated Summary was frozen at. `submitSummary` with a
 * `derivedFrom` either returns a Scope or refuses (AW-07), so a missing one is
 * a bug to surface rather than a window to guess.
 */
export function regeneratedRange(opened: Summary): {
  start: number
  end: number
} {
  const range = scopeRange(opened)
  if (!range)
    throw new Error("The regenerated summary came back with no scope.")
  return range
}
