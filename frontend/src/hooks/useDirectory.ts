/**
 * The Directory tab's state and reads (DIR-02).
 *
 * The view lives in the URL (`lib/directory/directory-view.ts`) and the last
 * one is remembered per Account through the scoped storage: a tab opened with
 * no `dir*` parameter adopts it. The ticks and the column choices (DCOL) are
 * per browser and Account and never in the URL; "Channels ticked here" and
 * DIR-07's Seeds read the ticks from here.
 */
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  dataBoostDirectory,
  dataGetDirectorySize,
  dataListDirectory,
  dataListDirectoryColumns,
  dataPutDirectoryColumns,
} from "@/client"
import type { ColumnsMenu } from "@/components/directory/DirectoryBar"
import type { BoostMode } from "@/components/directory/DirectoryBoost"
import { useData } from "@/contexts/DataContext"
import { useScraper } from "@/contexts/ScraperContext"
import { useSettings } from "@/contexts/SettingsContext"
import { errorText } from "@/lib/artifacts/artifact-run"
import {
  type ColumnChoices,
  type ColumnKey,
  choicesFromHidden,
  columnsToSend,
  isColumnKey,
  mayMakeDefaults,
  shownColumns,
} from "@/lib/directory/directory-columns"
import {
  DIRECTORY_FILTER_BOUNDS,
  type DirectoryFilter,
  directoryFilterBody,
  OPENING_FILTER,
  parseDirectoryFilter,
  printDirectoryFilter,
  type SeedSets,
  withinDirectoryFilterBounds,
} from "@/lib/directory/directory-filter"
import {
  DIRECTORY_PARAMS,
  DISMISSAL_NOTICE_MS,
  type DirectoryParams,
  type DirectoryView,
  type DirectoryViewRequest,
  dismissalNotice,
  hasViewParams,
  paramsFromView,
  resolveYours,
  searchRequest,
  selectedFirstRequest,
  viewFromParams,
} from "@/lib/directory/directory-view"
import { scopedStorage } from "@/lib/storage/scoped"
import { queryKeys } from "./queryKeys"
import { useDirectorySearchBox } from "./useDirectorySearchBox"
import { useDiscoverIgnoreMutation } from "./useDiscover"

const workspaceRoute = getRouteApi("/_tg/workspace")

const VIEW_KEY = "directory.view"
const TICKS_KEY = "directory.ticks"
/** Each column's explicit On or Off; a column with none follows the default. */
const CHOICES_KEY = "directory.columns"
/** What the Columns menu stored before DCOL: the hidden columns, read once. */
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

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** The stored choices, adopting the pre-DCOL hidden list once. */
function readChoices(): ColumnChoices {
  const stored = readStored(CHOICES_KEY, isObject)
  if (stored) {
    // A column the server no longer has is dropped rather than failing the rest.
    return Object.fromEntries(
      Object.entries(stored).filter(
        ([key, c]) => isColumnKey(key) && (c === "on" || c === "off"),
      ),
    ) as ColumnChoices
  }
  const hidden = readStored(HIDDEN_KEY, isStrings)
  if (!hidden) return {}
  const choices = choicesFromHidden(hidden)
  scopedStorage.setItem(CHOICES_KEY, JSON.stringify(choices))
  scopedStorage.removeItem(HIDDEN_KEY)
  return choices
}

