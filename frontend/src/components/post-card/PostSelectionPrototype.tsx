/**
 * PROTOTYPE (post-card): the Channels tab's filter and Selection, on Posts.
 * Variant A-plus-select, built from A-plus-menu. Every filter control is the
 * Channels tab's own component (`components/filter-tree/`), so the two tabs
 * share one facet menu, one filter row and one condition picker.
 *
 *   Facets   Type, Media and Language dropdowns: a search, a row per value
 *            with a tick that selects every matching Post in the window (up
 *            to 5,000), selected/total, and a funnel into the filter tree.
 *   Filter   the Channels filter row over Post Conditions: NOT on any block,
 *            parentheses, drag to group, AND/OR per pair of parentheses, and
 *            bounds on Views and Estimated views from the Filters picker.
 *   Select   a checkbox on every card (shift-click for a range, x on the
 *            keyboard), and a Selection bar: the Channels Venn to adjust it
 *            against what the filters show, the action limit, and actions.
 *            Summarize and Chat would send the Selection as the Scope's
 *            `posts` (max 5,000); here they are stubs that say so.
 *
 * The staging backend cannot run the tree, so this prototype evaluates it on
 * the loaded pages (`matchesPostFilter`) and marks its counts "≈". The server
 * tree is built for the fold-in (`PostScopeRequest.filter`); see
 * docs/post-filter-tree-plan.md.
 *
 * Decisions settled with the Account on 2026-10-01: Selection feeds Actions
 * plus bulk tools, a facet tick selects every match in the window, and the
 * filter has NOT and parentheses like Channels, client-side until fold-in.
 */
