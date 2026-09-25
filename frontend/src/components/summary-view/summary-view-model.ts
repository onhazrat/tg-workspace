/**
 * `SummaryView`'s decisions, with the network and the toasts passed in, so
 * they can be tested without its providers. `SummaryView` renders them.
 */
import { toast } from "sonner"

import { isPendingSummary } from "@/constants"
import { savePublishLog } from "@/lib/logs/write"
import { publishedText } from "@/lib/summaries/summary-model"
import { buildActiveProxies, type ProxySettings } from "@/lib/syncSettings"
import { publishSummary } from "@/services/telegram"
import type {
  BotCredential,
  ChatDestination,
  Summary,
  SummaryListItem,
} from "@/types"

/** Which Summary is open, what its body is, and whether it is being made. */
export function summaryViewState(input: {
  history: SummaryListItem[]
  currentSummaryId: string | null
  detail: Summary | null | undefined
  streamed: string | null
  regenerating: Set<string>
  summarizing: boolean
}) {
  /*
   * Prefer the list row, fall back to the detail fetch.
   *
   * Reading only from `summariesHistory` made opening a summary from History
   * depend on that list happening to be loaded and to contain the row — which
   * is not something History guarantees any more, since it lists artifacts
   * through `/data/artifacts` rather than through the summaries query. The
   * detail fetch is keyed on the id in the URL, so it always has the answer.
   */
  const currentSummary =
    input.history.find((s) => s.id === input.currentSummaryId) ?? input.detail
  return {
    currentSummary,
    /*
     * The body: live stream first, saved text second.
     *
     * `streamed` is `AIContext`'s streaming buffer — only ever set by
     * generating or pasting. Opening a saved summary used to fill it from the
     * restore path in `App.tsx`; deleting that path left this view rendering
     * nothing for every artifact opened from History, which is exactly what it
     * looked like. Falling back to the stored text means the view works from
     * the URL alone.
     */
    summaryBody: input.streamed ?? input.detail?.text ?? null,
    isPending: currentSummary ? isPendingSummary(currentSummary) : false,
    running:
      input.summarizing ||
      (currentSummary ? input.regenerating.has(currentSummary.id) : false),
  }
}

/** What a manual publish reaches for, injectable so a test sends nothing. */
export interface PublishIo {
  publish: typeof publishSummary
  saveLog: typeof savePublishLog
  notify: Pick<typeof toast, "success" | "error" | "warning">
  now: () => number
}

const defaultIo: PublishIo = {
  publish: publishSummary,
  saveLog: savePublishLog,
  notify: toast,
  now: () => Date.now(),
}

/**
 * Publish from the Summary tab and file the publish log, success or not.
 * Offline refuses before sending anything; a thrown send is a toast, not a log.
 */
export async function publishFromView(
  run: {
    bot: BotCredential
    dest: ChatDestination
    text: string
    summaryId: string | null
    metadata: string | null
    isOffline: boolean
    settings: ProxySettings & {
      torAutoRotate: boolean
      torRotationThreshold: number
    }
  },
  io: PublishIo = defaultIo,
): Promise<void> {
  const { bot, dest, text, metadata, settings } = run
  if (run.isOffline) {
    io.notify.warning("Server offline — publish disabled.")
    return
  }
  try {
    const result = await io.publish(
      bot.id,
      dest.chatId,
      text,
      metadata ?? undefined,
      buildActiveProxies(settings).length > 0,
      settings.torAutoRotate,
      settings.torRotationThreshold,
    )
    await io.saveLog({
      id: io.now().toString() + Math.random().toString(36).substring(2, 7),
      summaryId: run.summaryId || `manual-${io.now()}`,
      botId: bot.id,
      botName: bot.name,
      chatId: dest.chatId,
      chatName: dest.name,
      status: result.success ? "success" : "failed",
      error: result.error,
      timestamp: io.now(),
      fullRequest: result.requests,
      fullResponse: result.responses,
      textSent: publishedText(metadata, text),
    })
    if (result.success)
      io.notify.success(`Successfully published using ${bot.name}!`)
    else io.notify.error(`Error publishing: ${result.error}`)
  } catch (e: unknown) {
    io.notify.error(
      `Error publishing: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
}
