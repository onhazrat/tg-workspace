/**
 * A Directory view (DIR-02): the filter, the sort and its direction, whose
 * citations "Cited by your channels" counts, the Reference kinds, the page,
 * and DIR-04's search with its fields and "Show matches". It lives in the workspace URL, the filter as `?dirFilter=` in its text
 * form and the rest beside it, so a link opens exactly that view. The ticks
 * are never in it.
 */
import type {
  DirectoryCountRequest,
  DirectoryListRequest,
  DirectoryListResponse,
  DirectorySearchRequest,
  YourChannels,
} from "@/client"
import {
  type DirectorySharedCond,
  MEASURES,
  OPENING_FILTER,
} from "./directory-filter"

export type DirectorySort = NonNullable<DirectoryListRequest["sort"]>
export type RefKind = NonNullable<
  DirectoryListRequest["referenceKinds"]
>[number]
export type YoursSource = NonNullable<YourChannels["source"]>
export type SearchField = NonNullable<DirectorySearchRequest["fields"]>[number]
/** What every Directory read shares: the filter, "your channels", the kinds. */
export type DirectoryViewRequest = Omit<DirectoryCountRequest, "candidate">

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
  /** The search box as typed; blank is no search. */
  search: string
  /** Where the search looks; never empty. */
  fields: SearchField[]
  /** Quote each row's matching bio and Post while searching. */
  matches: boolean
}

export const DIRECTORY_PARAMS = [
  "dirFilter",
  "dirSort",
  "dirOrder",
  "dirYours",
  "dirKinds",
  "dirPage",
  "dirQ",
  "dirIn",
  "dirMatches",
] as const
export type DirectoryParams = Partial<
  Record<(typeof DIRECTORY_PARAMS)[number], string>
>

/**
 * Every value of a generated union, in the order written. Keyed by the union,
 * so a value the server adds or drops is a compile error here.
 */
const every = <T extends string>(values: Record<T, true>) =>
  Object.keys(values) as T[]

export const REF_KINDS = every<RefKind>({
  forward: true,
  mention: true,
  link: true,
  reply: true,
})
const YOURS = every<YoursSource>({
  follows: true,
  selection: true,
  ticked: true,
})
export const SEARCH_FIELDS = every<SearchField>({
  name: true,
  bio: true,
  posts: true,
})
const MAX_PAGE = 10_000

export const DEFAULT_VIEW: DirectoryView = {
  filter: OPENING_FILTER,
  sort: "mine",
  descending: true,
  kinds: [],
  page: 0,
  search: "",
  fields: SEARCH_FIELDS,
  matches: true,
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

export type SharedRelation = DirectorySharedCond["type"]

/** Each Shared relation's weighted sort, offered while its Condition is on (DIR-07). */
const SHARED_SORTS: Record<SharedRelation, { value: string; label: string }> = {
  parents: { value: "shared_parents", label: "Shared parents (weighted)" },
  children: { value: "shared_children", label: "Shared children (weighted)" },
}

const SORTS = new Set<string>([
  "mine",
  "mine_last_days",
  ...MEASURES.map((m) => m.key),
  "shared_parents",
  "shared_children",
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

const RELEVANCE = { value: "relevance", label: "Relevance" }

/**
 * The picker's options: Relevance first, only while a search is on, and each
 * Shared relation's weighted sort last, only while its Condition is on.
 */
export function sortOptions(searching: boolean, shared: SharedRelation[] = []) {
  const base = searching ? [RELEVANCE, ...SORT_OPTIONS] : SORT_OPTIONS
  return shared.length ? [...base, ...shared.map((r) => SHARED_SORTS[r])] : base
}

/** The search as the reads take it: trimmed, or none for a blank box. */
export function searchRequest(
  view: DirectoryView,
): DirectorySearchRequest | null {
  const text = view.search.trim()
  return text ? { text, fields: view.fields } : null
}

/**
 * Typing into the search box. Starting a search sorts by Relevance; clearing
 * it puts a Relevance sort back to `previous`, the sort before it. A sort
 * chosen while searching is left alone.
 */
export function searchPatch(
  view: DirectoryView,
  text: string,
  previous: Pick<DirectoryView, "sort" | "descending">,
): Partial<DirectoryView> {
  const was = view.search.trim() !== ""
  const is = text.trim() !== ""
  if (is && !was) return { search: text, sort: "relevance", descending: true }
  if (!is && view.sort === "relevance") return { search: text, ...previous }
  return { search: text }
}

/** A field's toggle; the last one on stays on. */
export function toggleField(
  fields: SearchField[],
  field: SearchField,
): SearchField[] {
  if (!fields.includes(field))
    return SEARCH_FIELDS.filter((f) => f === field || fields.includes(f))
  return fields.length > 1 ? fields.filter((f) => f !== field) : fields
}

/** A column header's click: the sorted column flips, another sorts by itself. */
export const headerSort = (
  view: DirectoryView,
  key: DirectorySort,
  yours: YoursSource,
): Partial<DirectoryView> =>
  view.sort === key
    ? { descending: !view.descending }
    : chooseSort(key === "mine" ? `mine:${yours}` : key)

export function viewFromParams(params: DirectoryParams): DirectoryView {
  const search = params.dirQ ?? ""
  // Relevance with no search would order by handle; take the default instead.
  const relevance = params.dirSort === "relevance" && search.trim() !== ""
  const sort =
    relevance || SORTS.has(params.dirSort ?? "")
      ? (params.dirSort as DirectorySort)
      : DEFAULT_VIEW.sort
  const fields = SEARCH_FIELDS.filter((f) =>
    params.dirIn?.split(",").includes(f),
  )
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
    search,
    fields: fields.length ? fields : SEARCH_FIELDS,
    matches: params.dirMatches !== "off",
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
  if (view.search) params.dirQ = view.search
  if (view.fields.length < SEARCH_FIELDS.length)
    params.dirIn = view.fields.join(",")
  if (!view.matches) params.dirMatches = "off"
  return params
}

/** Whether the URL names a Directory view at all, rather than none. */
export const hasViewParams = (search: Record<string, unknown>): boolean =>
  DIRECTORY_PARAMS.some((key) => search[key] !== undefined)

/**
 * What the tab shows of a list read, loaded or not: no rows and no count
 * while the first page loads, no time while a page is in flight, and which
 * "your channels" resolved to nothing, for the footer.
 */
export function listSummary(
  data: (DirectoryListResponse & { ms: number }) | undefined,
  fetching: boolean,
  source: YoursSource,
) {
  return {
    rows: data?.rows ?? [],
    total: data?.total,
    languages: data?.languages ?? [],
    ms: fetching ? undefined : data?.ms,
    emptyYours: data?.yoursSize === 0 ? source : undefined,
  }
}

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

/** How long a Dismissal's confirmation, and its Undo, stay up (DIR-06). */
export const DISMISSAL_NOTICE_MS = 10_000

/** A Dismissal's confirmation: one Channel by handle, several by count. */
export const dismissalNotice = (handles: string[]): string =>
  handles.length === 1
    ? `Dismissed @${handles[0]}`
    : `Dismissed ${handles.length} channels`