import {
  Check,
  Copy,
  Download,
  Eye,
  Image,
  Languages,
  Loader2,
  type LucideIcon,
  MessageSquare,
  Repeat2,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react"
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
import type { PostFeedQuery } from "@/api/data"
import { useData } from "@/contexts/DataContext"
import { usePostFilterTree } from "@/contexts/PostFilterTreeContext"
import { useScope } from "@/contexts/ScopeContext"
import { useScraper } from "@/contexts/ScraperContext"
import {
  usePostFacets,
  useScopedPostCounts,
  useViewEstimate,
} from "@/hooks/usePostsView"
import type { ActionLimit } from "@/lib/channels/selection-regions"
import {
  addFunnel,
  append,
  atoms,
  clearFunnels,
  funnelledValues,
  removeFunnel,
} from "@/lib/filter-tree"
import {
  languageLabel,
  languageOptions,
  POST_TYPE_OPTIONS,
} from "@/lib/posts/post-filter-bar"
import {
  emptyPostFilter,
  matchesPostCond,
  matchesPostFilter,
  type PostCond,
  type PostFilterInputs,
  type PostTypeValue,
  type PostValueCond,
  postConditionLabel,
} from "@/lib/posts/post-filter-tree"
import { MEDIA_KIND_OPTIONS, type MediaKind } from "@/lib/posts/post-media"
import type { ViewMeasure } from "@/lib/posts/post-view"
import { applyKeywordFilter } from "@/lib/posts/post-view"
import { telegramWebViewPostUrl } from "@/lib/telegram-web"
import { cn } from "@/lib/utils"
import type { Post } from "@/types"
import { BarToggle } from "../channel-grid/ChannelBarControls"
import {
  ActionLimitIndicator,
  ChannelSelectionAdjust,
} from "../channel-grid/ChannelSelectionAdjust"
import {
  ConditionPicker,
  type PickerVocabulary,
} from "../filter-tree/ConditionPicker"
import { FacetMenu, type FacetMenuRow } from "../filter-tree/FacetMenu"
import { FilterRow, type FilterVocabulary } from "../filter-tree/FilterRow"
import { pillClass } from "../PostFilterParts"
import { useCardVariant, useFeedPrefs } from "./PostCardPrototype"
import { postTime } from "./post-card-model"
import {
  PostSortMenu,
  ViewsEditor,
  ViewsFiltersMenu,
} from "./ViewsFilterPrototype"

export const postKey = (p: Post) => `${p.channelName}_${p.id}`
const RESOLVE_CAP = 5000

const useSelectVariant = () => useCardVariant() === "A-plus-select"

// ---------------------------------------------------------------------------
// The Selection: Posts by key, kept whole so bulk tools need no refetch.

type SelectionApi = {
  selected: Map<string, Post>
  toggle: (post: Post, range: boolean) => void
  add: (posts: Post[]) => void
  removeWhere: (test: (post: Post) => boolean) => void
  /** The Venn's answer, as keys; looked up in the Selection and the feed. */
  setKeys: (keys: Set<string>) => void
  clear: () => void
  /** "Selected first", as the Channels Selection bar has it. */
  selectedFirst: boolean
  setSelectedFirst: (on: boolean) => void
  limit: ActionLimit
  setLimit: (limit: ActionLimit) => void
  /** The feed's loaded Posts, in order, for ranges and the Venn's "shown". */
  feed: React.MutableRefObject<Post[]>
}

const SelectionContext = createContext<SelectionApi | null>(null)
export const usePostSelection = () => useContext(SelectionContext)

export function PostSelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Map<string, Post>>(new Map())
  const [selectedFirst, setSelectedFirst] = useState(false)
  const [limit, setLimit] = useState<ActionLimit>("all")
  const feed = useRef<Post[]>([])
  const last = useRef<string | null>(null)

  const toggle = useCallback((post: Post, range: boolean) => {
    const key = postKey(post)
    setSelected((prev) => {
      const next = new Map(prev)
      const order = feed.current
      const from = last.current
        ? order.findIndex((p) => postKey(p) === last.current)
        : -1
      const to = order.findIndex((p) => postKey(p) === key)
      if (range && from >= 0 && to >= 0) {
        // Shift-click: everything between the last click and this one.
        const [a, b] = from < to ? [from, to] : [to, from]
        for (const p of order.slice(a, b + 1)) next.set(postKey(p), p)
      } else if (next.has(key)) next.delete(key)
      else next.set(key, post)
      return next
    })
    last.current = key
  }, [])
  const add = useCallback((posts: Post[]) => {
    setSelected((prev) => {
      const next = new Map(prev)
      for (const p of posts) next.set(postKey(p), p)
      return next
    })
  }, [])
  const removeWhere = useCallback((test: (post: Post) => boolean) => {
    setSelected((prev) => new Map([...prev].filter(([, post]) => !test(post))))
  }, [])
  const setKeys = useCallback((keys: Set<string>) => {
    setSelected((prev) => {
      const known = new Map(prev)
      for (const p of feed.current) known.set(postKey(p), p)
      const next = new Map<string, Post>()
      for (const k of keys) {
        const p = known.get(k)
        if (p) next.set(k, p)
      }
      return next
    })
  }, [])
  const clear = useCallback(() => {
    setSelected(new Map())
  }, [])

  const api = useMemo(
    () => ({
      selected,
      toggle,
      add,
      removeWhere,
      setKeys,
      clear,
      selectedFirst,
      setSelectedFirst,
      limit,
      setLimit,
      feed,
    }),
    [selected, toggle, add, removeWhere, setKeys, clear, selectedFirst, limit],
  )
  return (
    <SelectionContext.Provider value={api}>
      {children}
    </SelectionContext.Provider>
  )
}

/** The feed as A-plus-select shows it: the Selection alone when asked. */
/**
 * The feed with "Selected first": the selected Posts the filters let through
 * on top, then the rest in feed order, as Channels lists selected Channels
 * first among the shown ones. A selected Post the filters hide stays hidden.
 * ponytail: the top block is newest first, not the feed's order, because a
 * Post selected by a tick may sit on a page not loaded yet; ordering it like
 * the feed needs the server to sort the Selection.
 */
export function useSelectionFeed(posts: Post[]): Post[] {
  const sel = usePostSelection()
  const on = useSelectVariant()
  const matches = useMatchesFilters()
  if (sel) sel.feed.current = posts
  if (!on || !sel?.selectedFirst || sel.selected.size === 0) return posts
  const top = [...sel.selected.values()]
    .filter(matches)
    .sort((a, b) => postTime(b) - postTime(a))
  return [...top, ...posts.filter((p) => !sel.selected.has(postKey(p)))]
}