/** The column catalogue, this browser's choices over it, and setting defaults. */
function useColumns() {
  const queryClient = useQueryClient()
  const [choices, setStored] = useState(readChoices)
  const setChoices = useCallback((next: ColumnChoices) => {
    setStored(next)
    scopedStorage.setItem(CHOICES_KEY, JSON.stringify(next))
  }, [])
  const catalogue = useQuery({
    queryKey: queryKeys.directoryColumns,
    queryFn: () => dataListDirectoryColumns(),
    staleTime: SIZE_STALE_TIME,
  })
  const columns = catalogue.data ?? []
  const shown = shownColumns(columns, choices)
  const makeDefaults = async () => {
    try {
      const saved = await dataPutDirectoryColumns({ body: { on: shown } })
      queryClient.setQueryData(queryKeys.directoryColumns, saved)
      // The holder's own choices are the defaults now; keeping them would
      // leave their table no longer following the defaults.
      setChoices({})
      toast.success("These columns are now everyone's defaults")
    } catch (e) {
      toast.error(errorText(e, "The defaults did not save."))
    }
  }
  const menu: ColumnsMenu = {
    catalogue: columns,
    choices,
    onChoices: setChoices,
    onMakeDefaults: mayMakeDefaults(columns)
      ? () => void makeDefaults()
      : undefined,
  }
  // A failed catalogue still lets the list load, with no columns but the
  // Channel and Follow, rather than leaving the tab blank.
  return { ready: !catalogue.isPending, shown, menu }
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

export function useDirectory() {
  const { view, patch } = useView()
  const searchBox = useDirectorySearchBox(view, patch)
  const { selectedChannels, channels } = useData()
  const { followDiscoverChannels } = useScraper()
  const { directorySelectedFirst, setDirectorySelectedFirst } = useSettings()
  const queryClient = useQueryClient()
  const [ticked, setTicked] = useStoredList(TICKS_KEY)
  const columns = useColumns()
  // The last list read's columns and the view they were for (DCOL): hiding a
  // column keeps them, so nothing is read; any other change starts afresh.
  const sent = useRef<{ view: string; columns: ColumnKey[] }>(undefined)
  // A list of at most one handle, so the panel reuses the stored-list plumbing.
  const [opened, setOpened] = useStoredList(OPEN_KEY)
  const [following, setFollowing] = useState<ReadonlySet<string>>(new Set())
  const dismissal = useDiscoverIgnoreMutation()

  const parsed = useMemo(() => parseDirectoryFilter(view.filter), [view.filter])
  const filter =
    parsed ?? (parseDirectoryFilter(OPENING_FILTER) as DirectoryFilter)
  // A link whose filter no longer reads (DPF renamed the day measures) opens
  // on the opening filter, and says so rather than resetting silently.
  useEffect(() => {
    if (parsed) return
    // A tick later: on a page's first render this runs before the toaster,
    // a later sibling of the page, has subscribed, and a toast then is lost.
    setTimeout(() =>
      toast("This link's filter could not be read and was reset", {
        // One notice however often this runs (StrictMode runs it twice).
        id: "directory-filter-reset",
        description: "The Directory opened on its usual view instead.",
      }),
    )
    patch({ filter: OPENING_FILTER })
  }, [parsed, patch])
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
  // What Shared parents / children compare with, re-resolved on every read,
  // so the live ticked choice follows the ticks (DIR-07).
  const sets: SeedSets = useMemo(
    () => ({
      ticked: [...ticked].sort(),
      selection,
      follows: channels.map((c) => c.name).sort(),
    }),
    [ticked, selection, channels],
  )
  const yours = resolveYours(view.yours, {
    selection,
    ticked: sets.ticked,
  })
  const search = searchRequest(view)
  const request: DirectoryViewRequest = {
    filter: directoryFilterBody(filter, sets),
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
    ...selectedFirstRequest(directorySelectedFirst, yours, sets.ticked),
  }
  const viewKey = JSON.stringify(body)
  const sending = columnsToSend(
    columns.shown,
    sent.current?.view === viewKey ? sent.current.columns : undefined,
  )
  sent.current = { view: viewKey, columns: sending }
  const listBody = { ...body, columns: sending }
  const list = useQuery({
    queryKey: queryKeys.directoryRead("list", listBody),
    enabled: columns.ready,
    // `signal` is consumed, so a read nobody waits for any more (a cleared or
    // retyped search) is aborted rather than left to finish.
    queryFn: async ({ signal }) => {
      const started = performance.now()
      const data = await dataListDirectory({ body: listBody, signal })
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
      // The Ticks stay: a Channel just followed is still a Seed (DFP-01).
      await followDiscoverChannels(
        handles.map((name) => ({ name })),
        { directory: { yours, referenceKinds: view.kinds } },
      )
      await queryClient.invalidateQueries({ queryKey: queryKeys.directory })
    } finally {
      setFollowing(
        (prev) => new Set([...prev].filter((h) => !handles.includes(h))),
      )
    }
  }

  /** Sets or adds to the Priority boost of `handles` (DPF), a `DATA_ADMIN` write. */
  const boost = async (handles: string[], mode: BoostMode, value: number) => {
    try {
      const { changed } = await dataBoostDirectory({
        body: { handles, mode, value },
      })
      toast.success(`Boosted ${changed} ${changed === 1 ? "entry" : "entries"}`)
      await queryClient.invalidateQueries({ queryKey: queryKeys.directory })
    } catch (error) {
      toast.error(errorText(error, "The boost did not save."))
    }
  }

  /**
   * Dismisses Channels, or takes the Dismissal back, through Discover's own
   * routes, so one Dismissal hides the Channel in both tabs (DIR-06). The
   * confirmation offers Undo for ten seconds.
   */
  const dismiss = async (handles: string[], dismissed = true) => {
    try {
      await dismissal.mutateAsync({ handles, ignored: dismissed })
    } catch (error) {
      toast.error(errorText(error, "The Dismissal did not save."))
      return
    }
    if (!dismissed) return
    setTicked(ticked.filter((h) => !handles.includes(h)))
    toast(dismissalNotice(handles), {
      duration: DISMISSAL_NOTICE_MS,
      action: { label: "Undo", onClick: () => void dismiss(handles, false) },
    })
  }

  return {
    view,
    patch,
    dismiss,
    ...searchBox,
    filter,
    setFilter,
    request,
    sets,
    yours,
    ticks,
    setTicks: setTicked,
    selectedFirst: directorySelectedFirst,
    setSelectedFirst: setDirectorySelectedFirst,
    shownColumns: columns.shown,
    columnsMenu: columns.menu,
    open: opened[0] ?? null,
    setOpen: (handle: string | null) => setOpened(handle ? [handle] : []),
    following,
    follow,
    boost,
    list,
    size: size.data?.size,
  }
}
