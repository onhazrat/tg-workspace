/**
 * The Posts view module (PVM-01, ADR-039): the state that decides what the
 * Posts tab shows, the one Posts view built from it, and the edits.
 *
 * Three contexts, split by how often they change, so a reader pays only for
 * what it reads:
 *
 * - **The view** moves on every edit (and every minute of a Live window).
 * - **The edits** never change identity, so a reader that only edits (each
 *   Post card's find-related, a Summary bullet, the Artifact restore) never
 *   re-renders for one.
 * - **The typed keyword** moves on every keystroke and is read by the search
 *   box alone. The view holds it debounced once.
 *
 * Storage does not move: the Post filter in `?postFilter=` (PTR-03), the
 * order and cap in per-Account browser storage under their old keys, the
 * selection for the browser session (PTR-05). The keyword and the ranking
 * survive no reload.
 *
 * `PostsViewModule` takes everything it reads from outside as `inputs`, so a
 * test mounts it alone; `PostsViewProvider` wires those from the app.
 */

import { type QueryClient, useQueryClient } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"

import { api } from "@/api"
import { dataPostsViewEstimate, type FrozenScope } from "@/client"
import { queryKeys, VIEW_ESTIMATE_STALE_TIME } from "@/hooks/queryKeys"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { type PromptPosts, usePromptPosts } from "@/hooks/usePromptPosts"
import {
  emptyPostFilter,
  POST_FILTER_BOUNDS,
  type PostFilter,
  parsePostFilter,
  printPostFilter,
  withinPostFilterBounds,
} from "@/lib/posts/post-filter"
import { POST_ORDER_OPTIONS } from "@/lib/posts/post-filter-bar"
import {
  appendSteps,
  loadSelection,
  type PostSelection,
  removeChip,
  type SelectionChip,
  type SelectionPick,
  type SelectionStep,
  saveSelection,
} from "@/lib/posts/post-selection"
import {
  NO_RANKING,
  type PostsOrder,
  type PostsRanking,
  type PostsView,
  type RankingEdit,
} from "@/lib/posts/posts-view"
import { workspaceFromScope } from "@/lib/posts/restore-scope"
import type { ScopedPostsDeps } from "@/lib/posts/scoped-posts"
import type { WindowState } from "@/lib/scope/window"
import { scopedStorage } from "@/lib/storage/scoped"
import { useData } from "./DataContext"
import { useRAG } from "./RAGContext"
import { useScope } from "./ScopeContext"
import { useSettings } from "./SettingsContext"

/** How long a keystroke waits before it reaches the view. */
export const POST_SEARCH_DEBOUNCE_MS = 300

/**
 * The last selection edit: a number that moves on every one, and the Picks it
 * appended when it appended nothing else. The feed patches those rows in
 * place rather than refetching; any other edit refetches it.
 */
export type SelectionEdit = {
  revision: number
  picks: SelectionPick[] | null
}

/** What moves on every edit. */
interface PostsViewContextType {
  /** The whole Posts view, no spotlight applied; `usePostsView` applies one. */
  view: PostsView
  selectionEdit: SelectionEdit
  /** The Action path (PVM-02 replaces these with functions of `view`). */
  getScopedPosts: PromptPosts["getScopedPosts"]
  getPromptPostsInput: PromptPosts["getPromptPostsInput"]
}

/** Domain operations on the view, one identity for the provider's life. */
interface PostsViewEditsContextType {
  setKeyword: (keyword: string) => void
  /** Refused with a toast past the server's bounds, or the URL would drop it. */
  setPostFilter: (filter: PostFilter) => void
  /** The ranking, the "respects Channels" choice, or both (`RankingEdit`). */
  setRanking: (edit: RankingEdit) => void
  /** Any part of the order and cap; the rest is kept. */
  setOrder: (patch: Partial<PostsOrder>) => void
  /** Append steps; false, with a toast saying why, when a bound refuses. */
  appendSelection: (steps: SelectionStep[]) => boolean
  removeSelectionChip: (chip: Pick<SelectionChip, "start" | "end">) => void
  replaceSelection: (steps: PostSelection) => void
  /** Put an Artifact's frozen Scope back, every part at once (AW-08). */
  restore: (scope: FrozenScope) => void
}

