/**
 * The History tab's rules, with no React, so they can be tested directly.
 * `HistoryView` keeps the queries, the writes and the toasts, except the
 * star's (`toggleStar`), which a render test presses Undo on.
 */
import { toast } from "sonner"
import type { HistoryParams, HistorySort } from "@/lib/history/history-params"
import type { ArtifactListItem, BotCredential, ChatDestination } from "@/types"
import {
  ARTIFACT_KIND_LABELS,
  artifactKey,
  artifactName,
} from "./artifact-presentation"

export type SummaryFlag = "autoRegenerate" | "autoPublish"

/**
 * What flipping a Summary's schedule flag does: nothing for another kind, a
 * refusal, or the value to write.
 *
 * A scope shorter than a minute would have the job re-running over a window
 * that barely moves. Read off the frozen Scope since AW-07: a Summary with none
 * has no window to shift at all, which the server refuses too, so it fails the
 * same check. Turning the flag off is always allowed.
 */
export function summaryFlagChange(
  artifact: ArtifactListItem,
  flag: SummaryFlag,
): { next: boolean } | { refusal: string } | null {
  if (artifact.kind !== "summary") return null
  const next = !artifact[flag]
  if (
    flag === "autoRegenerate" &&
    next &&
    (artifact.scope?.durationMinutes ?? 0) < 1
  )
    return {
      refusal:
        "Cannot auto-regenerate a summary whose range is under a minute.",
    }
  return { next }
}

/** A Publish target: the Destination and the bot an Auto-publish sends with. */
export type PublishPair = { bot: BotCredential; destination: ChatDestination }

/**
 * A Summary's saved Publish target, or `null` when either half is unset or
 * names a bot or Destination that was since deleted. The scheduler sends
 * nothing for either, so the card treats both as missing.
 */
export function publishTargetOf(
  artifact: ArtifactListItem,
  bots: readonly BotCredential[],
  destinations: readonly ChatDestination[],
): PublishPair | null {
  if (artifact.kind !== "summary") return null
  const bot = bots.find((b) => b.id === artifact.publishBotId)
  const destination = destinations.find((d) => d.id === artifact.publishChatId)
  return bot && destination ? { bot, destination } : null
}

/**
 * Every Destination with every bot, Destination first, narrowed by `query`
 * against the Destination's name or chat id and the bot's name.
 */
export function publishPairs(
  bots: readonly BotCredential[],
  destinations: readonly ChatDestination[],
  query: string,
): PublishPair[] {
  const q = query.trim().toLowerCase()
  return destinations
    .flatMap((destination) => bots.map((bot) => ({ bot, destination })))
    .filter(
      ({ bot, destination }) =>
        !q ||
        [destination.name, destination.chatId, bot.name].some((text) =>
          text.toLowerCase().includes(q),
        ),
    )
}

/**
 * Whether switching `flag` to `next` should open the Publish target chooser:
 * Auto-publish turned on with no usable target. Saving the flag alone is how
 * Summaries came to publish nothing for two months.
 */
export function opensPublishTarget(
  artifact: ArtifactListItem,
  flag: SummaryFlag,
  next: boolean,
  bots: readonly BotCredential[],
  destinations: readonly ChatDestination[],
): boolean {
  return (
    flag === "autoPublish" &&
    next &&
    publishTargetOf(artifact, bots, destinations) === null
  )
}

/**
 * Flip a Summary's schedule flag: refuse it with the reason, or save it, open
 * the Publish target chooser when `opensPublishTarget` says so, and refresh.
 * The writes are passed in, as `toggleStar`'s are, so the wiring is testable.
 */
export async function switchSummaryFlag(
  artifact: ArtifactListItem,
  flag: SummaryFlag,
  deps: {
    save: (
      a: ArtifactListItem,
      flag: SummaryFlag,
      next: boolean,
    ) => Promise<void>
    refresh: () => Promise<unknown>
    refuse: (reason: string) => void
    openTarget: (key: string) => void
    bots: readonly BotCredential[]
    destinations: readonly ChatDestination[]
  },
): Promise<void> {
  const change = summaryFlagChange(artifact, flag)
  if (!change) return
  if ("refusal" in change) {
    deps.refuse(change.refusal)
    return
  }
  await deps.save(artifact, flag, change.next)
  if (
    opensPublishTarget(
      artifact,
      flag,
      change.next,
      deps.bots,
      deps.destinations,
    )
  )
    deps.openTarget(artifactKey(artifact))
  await deps.refresh()
}