// ---------------------------------------------------------------------------
// The card's checkbox.

export function useIsPostSelected(post: Post): boolean {
  const sel = usePostSelection()
  return useSelectVariant() && !!sel?.selected.has(postKey(post))
}

export function SelectBox({ post }: { post: Post }) {
  const sel = usePostSelection()
  const on = useSelectVariant()
  if (!on || !sel) return null
  const checked = sel.selected.has(postKey(post))
  return (
    // biome-ignore lint/a11y/useSemanticElements: matches the facet rows' checkbox, which must say "mixed".
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? "Deselect post" : "Select post"}
      title="Select (shift-click for a range, x on the keyboard)"
      data-shortcut="x"
      onClick={(e) => sel.toggle(post, e.shiftKey)}
      className={cn(
        "grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border text-[10px] leading-none transition-colors",
        checked
          ? "border-violet-600 bg-violet-600 text-white"
          : "border-app-ink/30 hover:border-app-ink/60",
      )}
    >
      {checked && <Check size={11} strokeWidth={3} />}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Matching a Post in the browser: the tree, plus window, Channels and search.

function useScopeBase(): Pick<
  PostFeedQuery,
  "channelNames" | "startDate" | "endDate"
> {
  const { startDate, endDate } = useScope()
  const { channels, selectedChannels } = useData()
  const channelNames = useMemo(
    () =>
      channels.filter((c) => selectedChannels.has(c.name)).map((c) => c.name),
    [channels, selectedChannels],
  )
  return { channelNames, startDate, endDate }
}

function useFilterInputs(): PostFilterInputs {
  const { channels } = useData()
  const estimate = useViewEstimate()
  return useMemo(() => ({ channels, estimate }), [channels, estimate])
}

/**
 * A-plus-select's feed: the loaded pages through the tree. ponytail: the
 * server pages before the tree runs, so a page can come back thin and the
 * counts are of loaded Posts; the fold-in sends the tree as `filter`.
 */
export function useTreeFilter(
  posts: Post[],
  skip: boolean,
): { posts: Post[]; active: boolean } {
  const on = useSelectVariant()
  const { tree } = usePostFilterTree()
  const inputs = useFilterInputs()
  const active = on && !skip && tree.children.length > 0
  const shown = useMemo(
    () =>
      active ? posts.filter((p) => matchesPostFilter(tree, p, inputs)) : posts,
    [active, posts, tree, inputs],
  )
  return { posts: shown, active }
}

/**
 * Whether a Post passes everything the feed applies, for the Venn and for
 * "Select all matching". ponytail: the search test is a substring, the
 * server's is its own; close enough for the Venn, wrong for a count.
 */
function useMatchesFilters(): (post: Post) => boolean {
  const s = useScraper()
  const { selectedChannels } = useData()
  const { startDate, endDate } = useScope()
  const { tree } = usePostFilterTree()
  const inputs = useFilterInputs()
  return useCallback(
    (post: Post) => {
      if (!selectedChannels.has(post.channelName)) return false
      const t = postTime(post)
      if ((startDate && t < startDate) || (endDate && t > endDate)) return false
      if (!applyKeywordFilter([post], s.postSearch).length) return false
      return matchesPostFilter(tree, post, inputs)
    },
    [s.postSearch, selectedChannels, startDate, endDate, tree, inputs],
  )
}

// ---------------------------------------------------------------------------
// The Posts vocabulary: what the shared picker, row and chips are told.

const ICON: Record<PostCond["type"], LucideIcon> = {
  type: Repeat2,
  media: Image,
  language: Languages,
  views: Eye,
}
const MEASURES: { measure: ViewMeasure; label: string }[] = [
  { measure: "views", label: "Views" },
  { measure: "estimated", label: "Estimated views" },
]
const TYPE_ROWS = POST_TYPE_OPTIONS.filter((o) => o.value !== "all").map(
  (o) => ({ id: o.value, label: o.label }),
)
const MEDIA_ROWS = MEDIA_KIND_OPTIONS.map((o) => ({
  id: o.value,
  label: o.label,
}))

function useLanguageRows(counted?: { value: string; count: number }[]) {
  const { channels } = useData()
  const { tree } = usePostFilterTree()
  return languageOptions(
    counted,
    channels.map((c) => c.language).filter((c): c is string => !!c),
    funnelledValues(tree, "language"),
  ).map(({ code, count }) => ({ id: code, label: languageLabel(code), count }))
}

/** The two number editors, as the picker's "Numbers" section. */
const numbersSection: PickerVocabulary<PostCond>["sections"][number] = {
  heading: "Numbers",
  entries: MEASURES.map(({ measure, label }) => ({
    kind: "editor" as const,
    id: `views:${measure}`,
    label,
    icon: SlidersHorizontal,
    render: ({ start, onSubmit, onBack }) => (
      <ViewsEditor
        fixedMeasure={measure}
        initial={start?.type === "views" ? start : undefined}
        onBack={onBack}
        onSubmitBound={(bound) =>
          onSubmit({ type: "views", measure, ...bound })
        }
      />
    ),
  })),
}

const entryOf = (cond: PostCond) =>
  cond.type === "views" ? `views:${cond.measure}` : cond.type

function usePostVocabulary(): FilterVocabulary<PostCond> {
  const languages = useLanguageRows()
  return {
    sections: [
      {
        entries: [
          {
            kind: "list",
            id: "type",
            label: "Type",
            icon: Repeat2,
            options: TYPE_ROWS,
            make: (v) => ({ type: "type", value: v as PostTypeValue }),
            current: (c) => (c.type === "type" ? c.value : undefined),
          },
          {
            kind: "list",
            id: "media",
            label: "Media",
            icon: Image,
            options: MEDIA_ROWS,
            make: (v) => ({ type: "media", value: v as MediaKind }),
            current: (c) => (c.type === "media" ? c.value : undefined),
          },
          {
            kind: "list",
            id: "language",
            label: "Language",
            icon: Languages,
            options: languages,
            make: (v) => ({ type: "language", value: v }),
            current: (c) => (c.type === "language" ? c.value : undefined),
          },
        ],
      },
      numbersSection,
    ],
    entryOf,
    label: postConditionLabel,
    icon: (c) => ICON[c.type],
    chipId: (c) =>
      c.type === "views" ? `views-${c.measure}` : `${c.type}-${c.value}`,
  }
}

// ---------------------------------------------------------------------------
// The facet dropdowns: the Channels FacetMenu, ticking every match in the
// window and funnelling into the tree.

type Kind = PostValueCond["type"]

function PostFacet({
  kind,
  label,
  noun,
  icon,
  options,
  onOpenChange,
}: {
  kind: Kind
  label: string
  noun: string
  icon: ReactNode
  options: { id: string; label: string; count?: number }[]
  onOpenChange?: (open: boolean) => void
}) {
  const sel = usePostSelection()
  const { tree, setTree } = usePostFilterTree()
  const inputs = useFilterInputs()
  const base = useScopeBase()
  const [busy, setBusy] = useState<string | null>(null)
  const cond = (id: string) => ({ type: kind, value: id }) as PostValueCond
  const selected = sel ? [...sel.selected.values()] : []
  const inRow = (id: string) =>
    selected.filter((p) => matchesPostCond(cond(id), p, inputs)).length

  // A tick selects every Post in the window with this value, filters aside,
  // as a Channels tick selects every Channel in its row whatever is shown.
  const tick = async (row: FacetMenuRow) => {
    if (!sel) return
    if (row.selected > 0) {
      sel.removeWhere((p) => matchesPostCond(cond(row.id), p, inputs))
      return
    }
    setBusy(row.id)
    try {
      const patch: Partial<PostFeedQuery> =
        kind === "type"
          ? { forwarded: row.id as PostTypeValue }
          : kind === "media"
            ? { media: [row.id as MediaKind] }
            : { languages: [row.id] }
      const posts = await api.getPostsFeed({
        ...base,
        ...patch,
        sort: "newest",
        limit: RESOLVE_CAP,
        offset: 0,
      })
      sel.add(posts)
      toast.success(
        `Selected ${posts.length.toLocaleString()} ${row.label} posts${posts.length >= RESOLVE_CAP ? ", the newest 5,000" : ""}`,
      )
    } catch {
      toast.error(`Could not select the ${row.label} posts`)
    } finally {
      setBusy(null)
    }
  }

  const rows: FacetMenuRow[] = options.map((o) => {
    const n = inRow(o.id)
    const full = o.count != null && o.count > 0 && n >= o.count
    return {
      id: o.id,
      label: o.label,
      selected: n,
      total: o.count,
      tick: full ? "true" : n > 0 ? "mixed" : "false",
      busy: busy === o.id,
    }
  })
  return (
    <FacetMenu
      icon={icon}
      label={label}
      noun={noun}
      testId={`post-facet-${kind}`}
      rows={rows}
      funnelled={funnelledValues(tree, kind)}
      labelOf={(id) => options.find((o) => o.id === id)?.label ?? id}
      onToggleSelect={tick}
      onFunnel={(id, on) =>
        setTree(on ? addFunnel(tree, cond(id)) : removeFunnel(tree, kind, id))
      }
      onClearFunnels={() => setTree(clearFunnels(tree, kind))}
      tickHint="Tick selects all in the window, the funnel shows only"
      onOpenChange={onOpenChange}
    />
  )
}

function TypeFacet() {
  return (
    <PostFacet
      kind="type"
      label="Type"
      noun="type"
      icon={<Repeat2 size={12} />}
      options={TYPE_ROWS}
    />
  )
}

function MediaFacet() {
  const [open, setOpen] = useState(false)
  const counts = new Map(
    usePostFacets(open)?.media.map((f) => [f.value, f.count]),
  )
  return (
    <PostFacet
      kind="media"
      label="Media"
      noun="media kind"
      icon={<Image size={12} />}
      onOpenChange={setOpen}
      options={MEDIA_ROWS.map((r) => ({ ...r, count: counts.get(r.id) }))}
    />
  )
}

function LanguageFacet() {
  const [open, setOpen] = useState(false)
  const rows = useLanguageRows(usePostFacets(open)?.languages)
  return (
    <PostFacet
      kind="language"
      label="Language"
      noun="language"
      icon={<Languages size={12} />}
      onOpenChange={setOpen}
      options={rows}
    />
  )
}

/** "Filters" with the number Conditions, as Channels → Filters. */
function NumbersMenu() {
  const { tree, setTree } = usePostFilterTree()
  const vocabulary = usePostVocabulary()
  const n = atoms(tree).filter((a) => a.cond.type === "views").length
  return (
    <ConditionPicker
      vocabulary={{ ...vocabulary, sections: [numbersSection] }}
      onPick={(cond) => setTree(append(tree, "root", cond))}
      trigger={
        <button
          type="button"
          data-testid="post-filters"
          className={pillClass(n > 0)}
        >
          <SlidersHorizontal size={12} /> Filters
          {n > 0 && (
            <span className="rounded-full bg-app-bg/20 px-1.5 text-[10px] tabular-nums">
              {n}
            </span>
          )}
        </button>
      }
    />
  )
}

// ---------------------------------------------------------------------------
// The filter row: the Channels FilterRow over the Posts tree.

/**
 * The feed's own Type, Media, Language and views filters, moved into the
 * tree when this variant opens (and whenever something else sets one, such
 * as the palette), so the tree is the one place a filter lives here.
 */
function useAdoptFeedFilters() {
  const s = useScraper()
  const prefs = useFeedPrefs()
  const { tree, setTree } = usePostFilterTree()
  const { forwardedFilter, mediaFilter, languageFilter, viewsFilter } = s
  useEffect(() => {
    const any =
      forwardedFilter !== "all" ||
      mediaFilter.length > 0 ||
      languageFilter.length > 0 ||
      viewsFilter != null
    if (!any) return
    let next = tree
    if (forwardedFilter !== "all")
      next = addFunnel(next, { type: "type", value: forwardedFilter })
    for (const value of mediaFilter)
      next = addFunnel(next, { type: "media", value })
    for (const value of languageFilter)
      next = addFunnel(next, { type: "language", value })
    if (viewsFilter) {
      const bound =
        viewsFilter.op === "gte"
          ? { min: viewsFilter.value, max: prefs.viewsMax ?? undefined }
          : { max: viewsFilter.value }
      next = append(next, "root", {
        type: "views",
        measure: s.viewMeasure,
        ...bound,
      })
    }
    setTree(next)
    s.setForwardedFilter("all")
    s.setMediaFilter([])
    s.setLanguageFilter([])
    s.setViewsFilter(null)
    prefs.set({ viewsMax: null })
  }, [forwardedFilter, mediaFilter, languageFilter, viewsFilter])
}

function PostFilterRow({ before, shown }: { before: number; shown: number }) {
  const s = useScraper()
  const { tree, setTree } = usePostFilterTree()
  const vocabulary = usePostVocabulary()
  useAdoptFeedFilters()
  return (
    <div className="-mx-4 -mb-4">
      <FilterRow
        filter={tree}
        onChange={setTree}
        vocabulary={vocabulary}
        testId="post-filter"
        search={s.postSearch}
        shownCount={shown}
        totalCount={before}
        onClearSearch={() => s.setPostSearch("")}
        onClearAll={() => {
          setTree(emptyPostFilter())
          s.setPostSearch("")
        }}
        approximate={`Counted on the ${before.toLocaleString()} loaded posts: the staging server cannot run this filter yet, so the browser does. The real one runs on the server over the whole window.`}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// The Selection bar: count, adjust against the filters, actions.

const actionClass =
  "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold text-app-ink/80 hover:bg-app-ink/10 hover:text-app-ink disabled:opacity-40"

function exportMarkdown(posts: Post[]) {
  const md = posts
    .map(
      (p) =>
        `## @${p.channelName} #${p.id} · ${new Date(postTime(p)).toLocaleString()}\n\n${p.text}\n\n${telegramWebViewPostUrl(p.channelName, p.id)}`,
    )
    .join("\n\n---\n\n")
  const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }))
  const a = document.createElement("a")
  a.href = url
  a.download = `posts-${posts.length}.md`
  a.click()
  URL.revokeObjectURL(url)
}