export type PostsViewEdits = PostsViewEditsContextType

/** What the module reads from outside it. */
export interface PostsViewInputs {
  /** The selected Channels, in the Channel list's order. */
  selectedChannelNames: string[]
  startDate: number
  endDate: number
  windowKey: WindowState
  /** `?postFilter=` as text, and how to write it. */
  postFilterText: string | undefined
  setPostFilterText: (text: string | undefined) => void
  /** What `restore` reaches through the Channels' and the window's contexts. */
  setSelectedChannels: (channels: Set<string>) => void
  setFixedRange: (start: number, end: number) => void
  embeddingsEnabled: boolean
  searchSimilarPosts: ScopedPostsDeps["searchSimilarPosts"]
  getPostsFeed: ScopedPostsDeps["getPostsFeed"]
  lookupPosts: ScopedPostsDeps["lookupPosts"]
  getViewEstimate: ScopedPostsDeps["getViewEstimate"]
}

const PostsViewContext = createContext<PostsViewContextType | undefined>(
  undefined,
)
const PostsViewEditsContext = createContext<
  PostsViewEditsContextType | undefined
>(undefined)
const PostsKeywordContext = createContext<string | undefined>(undefined)

/**
 * Refetch every Posts read. A sync adds Posts and a Live minute moves the
 * window without changing a query key, so only this makes them appear.
 */
export function invalidatePostsReads(queryClient: QueryClient): void {
  for (const queryKey of queryKeys.postViews)
    queryClient.invalidateQueries({ queryKey })
}

// The order and cap in browser storage. Not Settings: a transient view that
// happens to survive a reload, so the parse fallbacks live here.

/** Storage keys the order and cap live under, before namespacing. */
export const POST_FILTER_STORAGE_KEYS = {
  maxPerChannel: "postFilter_maxPerChannel",
  maxPerChannelMode: "postFilter_maxPerChannelMode",
  sortOrder: "postFilter_sortOrder",
  groupByChannel: "postFilter_groupByChannel",
  viewMeasure: "postFilter_viewMeasure",
} as const

const KEYS = POST_FILTER_STORAGE_KEYS
const SORT_ORDERS = POST_ORDER_OPTIONS.map((option) => option.value)

/**
 * The stored order, a value an earlier bundle stored read into today's shape
 * (PFB-01): `latest` is `ordered`, `time` newest, and `channel_time`, with no
 * grouping key yet, newest grouped.
 */
export function readStoredOrder(): PostsOrder {
  const cap = Number.parseInt(
    scopedStorage.getItem(KEYS.maxPerChannel) ?? "",
    10,
  )
  const sort = scopedStorage.getItem(KEYS.sortOrder)
  const grouped = scopedStorage.getItem(KEYS.groupByChannel)
  return {
    maxPerChannel: Number.isFinite(cap) && cap >= 0 ? cap : 0,
    maxPerChannelMode:
      scopedStorage.getItem(KEYS.maxPerChannelMode) === "random"
        ? "random"
        : "ordered",
    sort: SORT_ORDERS.find((order) => order === sort) ?? "newest",
    groupByChannel:
      grouped === "true" || grouped === "false"
        ? grouped === "true"
        : sort === "channel_time",
    viewMeasure:
      scopedStorage.getItem(KEYS.viewMeasure) === "views"
        ? "views"
        : "estimated",
  }
}

function storeOrder(order: PostsOrder): void {
  scopedStorage.setItem(KEYS.maxPerChannel, String(order.maxPerChannel))
  scopedStorage.setItem(KEYS.maxPerChannelMode, order.maxPerChannelMode)
  scopedStorage.setItem(KEYS.sortOrder, order.sort)
  scopedStorage.setItem(KEYS.groupByChannel, String(order.groupByChannel))
  scopedStorage.setItem(KEYS.viewMeasure, order.viewMeasure)
}

/** The Post filter `?postFilter=` holds; one that does not parse is ignored. */
const readPostFilter = (text: string | undefined): PostFilter =>
  (text ? parsePostFilter(text) : null) ?? emptyPostFilter()

