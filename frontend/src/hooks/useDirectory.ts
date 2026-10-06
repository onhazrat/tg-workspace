/**
 * The Directory tab's state and reads (DIR-02).
 *
 * The view lives in the URL (`lib/directory/directory-view.ts`) and the last
 * one is remembered per Account through the scoped storage: a tab opened with
 * no `dir*` parameter adopts it. The ticks and the hidden columns are per
 * browser and Account and never in the URL; "Channels ticked here" and
 * DIR-07's picks read the ticks from here.
 */
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { dataGetDirectorySize, dataListDirectory } from "@/client"
import { useData } from "@/contexts/DataContext"
import { useScraper } from "@/contexts/ScraperContext"
import {
  DIRECTORY_FILTER_BOUNDS,
  type DirectoryFilter,
  directoryFilterBody,
  OPENING_FILTER,
  parseDirectoryFilter,
  printDirectoryFilter,
  withinDirectoryFilterBounds,
} from "@/lib/directory/directory-filter"
import {
  DIRECTORY_PARAMS,
  type DirectoryParams,
  type DirectoryView,
  type DirectoryViewRequest,
  hasViewParams,
  paramsFromView,
  resolveYours,
  searchPatch,
  searchRequest,
  viewFromParams,
} from "@/lib/directory/directory-view"
import { pruneSelectionAfterFollow } from "@/lib/posts/discover-selection"
import { scopedStorage } from "@/lib/storage/scoped"
import { queryKeys } from "./queryKeys"
import { useDebouncedValue } from "./useDebouncedValue"

const workspaceRoute = getRouteApi("/_tg/workspace")

const VIEW_KEY = "directory.view"
const TICKS_KEY = "directory.ticks"
const HIDDEN_KEY = "directory.hiddenColumns"
/** The handle whose detail panel is open, per browser (DIR-03). */
const OPEN_KEY = "directory.open"
/** The whole Directory's size moves slowly; the server caches it as long. */
const SIZE_STALE_TIME = 5 * 60_000

function readStored<T>(key: string, valid: (v: unknown) => v is T): T | null {
  try {
    const value: unknown = JSON.parse(scopedStorage.getItem(key) ?? "null")
    return valid(value) ? value : null
  } catch {
    return null
  }
}
const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string")
const isParams = (v: unknown): v is DirectoryParams =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** A list of handles kept in the scoped storage. */
function useStoredList(key: string) {
  const [list, setList] = useState(() => readStored(key, isStrings) ?? [])
  const set = useCallback(
    (next: Iterable<string>) => {
      const value = [...next]
      setList(value)
      scopedStorage.setItem(key, JSON.stringify(value))
    },
    [key],
  )
  return [list, set] as const
}

/** The view from the URL, adopting the remembered one when the URL has none. */
function useView() {
  const search = workspaceRoute.useSearch()
  const navigate = workspaceRoute.useNavigate()
  const params = Object.fromEntries(
    DIRECTORY_PARAMS.map((key) => [key, search[key]]),
  ) as DirectoryParams
  const paramsKey = JSON.stringify(params)
  // Keyed by the params' text, so a new search object with the same view is no change.
  const view = useMemo(() => viewFromParams(params), [paramsKey])
  const named = hasViewParams(search)

  // Once, as the tab opens: a URL naming no view adopts the remembered one.
  useEffect(() => {
    if (named) return
    const stored = readStored(VIEW_KEY, isParams)
    navigate({
      search: (prev) => ({
        ...prev,
        ...paramsFromView(viewFromParams(stored ?? {})),
      }),
      replace: true,
    })
  }, [])

  useEffect(() => {
    if (named)
      scopedStorage.setItem(VIEW_KEY, JSON.stringify(paramsFromView(view)))
  }, [named, view])

  /** A patch to the view; anything but paging goes back to the first page. */
  const patch = useCallback(
    (next: Partial<DirectoryView>) =>
      navigate({
        search: (prev) => {
          const merged = { ...viewFromParams(prev), page: 0, ...next }
          const cleared = Object.fromEntries(
            DIRECTORY_PARAMS.map((key) => [key, undefined]),
          )
          return { ...prev, ...cleared, ...paramsFromView(merged) }
        },
        replace: true,
      }),
    [navigate],
  )
  return { view, patch }
}

/** How long the box waits for typing to stop before the view takes it. */
const SEARCH_DEBOUNCE_MS = 300

/**
 * The search box (DIR-04): what is typed reaches the view once typing stops,
 * and a blank box at once, so clearing never waits. The sort before Relevance
 * is kept here to go back to; a reload while searching goes back to the
 * default instead.
 */