export function PostSelectionBar() {
  const sel = usePostSelection()
  const matches = useMatchesFilters()
  const base = useScopeBase()
  const s = useScraper()
  const [resolving, setResolving] = useState(false)
  // The filter bar's footer is gone in this variant; its one number lives here.
  const inWindow = Object.values(useScopedPostCounts()).reduce(
    (sum, n) => sum + n,
    0,
  )
  if (!useSelectVariant() || !sel) return null

  const keys = new Set(sel.selected.keys())
  // "Shown" is what the filters let through that this page knows: the loaded
  // feed, plus selected Posts that match but have not been scrolled to.
  const loaded = sel.feed.current.map(postKey)
  const loadedSet = new Set(loaded)
  const shown = [
    ...loaded,
    ...[...sel.selected.values()]
      .filter((p) => !loadedSet.has(postKey(p)) && matches(p))
      .map(postKey),
  ]
  // The limit narrows the local tools only. Summarize and Chat always take
  // the whole Selection, for the reason CTB-04's guard gives: an Artifact
  // must never quietly cover just what one filter happened to show.
  const shownSet = new Set(shown)
  const whole = [...sel.selected.values()]
  const targets =
    sel.limit === "all" ? whole : whole.filter((p) => shownSet.has(postKey(p)))
  const n = targets.length

  const selectAllMatching = async () => {
    setResolving(true)
    try {
      const posts = await api.getPostsFeed({
        ...base,
        // The window, Channels and search on the server; the tree after.
        keyword: s.postSearch,
        sort: "newest",
        limit: RESOLVE_CAP,
        offset: 0,
      })
      const kept = posts.filter(matches)
      sel.add(kept)
      toast.success(
        `Selected ${kept.length.toLocaleString()} matching posts${posts.length >= RESOLVE_CAP ? ", the newest 5,000" : ""}`,
      )
    } catch {
      toast.error("Could not select the matching posts")
    } finally {
      setResolving(false)
    }
  }
  const stub = (what: string) =>
    toast(`Prototype: would start a ${what} over ${whole.length} posts`, {
      description: `Scope.posts = ${whole.length} refs, the whole Selection (the API takes up to 5,000).`,
    })

  return (
    <div
      data-testid="post-selection-bar"
      className={cn(
        "sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-1 rounded-xl border px-2 py-1.5 shadow-sm backdrop-blur-md",
        keys.size
          ? "border-violet-500/40 bg-app-card/95"
          : "border-app-ink/10 bg-app-card/80",
      )}
    >
      <span className="px-1.5 text-[12px] font-semibold tabular-nums">
        {keys.size
          ? `${keys.size.toLocaleString()} selected`
          : "No posts selected"}
        <span className="font-normal text-app-ink/50">
          {" "}
          · {inWindow.toLocaleString()} in window
        </span>
      </span>
      <button
        type="button"
        onClick={selectAllMatching}
        disabled={resolving}
        className={actionClass}
        title="Every post the filters match in the window, up to 5,000"
      >
        {resolving ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Check size={12} />
        )}
        Select all matching
      </button>
      {keys.size > 0 && (
        <>
          <ChannelSelectionAdjust
            selection={keys}
            shown={shown}
            onApply={sel.setKeys}
            limit={sel.limit}
            onLimitChange={sel.setLimit}
          />
          <ActionLimitIndicator
            selection={keys}
            shown={shown}
            limit={sel.limit}
            onLimitChange={sel.setLimit}
          />
          <span className="mx-1 h-5 w-px bg-app-ink/10" />
          <button
            type="button"
            className={actionClass}
            onClick={() => stub("Summary")}
          >
            <Sparkles size={12} /> Summarize {whole.length}
          </button>
          <button
            type="button"
            className={actionClass}
            onClick={() => stub("Chat")}
          >
            <MessageSquare size={12} /> Chat
          </button>
          <button
            type="button"
            className={actionClass}
            disabled={!n}
            onClick={() =>
              navigator.clipboard
                .writeText(
                  targets
                    .map((p) => telegramWebViewPostUrl(p.channelName, p.id))
                    .join("\n"),
                )
                .then(() => toast.success(`Copied ${n} links`))
            }
          >
            <Copy size={12} /> Copy links
          </button>
          <button
            type="button"
            className={actionClass}
            disabled={!n}
            onClick={() => exportMarkdown(targets)}
          >
            <Download size={12} /> Export .md
          </button>
          <BarToggle
            on={sel.selectedFirst}
            onClick={() => sel.setSelectedFirst(!sel.selectedFirst)}
            label="Selected first"
            title="Selected posts first, newest first; the rest after"
          />
          <button
            type="button"
            onClick={sel.clear}
            className={cn(actionClass, "ml-auto")}
          >
            <X size={12} /> Clear
          </button>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// What A-plus-menu and A-plus-select put in the filter bar.

export type FilterBarOverride = {
  /** Each replaces its pill; null removes it. */
  views?: ReactNode
  order?: ReactNode
  type?: ReactNode
  media?: ReactNode
  language?: ReactNode
  /** A row under the pills. */
  extraRow?: ReactNode
  /** The footer's own filter chips, which the filter row replaces. */
  hideChips?: boolean
  /** The whole footer; A-plus-select shows its one unique number elsewhere. */
  hideFooter?: boolean
}

export function useFilterBarOverride(counts: {
  before: number
  shown: number
}): FilterBarOverride | undefined {
  const variant = useCardVariant()
  if (variant === "A-plus-menu")
    return { views: <ViewsFiltersMenu />, order: <PostSortMenu /> }
  if (variant === "A-plus-select")
    return {
      views: <NumbersMenu />,
      order: <PostSortMenu />,
      type: <TypeFacet />,
      media: <MediaFacet />,
      language: <LanguageFacet />,
      extraRow: <PostFilterRow {...counts} />,
      hideChips: true,
      hideFooter: true,
    }
  return undefined
}