/** The Post selection, held in a ref too so two edits in one tick compose. */
function useSelection() {
  const [selection, setSelection] = useState<PostSelection>(loadSelection)
  const latest = useRef(selection)
  const [edit, setEdit] = useState<SelectionEdit>({ revision: 0, picks: null })
  const commit = useCallback(
    (next: PostSelection, picks: SelectionPick[] | null) => {
      latest.current = next
      setSelection(next)
      saveSelection(next)
      setEdit((last) => ({ revision: last.revision + 1, picks }))
    },
    [],
  )
  const edits = useMemo(
    () => ({
      appendSelection: (steps: SelectionStep[]) => {
        const next = appendSteps(latest.current, steps)
        if (typeof next === "string") {
          toast.error(next)
          return false
        }
        const picks = steps.filter((s): s is SelectionPick => s.kind === "pick")
        commit(next, picks.length === steps.length ? picks : null)
        return true
      },
      removeSelectionChip: (chip: Pick<SelectionChip, "start" | "end">) =>
        commit(removeChip(latest.current, chip), null),
      replaceSelection: (steps: PostSelection) => commit(steps, null),
    }),
    [commit],
  )
  return { selection, edit, edits }
}

export function PostsViewModule({
  inputs,
  children,
}: {
  inputs: PostsViewInputs
  children: ReactNode
}) {
  const [keyword, setKeyword] = useState("")
  const debouncedKeyword = useDebouncedValue(keyword, POST_SEARCH_DEBOUNCE_MS)
  const [ranking, setRankingState] = useState<PostsRanking>(NO_RANKING)
  // Provider state, not stored: it outlives the search bar, not a reload.
  const [respectsChannels, setRespectsChannels] = useState(false)
  const [order, setOrderState] = useState<PostsOrder>(readStoredOrder)
  useEffect(() => storeOrder(order), [order])
  const { selection, edit, edits: selectionEdits } = useSelection()
  const filter = useMemo(
    () => readPostFilter(inputs.postFilterText),
    [inputs.postFilterText],
  )

  const { selectedChannelNames, startDate, endDate, windowKey } = inputs
  const view = useMemo<PostsView>(
    () => ({
      scopeChannelNames: selectedChannelNames,
      channelNames: selectedChannelNames,
      keyword: debouncedKeyword,
      ranking,
      respectsChannels,
      filter,
      ...order,
      startDate,
      endDate,
      windowKey,
      selection,
      selectionRevision: edit.revision,
    }),
    [
      selectedChannelNames,
      debouncedKeyword,
      ranking,
      respectsChannels,
      filter,
      order,
      startDate,
      endDate,
      windowKey,
      selection,
      edit.revision,
    ],
  )

  const { getScopedPosts, getPromptPostsInput } = usePromptPosts({
    view,
    embeddingsEnabled: inputs.embeddingsEnabled,
    searchSimilarPosts: inputs.searchSimilarPosts,
    getPostsFeed: inputs.getPostsFeed,
    lookupPosts: inputs.lookupPosts,
    getViewEstimate: inputs.getViewEstimate,
  })
  const state = useMemo<PostsViewContextType>(
    () => ({
      view,
      selectionEdit: edit,
      getScopedPosts,
      getPromptPostsInput,
    }),
    [view, edit, getScopedPosts, getPromptPostsInput],
  )

  // The inputs an edit reaches, read when it runs so the edits never change.
  const outside = useRef(inputs)
  outside.current = inputs
  const edits = useMemo<PostsViewEditsContextType>(() => {
    const setPostFilter = (next: PostFilter) => {
      if (!withinPostFilterBounds(next)) {
        toast.error(
          `A Post filter holds at most ${POST_FILTER_BOUNDS.nodes} blocks, nested ${POST_FILTER_BOUNDS.depth} levels deep.`,
        )
        return
      }
      outside.current.setPostFilterText(printPostFilter(next) || undefined)
    }
    const setOrder = (patch: Partial<PostsOrder>) =>
      setOrderState((current) => ({ ...current, ...patch }))
    const setRanking = (edit: RankingEdit) => {
      if (edit.ranking) setRankingState(edit.ranking)
      if (edit.respectsChannels !== undefined)
        setRespectsChannels(edit.respectsChannels)
    }
    return {
      setKeyword,
      setPostFilter,
      setRanking,
      setOrder,
      ...selectionEdits,
      restore: (scope) => {
        const next = workspaceFromScope(scope)
        outside.current.setSelectedChannels(next.channels)
        outside.current.setFixedRange(scope.start, scope.end)
        setKeyword(next.keyword)
        setPostFilter(next.postFilter)
        setOrder({
          viewMeasure: next.viewMeasure,
          maxPerChannel: next.maxPerChannel,
          maxPerChannelMode: next.maxPerChannelMode,
          sort: next.sort,
          groupByChannel: next.groupByChannel,
        })
        selectionEdits.replaceSelection(next.selection)
        setRanking({ ranking: NO_RANKING })
      },
    }
  }, [selectionEdits])

  return (
    <PostsViewEditsContext.Provider value={edits}>
      <PostsViewContext.Provider value={state}>
        <PostsKeywordContext.Provider value={keyword}>
          {children}
        </PostsKeywordContext.Provider>
      </PostsViewContext.Provider>
    </PostsViewEditsContext.Provider>
  )
}