function useSearchBox(
  view: DirectoryView,
  patch: (next: Partial<DirectoryView>) => void,
) {
  const [draft, setDraft] = useState(view.search)
  const previous = useRef({ sort: view.sort, descending: view.descending })
  if (view.sort !== "relevance")
    previous.current = { sort: view.sort, descending: view.descending }
  const commit = (text: string) =>
    patch(searchPatch(view, text, previous.current))

  // The view moved on its own (a link, Back, the chip): the box follows.
  useEffect(() => setDraft(view.search), [view.search])
  const settled = useDebouncedValue(draft, SEARCH_DEBOUNCE_MS)
  // On `draft` too: a box cleared and retyped to the last settled text
  // within the wait never changes `settled`.
  useEffect(() => {
    if (settled === draft && settled !== view.search) commit(settled)
  }, [settled, draft])

  const setSearch = (text: string) => {
    setDraft(text)
    if (!text.trim() && view.search) commit(text)
  }
  /** Clear all: the search and the filter in one navigation. */
  const clearAll = () => {
    setDraft("")
    patch({ ...searchPatch(view, "", previous.current), filter: "" })
  }
  return { draft, setSearch, clearAll }
}

export function useDirectory() {
  const { view, patch } = useView()
  const searchBox = useSearchBox(view, patch)
  const { selectedChannels } = useData()
  const { followDiscoverChannels } = useScraper()
  const queryClient = useQueryClient()
  const [ticked, setTicked] = useStoredList(TICKS_KEY)
  const [hidden, setHidden] = useStoredList(HIDDEN_KEY)
  // A list of at most one handle, so the panel reuses the stored-list plumbing.
  const [opened, setOpened] = useStoredList(OPEN_KEY)
  const [following, setFollowing] = useState<ReadonlySet<string>>(new Set())

  const filter = useMemo(
    () =>
      parseDirectoryFilter(view.filter) ??
      (parseDirectoryFilter(OPENING_FILTER) as DirectoryFilter),
    [view.filter],
  )
  const setFilter = useCallback(
    (next: DirectoryFilter) => {
      if (!withinDirectoryFilterBounds(next)) {
        toast.error(
          `A Directory filter holds at most ${DIRECTORY_FILTER_BOUNDS.nodes} blocks, nested ${DIRECTORY_FILTER_BOUNDS.depth} levels deep.`,
        )
        return
      }
      patch({ filter: printDirectoryFilter(next) })
    },
    [patch],
  )

  const selection = useMemo(
    () => [...selectedChannels].sort(),
    [selectedChannels],
  )
  const ticks = useMemo(() => new Set(ticked), [ticked])
  const yours = resolveYours(view.yours, {
    selection,
    ticked: [...ticked].sort(),
  })
  const search = searchRequest(view)
  const request: DirectoryViewRequest = {
    filter: directoryFilterBody(filter),
    yours,
    referenceKinds: view.kinds,
    search,
  }
  const body = {
    ...request,
    sort: view.sort,
    descending: view.descending,
    page: view.page,
    // Only while searching, so the switch leaves an unsearched read's key alone.
    ...(search && { showMatches: view.matches }),
  }
  const list = useQuery({
    queryKey: queryKeys.directoryRead("list", body),
    // `signal` is consumed, so a read nobody waits for any more (a cleared or
    // retyped search) is aborted rather than left to finish.
    queryFn: async ({ signal }) => {
      const started = performance.now()
      const data = await dataListDirectory({ body, signal })
      return { ...data, ms: Math.round(performance.now() - started) }
    },
    placeholderData: keepPreviousData,
  })
  const size = useQuery({
    queryKey: queryKeys.directoryRead("size", null),
    queryFn: () => dataGetDirectorySize(),
    staleTime: SIZE_STALE_TIME,
  })

  /** Runs Discover's follow job, with discovered-via from "your channels". */
  const follow = async (handles: string[]) => {
    setFollowing((prev) => new Set([...prev, ...handles]))
    try {
      const status = await followDiscoverChannels(
        handles.map((name) => ({ name })),
        { directory: { yours, referenceKinds: view.kinds } },
      )
      if (status) setTicked(pruneSelectionAfterFollow(ticks, status.results))
      await queryClient.invalidateQueries({ queryKey: queryKeys.directory })
    } finally {
      setFollowing(
        (prev) => new Set([...prev].filter((h) => !handles.includes(h))),
      )
    }
  }

  return {
    view,
    patch,
    ...searchBox,
    filter,
    setFilter,
    request,
    yours,
    ticks,
    setTicks: setTicked,
    hidden,
    setHidden,
    open: opened[0] ?? null,
    setOpen: (handle: string | null) => setOpened(handle ? [handle] : []),
    following,
    follow,
    list,
    size: size.data?.size,
  }
}
