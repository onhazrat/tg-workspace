/**
 * History's filters as workspace search parameters, so a link reopens the
 * list it was copied from. The time filter is written in the shared Time
 * bound text form (ADR-033); a default is written as absent.
 */
import { ParseError } from "@/lib/filter-text"
import type { TimeBound } from "@/lib/time-bound/bound"
import {
  parseTimeBound,
  TIME_BOUND,
  timeBoundText,
} from "@/lib/time-bound/text"
import type { ArtifactKind, ArtifactStatusFilter } from "@/types"

/** What the time filter bounds, and what the list sorts on. */
export type HistoryMoment = "written" | "window"
export type HistorySort = "written" | "window"

export type HistoryParams = {
  kind: ArtifactKind | null
  status: ArtifactStatusFilter | null
  /** As typed; the queries trim it. */
  search: string
  starred: boolean
  /** No ends is Any time. */
  bound: TimeBound
  moment: HistoryMoment
  sort: HistorySort
  descending: boolean
}

export const DEFAULT_HISTORY_PARAMS: HistoryParams = {
  kind: null,
  status: null,
  search: "",
  starred: false,
  bound: { mode: "live" },
  moment: "written",
  sort: "written",
  descending: true,
}

export type HistorySearch = {
  historyKind?: ArtifactKind
  /** SFR-01's All / Failed / Pending; absent is Any status. */
  historyStatus?: ArtifactStatusFilter
  historyQ?: string
  historyStarred?: true
  /** `-7d..`, `2026-10-01T00:00Z..2026-10-15T00:00Z`. */
  historyTime?: string
  historyMoment?: "window"
  historySort?: "window"
  historyOrder?: "oldest"
}

const KINDS: readonly ArtifactKind[] = ["summary", "chat", "tag", "discovery"]
const STATUSES: readonly ArtifactStatusFilter[] = ["failed", "pending"]
const TIME = new RegExp(`^${TIME_BOUND}$`)

function parsedTime(text: unknown): TimeBound | null {
  if (typeof text !== "string") return null
  const ends = TIME.exec(text)
  if (!ends) return null
  try {
    return parseTimeBound(ends[1], ends[2])
  } catch (error) {
    if (error instanceof ParseError) return null
    throw error
  }
}

/** The valid History parameters of a raw search; anything else is dropped. */
export function validateHistorySearch(
  search: Record<string, unknown>,
): HistorySearch {
  const out: HistorySearch = {}
  const { historyKind: kind, historyStatus: status, historyQ: q } = search
  if (KINDS.includes(kind as ArtifactKind))
    out.historyKind = kind as ArtifactKind
  if (STATUSES.includes(status as ArtifactStatusFilter))
    out.historyStatus = status as ArtifactStatusFilter
  if (typeof q === "string" && q.trim()) out.historyQ = q
  if (search.historyStarred === true || search.historyStarred === "true")
    out.historyStarred = true
  if (parsedTime(search.historyTime))
    out.historyTime = search.historyTime as string
  if (search.historyMoment === "window") out.historyMoment = "window"
  if (search.historySort === "window") out.historySort = "window"
  if (search.historyOrder === "oldest") out.historyOrder = "oldest"
  return out
}

export function readHistoryParams(search: HistorySearch): HistoryParams {
  return {
    kind: search.historyKind ?? null,
    status: search.historyStatus ?? null,
    search: search.historyQ ?? "",
    starred: search.historyStarred === true,
    bound: parsedTime(search.historyTime) ?? DEFAULT_HISTORY_PARAMS.bound,
    moment: search.historyMoment ?? "written",
    sort: search.historySort ?? "written",
    descending: search.historyOrder !== "oldest",
  }
}

/** The search keys a change writes; `undefined` removes one. */
export function historySearchPatch(
  patch: Partial<HistoryParams>,
): HistorySearch {
  const out: HistorySearch = {}
  if ("kind" in patch) out.historyKind = patch.kind ?? undefined
  if ("status" in patch) out.historyStatus = patch.status ?? undefined
  if ("search" in patch)
    out.historyQ = patch.search?.trim() ? patch.search : undefined
  if ("starred" in patch) out.historyStarred = patch.starred || undefined
  if ("bound" in patch) {
    const b = patch.bound
    out.historyTime =
      b && (b.start !== undefined || b.end !== undefined)
        ? timeBoundText(b)
        : undefined
  }
  if ("moment" in patch)
    out.historyMoment = patch.moment === "window" ? "window" : undefined
  if ("sort" in patch)
    out.historySort = patch.sort === "window" ? "window" : undefined
  if ("descending" in patch)
    out.historyOrder = patch.descending === false ? "oldest" : undefined
  return out
}

/**
 * The command palette's view of History: its search field and its
 * starred-only command read and write the same URL state the bar does.
 */
export function historyPaletteBinding(
  params: HistoryParams,
  setParams: (patch: Partial<HistoryParams>) => void,
) {
  return {
    historySearchQuery: params.search,
    setHistorySearchQuery: (search: string) => setParams({ search }),
    starredOnly: params.starred,
    setStarredOnly: (starred: boolean) => setParams({ starred }),
  }
}