const workspaceRoute = getRouteApi("/_tg/")

/**
 * The selected Channels' names in the Channel list's order, one identity
 * while they read the same: the list reloads after every sync, and a new
 * array would re-run a meaning search.
 */
function useSelectedChannelNames(): string[] {
  const { channels, selectedChannels } = useData()
  const joined = channels
    .filter((channel) => selectedChannels.has(channel.name))
    .map((channel) => channel.name)
    .join("\n")
  return useMemo(() => (joined ? joined.split("\n") : []), [joined])
}

/** The module wired to the app: the Channels, the window, the URL and the api. */
export function PostsViewProvider({ children }: { children: ReactNode }) {
  const { setSelectedChannels } = useData()
  const { startDate, endDate, windowKey, setFixedRange } = useScope()
  const { embeddingsEnabled } = useSettings()
  const { searchSimilarPosts } = useRAG()
  const queryClient = useQueryClient()
  const { postFilter } = workspaceRoute.useSearch()
  const navigate = workspaceRoute.useNavigate()
  const setPostFilterText = useCallback(
    (text: string | undefined) =>
      navigate({
        search: (prev) => ({ ...prev, postFilter: text }),
        replace: true,
      }),
    [navigate],
  )
  const getViewEstimate = useCallback(
    () =>
      queryClient.fetchQuery({
        queryKey: queryKeys.viewEstimate,
        queryFn: () => dataPostsViewEstimate(),
        staleTime: VIEW_ESTIMATE_STALE_TIME,
      }),
    [queryClient],
  )
  return (
    <PostsViewModule
      inputs={{
        selectedChannelNames: useSelectedChannelNames(),
        startDate,
        endDate,
        windowKey,
        postFilterText: postFilter,
        setPostFilterText,
        setSelectedChannels,
        setFixedRange,
        embeddingsEnabled,
        searchSimilarPosts,
        getPostsFeed: api.getPostsFeed,
        lookupPosts: api.lookupPosts,
        getViewEstimate,
      }}
    >
      {children}
    </PostsViewModule>
  )
}

function required<T>(value: T | undefined, hook: string): T {
  if (value === undefined)
    throw new Error(`${hook} must be used within a PostsViewProvider`)
  return value
}

/** The view and the Action path; re-renders on every edit. */
export const usePostsViewState = (): PostsViewContextType =>
  required(useContext(PostsViewContext), "usePostsViewState")

/** The edits; never re-renders for one. */
export const usePostsViewEdits = (): PostsViewEdits =>
  required(useContext(PostsViewEditsContext), "usePostsViewEdits")

/** The keyword as typed, for the search box alone. */
export const usePostsKeyword = (): string =>
  required(useContext(PostsKeywordContext), "usePostsKeyword")
