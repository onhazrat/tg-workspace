/**
 * A Directory view (DIR-02): the filter, the sort and its direction, whose
 * citations "Cited by your channels" counts, the Reference kinds and the
 * page. It lives in the workspace URL, the filter as `?dirFilter=` in its text
 * form and the rest beside it, so a link opens exactly that view. The ticks
 * are never in it.
 */
import type { DirectoryListRequest, YourChannels } from "@/client"
import { MEASURES, OPENING_FILTER } from "./directory-filter"

export type DirectorySort = NonNullable<DirectoryListRequest["sort"]>
export type RefKind = NonNullable<
  DirectoryListRequest["referenceKinds"]
>[number]
export type YoursSource = NonNullable<YourChannels["source"]>

export type DirectoryView = {
  /** The Directory filter's text form; "" is the empty filter. */
  filter: string
  sort: DirectorySort
  descending: boolean
  /** Absent until chosen: the selection when there is one, else every follow. */
  yours?: YoursSource
  /** Narrow every Reference count; none is every kind. */
  kinds: RefKind[]
  page: number
}

export const DIRECTORY_PARAMS = [
  "dirFilter",
  "dirSort",
  "dirOrder",
  "dirYours",
  "dirKinds",
  "dirPage",
] as const
export type DirectoryParams = Partial<
  Record<(typeof DIRECTORY_PARAMS)[number], string>
>

export const REF_KINDS: RefKind[] = ["forward", "mention", "link", "reply"]
const YOURS: YoursSource[] = ["follows", "selection", "ticked"]
const MAX_PAGE = 10_000

export const DEFAULT_VIEW: DirectoryView = {
  filter: OPENING_FILTER,
  sort: "mine",
  descending: true,
  kinds: [],
  page: 0,
}

/** Measures counted in days sort newest first, which is ascending. */
export const defaultDescending = (sort: DirectorySort): boolean =>
  sort !== "mine_last_days" && !MEASURES.some((m) => m.key === sort && m.days)

const SORT_LABELS: Record<YoursSource, string> = {
  follows: "Cited by channels you follow",
  selection: "Cited by your Channels tab selection",
  ticked: "Cited by channels ticked here",
}

/** What the sort picker offers: "mine:<source>" for each source, then the rest. */
export const SORT_OPTIONS: { value: string; label: string }[] = [
  ...YOURS.map((y) => ({ value: `mine:${y}`, label: SORT_LABELS[y] })),
  { value: "mine_last_days", label: "Days since your channels last cited it" },
  ...MEASURES.map((m) => ({ value: m.key, label: m.label })),
]

const SORTS = new Set<string>([
  "mine",
  "mine_last_days",
  ...MEASURES.map((m) => m.key),
])

export const sortValue = (view: DirectoryView, yours: YoursSource): string =>
  view.sort === "mine" ? `mine:${yours}` : view.sort

/** A sort picker choice as a view patch, with that sort's own direction. */
export function chooseSort(value: string): Partial<DirectoryView> {
  const [sort, yours] = value.split(":") as [DirectorySort, YoursSource?]
  return {
    sort,
    ...(yours ? { yours } : {}),
    descending: defaultDescending(sort),
    page: 0,
  }
}

export function viewFromParams(params: DirectoryParams): DirectoryView {
  const sort = SORTS.has(params.dirSort ?? "")
    ? (params.dirSort as DirectorySort)
    : DEFAULT_VIEW.sort
  const page = Number(params.dirPage)
  const yours = params.dirYours as YoursSource
  return {
    filter: params.dirFilter ?? OPENING_FILTER,
    sort,
    descending:
      params.dirOrder === "asc"
        ? false
        : params.dirOrder === "desc" || defaultDescending(sort),
    ...(YOURS.includes(yours) ? { yours } : {}),
    kinds: REF_KINDS.filter((k) => params.dirKinds?.split(",").includes(k)),
    page: Number.isInteger(page) && page >= 0 && page <= MAX_PAGE ? page : 0,
  }
}

/** The view as parameters, leaving out every default but the filter. */
export function paramsFromView(view: DirectoryView): DirectoryParams {
  const params: DirectoryParams = { dirFilter: view.filter }
  if (view.sort !== DEFAULT_VIEW.sort) params.dirSort = view.sort
  if (view.descending !== defaultDescending(view.sort))
    params.dirOrder = view.descending ? "desc" : "asc"
  if (view.yours) params.dirYours = view.yours
  if (view.kinds.length) params.dirKinds = view.kinds.join(",")
  if (view.page) params.dirPage = String(view.page)
  return params
}

/** Whether the URL names a Directory view at all, rather than none. */
export const hasViewParams = (search: Record<string, unknown>): boolean =>
  DIRECTORY_PARAMS.some((key) => search[key] !== undefined)

/**
 * "Your channels" as the reads take it. A view with no stored value starts on
 * the selection when there is one and on every follow otherwise; a chosen
 * value is never swapped, so an empty one counts 0 and the footer says so.
 */
export function resolveYours(
  chosen: YoursSource | undefined,
  sources: { selection: string[]; ticked: string[] },
): Required<YourChannels> {
  const source =
    chosen ?? (sources.selection.length > 0 ? "selection" : "follows")
  return {
    source,
    handles: source === "follows" ? [] : sources[source],
  }
}