/**
 * How many filters are on, for the phone's Filters button: Kind, Status,
 * Starred and the time filter. The search box sits beside the button.
 */
export function historyActiveFilters(p: HistoryParams): number {
  const bounded = p.bound.start !== undefined || p.bound.end !== undefined
  return [p.kind, p.status, p.starred, bounded].filter(Boolean).length
}

/** The empty list says whether a filter hid everything or nothing exists yet. */
export function historyEmptyDescription(p: HistoryParams): string {
  return p.search.trim() || historyActiveFilters(p) > 0
    ? "No artifacts match these filters."
    : "Summaries, chats, tag runs and discovery reports you create will appear here."
}

/** The footer's sort in words: "Sorted by Written, newest first". */
export function historySortWords(sort: HistorySort, descending: boolean) {
  return `Sorted by ${sort === "written" ? "Written" : "Window start"}, ${
    descending ? "newest first" : "oldest first"
  }`
}

/** "Today", "Yesterday", then "Mon, Oct 19", with the year when not this one. */
function dayLabel(day: Date, now: Date, locale?: string): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((today.getTime() - day.getTime()) / 86_400_000)
  if (days === 0) return "Today"
  if (days === 1) return "Yesterday"
  return day.toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(day.getFullYear() !== now.getFullYear() && { year: "numeric" }),
  })
}

/**
 * The loaded rows under day headings by local calendar day of Written, in
 * list order. A heading carries no count: on a paged list it would count only
 * the loaded rows.
 */
export function historyDays(
  rows: readonly ArtifactListItem[],
  now = Date.now(),
  locale?: string,
): { key: string; label: string; rows: ArtifactListItem[] }[] {
  const days: { key: string; label: string; rows: ArtifactListItem[] }[] = []
  let last: number | null = null
  for (const row of rows) {
    const at = new Date(row.timestamp ?? 0)
    const day = new Date(at.getFullYear(), at.getMonth(), at.getDate())
    const current = days.at(-1)
    if (current && day.getTime() === last) current.rows.push(row)
    else
      days.push({
        key: `${day.getTime()}:${days.length}`,
        label: dayLabel(day, new Date(now), locale),
        rows: [row],
      })
    last = day.getTime()
  }
  return days
}

/** The empty state is for a settled answer, never for a first load in flight. */
export const historyShowsEmpty = (rowCount: number, isLoading: boolean) =>
  rowCount === 0 && !isLoading

/**
 * The delete dialog names the kind and the channels. It keeps its words while
 * closing, when `pending` is already null.
 */
export function deleteDialogCopy(pending: ArtifactListItem | null): {
  title: string
  description: string
} {
  const kind = pending ? ARTIFACT_KIND_LABELS[pending.kind] : "item"
  return {
    title: `Delete this ${kind}?`,
    description:
      pending?.scope?.channels?.join(", ") || "This cannot be undone.",
  }
}

/** What starring `artifact` (as it was before the click) did, and to which one. */
export const starNotice = (artifact: ArtifactListItem) =>
  `${artifact.isStarred ? "Unstarred" : "Starred"} ${artifactName(artifact)}`

/**
 * The star's click, and its toast naming the Artifact. Undo sets the star
 * back rather than pressing it again: unstarred under "Starred only", the
 * card is gone. The star control is marked `data-says`, so keyboard mode's
 * `*` adds no second toast. The write and the refetch are passed in.
 */
export async function toggleStar(
  artifact: ArtifactListItem,
  {
    setStarred,
    refresh,
  }: {
    setStarred: (a: ArtifactListItem, isStarred: boolean) => Promise<void>
    refresh: () => Promise<unknown>
  },
) {
  await setStarred(artifact, !artifact.isStarred)
  await refresh()
  toast(starNotice(artifact), {
    action: {
      label: "Undo",
      onClick: () =>
        void setStarred(artifact, Boolean(artifact.isStarred)).then(refresh),
    },
  })
}
