/**
 * The rules `AIContext`'s Summary actions follow, with no React, so they can be
 * tested directly. The context keeps the streaming, the saving and the state;
 * the lookup and count calls are passed in.
 */
import type { PostScopeQuery } from "@/api/data"
import { isPendingSummary, resolvePastedSummaryModel } from "@/constants"
import { floorToMinute } from "@/lib/analysis-window"
import { scopeRange } from "@/lib/scope/artifact-scope"
import type { PublishResult } from "@/services/telegram"
import type {
  BotCredential,
  ChatDestination,
  LLMLog,
  Post,
  PublishLog,
  Summary,
} from "@/types"
import {
  extractCitedPosts,
  parseCitationRefs,
  publishedText,
} from "./summary-model"

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

/** The LLM log for a streamed summary; `failed` when the model said nothing. */
export function summaryLLMLog(run: {
  id: string
  model: string
  prompt: string
  config: unknown
  text: string
  lastChunk: unknown
  now: number
  durationMs: number
}): LLMLog {
  const usage = (
    run.lastChunk as { usageMetadata?: { totalTokenCount?: number } } | null
  )?.usageMetadata
  return {
    id: run.id,
    model: run.model,
    prompt: run.prompt,
    response: run.text,
    modelConfig: run.config,
    fullRequest: {
      contents: [{ parts: [{ text: run.prompt }] }],
      config: run.config,
    },
    fullResponse: run.lastChunk,
    tokens: usage?.totalTokenCount,
    status: run.text ? "success" : "failed",
    timestamp: run.now,
    duration: run.durationMs,
    type: "summary",
  }
}

/**
 * The publish log an auto-publish files, whether Telegram took the message or
 * not. `textSent` is what went out: the metadata block, when the Summary sends
 * one, above the body.
 */
export function autoPublishLog(run: {
  id: string
  summary: Summary
  bot: BotCredential
  dest: ChatDestination
  metadata: string | null
  result: PublishResult
  now: number
}): PublishLog {
  return {
    id: run.id,
    summaryId: run.summary.id,
    botId: run.bot.id,
    botName: run.bot.name,
    chatId: run.dest.chatId,
    chatName: run.dest.name,
    status: run.result.success ? "success" : "failed",
    error: run.result.error,
    timestamp: run.now,
    fullRequest: run.result.requests,
    fullResponse: run.result.responses,
    textSent: publishedText(run.metadata, run.summary.text),
  }
}

/** A pasted response the pending Summary can take, or why it cannot. */
export function checkPastedSummary(
  pending: Summary | undefined,
  text: string,
): { ok: true; pending: Summary; text: string } | { ok: false; error: string } {
  if (!pending || !isPendingSummary(pending))
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

/**
 * How many posts a regeneration covers.
 *
 * AW-02: the shifted window starts where the last Summary ended and runs into
 * the future, and `fixedWindow` holds its end to the server's current minute.
 * Inside the same minute that leaves start === end, which the server refuses,
 * so a regeneration that simply came round too soon would fail instead of
 * writing the "no new posts" note it always has. Asking is what is skipped
 * here, not the answer: the answer is zero.
 */
export async function countRegeneratedPosts(
  channelNames: string[],
  range: { start: number; end: number },
  serverMinute: number,
  countPosts: (q: PostScopeQuery) => Promise<Record<string, number>>,
): Promise<number> {
  if (floorToMinute(range.start) >= serverMinute) return 0
  const counts = await countPosts({
    channelNames,
    startDate: range.start,
    endDate: range.end,
  })
  return Object.values(counts).reduce((sum, n) => sum + n, 0)
}
