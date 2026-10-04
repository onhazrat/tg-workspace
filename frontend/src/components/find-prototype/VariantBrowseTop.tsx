// PROTOTYPE (find-prototype): variant E, "Filter bar". Every column of the
// Directory, the reference graph and full-text search, filtered from a bar on
// top. Borrowed from the Channels and Posts tabs: facet buttons with a count
// badge, searchable facet menus with per-value counts and an "only" funnel,
// one "Filters" list of every criterion whose editor draws the metric's
// distribution and previews how many Channels a bound keeps, a sort picker
// with a direction toggle, and chips that reopen their editor.

import { useQueryClient } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Ban,
  Check as CheckIcon,
  ChevronDown,
  Columns3,
  EyeOff,
  Filter,
  ListFilter,
  Search,
  Undo2,
  X,
} from "lucide-react"
import {
  Fragment,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"
import { TgConfirmDialog } from "@/components/ui/tg-confirm-dialog"
import { useData } from "@/contexts/DataContext"
import { BULK_FOLLOW_CONFIRM_THRESHOLD } from "@/lib/posts/discover-selection"
import {
  Avatar,
  ago,
  type Entry,
  FollowButton,
  FollowCtx,
  fmt,
  Highlight,
  PostText,
  protoPost,
  SampleList,
  Stats,
  TelegramLink,
  usePersistentState,
  useProto,
} from "./shared"

// --- the filter model ----------------------------------------------------------

type Mode = "atLeast" | "atMost" | "between" | "none"
type Bound = {
  metric: string
  mode: Mode
  min: number | null
  max: number | null
  negate: boolean
}

type Filters = {
  q: string
  q_in: string[]
  name_like: string
  langs: string[]
  langs_not: string[]
  bounds: Bound[]
  cited_by: string[]
  cites: string[]
  ref_kinds: string[]
  use_selection: boolean
  has_photo: boolean
  hide_followed: boolean
  include_unavailable: boolean
  sort: string
  desc: boolean
  offset: number
  /** Quote the matching Post and bio under each row while searching. */
  snippets: boolean
  /**
   * Variant C's two signals, kept apart: "Shared parents" (channels citing your
   * picks also cite it) and "Shared children" (it cites what your picks cite).
   */
  parents: Picks | null
  children: Picks | null
  /** "Mentioned by your channels" (variant B folded in): the window in days. */
  mentioned_days: number | null
  /** The Channels marked "Not interested": hidden, shown dimmed, or only them. */
  dismissed: "hide" | "show" | "only"
}

const EMPTY: Filters = {
  q: "",
  q_in: ["name", "bio", "posts"],
  name_like: "",
  langs: [],
  langs_not: [],
  bounds: [],
  cited_by: [],
  cites: [],
  ref_kinds: [],
  use_selection: false,
  has_photo: false,
  hide_followed: true,
  include_unavailable: false,
  sort: "subscribers",
  desc: true,
  offset: 0,
  snippets: true,
  parents: null,
  children: null,
  mentioned_days: null,
  dismissed: "hide",
}

/**
 * The Channels a relation is measured against, and how many shared relatives
 * a candidate needs. "selection" and "follows" resolve at request time, so they
 * track the Channels tab.
 */
type Picks = {
  source: "handles" | "selection" | "follows"
  handles: string[]
  min: number
}
type Relation = "parents" | "children"

type Metric = {
  key: string
  label: string
  unit?: "days" | "pct"
  hint?: string
}

const METRIC_SECTIONS: { heading: string; metrics: Metric[] }[] = [
  {
    heading: "Size and activity",
    metrics: [
      { key: "subscribers", label: "Subscribers" },
      { key: "reach", label: "Reach", hint: "average views per post" },
      { key: "posts_per_week", label: "Posts per week" },
      { key: "forward_pct", label: "Forwarded posts", unit: "pct" },
      { key: "last_post_days", label: "Days since last post", unit: "days" },
      {
        key: "found_days",
        label: "Days since the Directory found it",
        unit: "days",
      },
    ],
  },
  {
    heading: "Content",
    metrics: [
      { key: "photos", label: "Photos" },
      { key: "videos", label: "Videos" },
      { key: "files", label: "Files" },
      { key: "links", label: "Links" },
      { key: "samples", label: "Sample posts stored" },
    ],
  },
  {
    heading: "References",
    metrics: [
      {
        key: "indeg",
        label: "Cited by (channels)",
        hint: "distinct channels citing it",
      },
      {
        key: "outdeg",
        label: "Cites (channels)",
        hint: "distinct channels it cites",
      },
      {
        key: "mine",
        label: "Cited by your channels",
        hint: "follows, or your selection (Scope)",
      },
      {
        key: "mine_last_days",
        label: "Days since your channels last mentioned it",
        unit: "days",
      },
      {
        key: "shared_parents",
        label: "Shared parents (weighted)",
        hint: "while Shared parents is on",
      },
      {
        key: "shared_children",
        label: "Shared children (weighted)",
        hint: "while Shared children is on",
      },
    ],
  },
]
const METRICS = METRIC_SECTIONS.flatMap((s) => s.metrics)
const metricOf = (key: string) =>
  METRICS.find((m) => m.key === key) ?? { key, label: key }

const SORTS = [
  { key: "relevance", label: "Relevance" },
  ...METRICS.map((m) => ({ key: m.key, label: m.label })),
  { key: "handle", label: "Handle" },
]

const KINDS = ["forward", "mention", "link", "reply"]

function fmtValue(m: Metric, v: number | null) {
  if (v == null) return "?"
  if (m.unit === "days") return `${v < 10 ? v.toFixed(1) : Math.round(v)}d`
  if (m.unit === "pct") return `${Math.round(v)}%`
  return v < 10 && !Number.isInteger(v) ? v.toFixed(1) : fmt(Math.round(v))
}

function boundText(b: Bound) {
  const m = metricOf(b.metric)
  const body =
    b.mode === "none"
      ? "no value"
      : b.mode === "atLeast"
        ? `≥ ${fmtValue(m, b.min)}`
        : b.mode === "atMost"
          ? `≤ ${fmtValue(m, b.max)}`
          : `${fmtValue(m, b.min)}–${fmtValue(m, b.max)}`
  return `${b.negate ? "not " : ""}${m.label} ${body}`
}

// --- state ---------------------------------------------------------------------

type Row = Entry & {
  forward_share: number | null
  photos: number | null
  videos: number | null
  files: number | null
  links: number | null
  reach_estimated: boolean
  first_seen: string
  indeg: number
  outdeg: number
  mine: number
  /** Marked "Not interested" by this account. */
  dismissed?: boolean
  /** When your channels last pointed at it, ms; inside the mention window. */
  mine_last_at?: number | null
  /** Only while Shared parents / children is on: the count, a few of them, the weighted score. */
  parents_n?: number | null
  parents_via?: string[] | null
  parents_score?: number | null
  children_n?: number | null
  children_via?: string[] | null
  children_score?: number | null
  /** Only while searching: the newest matching sample Post and the bio, «highlighted». */
  match?: { post_id: number; timestamp: number; snippet: string } | null
  bio_hl?: string | null
}

const PAGE = 100

const workspaceRoute = getRouteApi("/_tg/workspace")

/**
 * Only what differs from the defaults, so a shared URL stays short, and only
 * keys the filters still have: an older stored state can carry dropped ones.
 */
function encodeFilters(f: Filters): Record<string, unknown> | undefined {
  const diff = Object.fromEntries(
    (Object.keys(EMPTY) as (keyof Filters)[])
      .filter((k) => JSON.stringify(f[k]) !== JSON.stringify(EMPTY[k]))
      .map((k) => [k, f[k]]),
  )
  return Object.keys(diff).length ? diff : undefined
}

/**
 * The filters live in the URL (`?find=`), so a view can be shared and
 * bookmarked. The last one is also kept in this browser, and a Find tab opened
 * without `find` adopts it and writes it back to the address bar.
 */
function useUrlFilters() {
  const { find } = workspaceRoute.useSearch()
  const navigate = workspaceRoute.useNavigate()
  const [stored, setStored] = usePersistentState<Filters>("E.filters", EMPTY)
  const f = useMemo<Filters>(
    () => (find ? { ...EMPTY, ...(find as Partial<Filters>) } : stored),
    [find, stored],
  )
  // Several patches can land before the URL round trip re-renders, so each
  // builds on the last one written rather than on a stale render.
  const latest = useRef(f)
  latest.current = f
  const write = useCallback(
    (value: Filters) => {
      latest.current = value
      setStored(value)
      navigate({
        search: (prev) => ({ ...prev, find: encodeFilters(value) }),
        replace: true,
      })
    },
    [navigate, setStored],
  )
  // On arrival only: an address without `find` gets the remembered view.
  useEffect(() => {
    if (!find && encodeFilters(stored)) write(stored)
  }, [])
  const setF = useCallback(
    (next: Filters | ((prev: Filters) => Filters)) =>
      write(typeof next === "function" ? next(latest.current) : next),
    [write],
  )
  return [f, setF] as const
}

function useFilters() {
  const { selectedChannels, channels } = useData()
  const [f, setF] = useUrlFilters()
  // Columns the viewer switched off; not a filter, so "clear filters" keeps it.
  const [hiddenCols, setHiddenCols] = usePersistentState<string[]>(
    "E.hiddenColumns",
    [],
  )
  const [debounced, setDebounced] = useState(f)
  const queryClient = useQueryClient()
  useEffect(() => {
    // Clearing the search box applies at once and drops the search in flight,
    // rather than waiting out the debounce behind a result nobody wants.
    if (!f.q && debounced.q) {
      queryClient.cancelQueries({ queryKey: ["proto", "/browse"] })
      setDebounced(f)
      return
    }
    const t = setTimeout(() => setDebounced(f), 300)
    return () => clearTimeout(t)
  }, [f, debounced.q, queryClient])
  const toBody = useMemo(
    () => (x: Filters) => {
      // similar_* are the single "Similar to" this replaced; a stored state
      // may still carry them, so they are dropped rather than sent.
      const {
        use_selection,
        parents,
        children,
        similar_source: _oldSource,
        similar_to: _oldTo,
        ...rest
      } = x as Filters & { similar_source?: unknown; similar_to?: unknown }
      const resolve = (pk: Picks | null) =>
        (!pk
          ? []
          : pk.source === "selection"
            ? [...selectedChannels]
            : pk.source === "follows"
              ? channels.map((c) => c.name)
              : pk.handles
        )
          .map((h) => h.toLowerCase())
          .sort()
      return {
        ...rest,
        parents_of: resolve(parents),
        parents_min: parents?.min ?? 2,
        children_of: resolve(children),
        children_min: children?.min ?? 2,
        sources: use_selection ? [...selectedChannels].sort() : [],
        limit: PAGE,
      }
    },
    [selectedChannels, channels],
  )
  // The Channels whose Posts count as "yours": the selection, or every follow.
  const mentionSources = useMemo(
    () =>
      (f.use_selection
        ? [...selectedChannels]
        : channels.map((c) => c.name)
      ).sort(),
    [f.use_selection, selectedChannels, channels],
  )
  const res = useProto<{
    rows: Row[]
    total: number
    langs: { language: string; n: number }[]
    ms: number
  }>("/browse", true, toBody(debounced))
  const set = (patch: Partial<Filters>) =>
    setF((prev) => ({ ...prev, offset: 0, ...patch }))
  const reload = () => {
    queryClient.invalidateQueries({ queryKey: ["proto", "/browse"] })
    queryClient.invalidateQueries({ queryKey: ["proto", "/histogram"] })
  }
  /** Mark (or unmark) "Not interested"; the toast offers the way back. */
  const setDismissed = async (handle: string, on: boolean) => {
    try {
      await protoPost(`/dismiss/${handle}`, on ? "POST" : "DELETE")
    } catch (err) {
      toast.error(`Could not update @${handle}: ${String(err)}`)
      return
    }
    reload()
    if (on)
      toast(`Hid @${handle}`, {
        description: "Not interested. Scope shows it again.",
        duration: 10_000,
        action: { label: "Undo", onClick: () => setDismissed(handle, false) },
      })
  }
  /** "Not interested" for many at once, with one Undo for the lot. */
  const setDismissedMany = async (handles: string[], on: boolean) => {
    const method = on ? "POST" : "DELETE"
    const results = await Promise.allSettled(
      handles.map((h) => protoPost(`/dismiss/${h}`, method)),
    )
    const failed = results.filter((r) => r.status === "rejected").length
    reload()
    if (failed) toast.error(`Could not update ${failed} of ${handles.length}`)
    if (on && failed < handles.length)
      toast(`Hid ${handles.length - failed} channels`, {
        description: "Not interested. Scope shows them again.",
        duration: 10_000,
        action: {
          label: "Undo",
          onClick: () => setDismissedMany(handles, false),
        },
      })
  }
  const putBound = (b: Bound) =>
    set({ bounds: [...f.bounds.filter((x) => x.metric !== b.metric), b] })
  return {
    f,
    setF,
    set,
    putBound,
    setDismissed,
    setDismissedMany,
    hiddenCols,
    setHiddenCols,
    res,
    toBody,
    selectedCount: selectedChannels.size,
    followCount: channels.length,
    mentionSources,
  }
}
type State = ReturnType<typeof useFilters>

// --- the variant ---------------------------------------------------------------

export function VariantBrowseTop() {
  const s = useFilters()
  const { f, set, res } = s
  const [menu, setMenu] = useState<string | null>(null)
  // Which criterion the Filters popover opens on: a chip click jumps straight to it.
  const [editing, setEditing] = useState<string | null>(null)
  const [open, setOpen] = usePersistentState<string | null>("E.open", null)
  // Picked for a bulk action; kept across pages and filter changes, like
  // Discover's selection, and cleared by the bar.
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const openFilters = (start: string | null) => {
    setEditing(start)
    setMenu("filters")
  }
  const close = () => setMenu(null)

  return (
    <div className="pt-4">
      <div className="space-y-2 rounded-xl border border-app-ink/10 bg-app-card/40 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-72 flex-1">
            <Search
              size={16}
              className="absolute top-1/2 left-3 -translate-y-1/2 text-app-ink/40"
            />
            <input
              dir="auto"
              value={f.q}
              onChange={(e) =>
                set({
                  q: e.target.value,
                  sort: e.target.value
                    ? "relevance"
                    : f.sort === "relevance"
                      ? "subscribers"
                      : f.sort,
                })
              }
              placeholder="Search words in names, bios and posts"
              className="w-full rounded-lg border border-app-ink/20 bg-app-card py-2 pr-3 pl-9 text-sm outline-none focus:border-app-ink/60"
            />
          </label>
          <div className="flex items-center gap-1 text-xs">
            <span className="text-app-ink/50">in</span>
            {(["name", "bio", "posts"] as const).map((w) => (
              <TogglePill
                key={w}
                on={f.q_in.includes(w)}
                onClick={() =>
                  set({
                    q_in: f.q_in.includes(w)
                      ? f.q_in.filter((x) => x !== w)
                      : [...f.q_in, w],
                  })
                }
              >
                {w}
              </TogglePill>
            ))}
          </div>
          <label
            className="flex items-center gap-1.5 text-xs text-app-ink/70"
            title="Quote the matching post and bio under each result while searching"
          >
            <input
              type="checkbox"
              checked={f.snippets}
              onChange={(e) => s.setF({ ...f, snippets: e.target.checked })}
            />
            show matches
          </label>
          <input
            dir="auto"
            value={f.name_like}
            onChange={(e) => set({ name_like: e.target.value })}
            placeholder="handle or name contains"
            className="w-48 rounded-lg border border-app-ink/20 bg-app-card px-3 py-2 text-xs outline-none focus:border-app-ink/60"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <BarButton
            label="Language"
            count={f.langs.length + f.langs_not.length}
            open={menu === "lang"}
            onClick={() => setMenu(menu === "lang" ? null : "lang")}
          >
            <LanguageMenu s={s} />
          </BarButton>
          <BarButton
            label="Reference kinds"
            count={f.ref_kinds.length}
            open={menu === "kinds"}
            onClick={() => setMenu(menu === "kinds" ? null : "kinds")}
          >
            <KindsMenu s={s} />
          </BarButton>
          <BarButton
            label="Filters"
            icon={<ListFilter size={12} />}
            count={
              f.bounds.length +
              f.cited_by.length +
              f.cites.length +
              (f.parents ? 1 : 0) +
              (f.children ? 1 : 0) +
              (f.mentioned_days ? 1 : 0)
            }
            open={menu === "filters"}
            onClick={() => (menu === "filters" ? close() : openFilters(null))}
            width="w-[380px]"
          >
            <FiltersMenu s={s} start={editing} onDone={close} />
          </BarButton>
          <BarButton
            label="Scope"
            count={
              [
                f.use_selection,
                f.has_photo,
                !f.hide_followed,
                f.include_unavailable,
                f.dismissed !== "hide",
              ].filter(Boolean).length
            }
            open={menu === "scope"}
            onClick={() => setMenu(menu === "scope" ? null : "scope")}
          >
            <ScopeMenu s={s} />
          </BarButton>
          <span className="mx-1 h-5 w-px bg-app-ink/15" />
          <SortPicker s={s} />
          <BarButton
            label="Columns"
            icon={<Columns3 size={12} />}
            count={s.hiddenCols.length}
            open={menu === "columns"}
            onClick={() => setMenu(menu === "columns" ? null : "columns")}
            width="w-80"
            alignRight
          >
            <ColumnsMenu s={s} />
          </BarButton>
          <span className="ml-auto font-mono text-[11px] text-app-ink/50">
            <b className="text-sm text-app-ink">
              {res.data ? res.data.total.toLocaleString() : "…"}
            </b>{" "}
            channels · {res.isFetching ? "loading…" : `${res.data?.ms ?? 0} ms`}
          </span>
        </div>

        <ChipRow s={s} onEdit={openFilters} />
        {res.error && (
          <p className="text-xs text-red-500">{String(res.error)}</p>
        )}
      </div>

      <div className="mt-3">
        <BulkBar s={s} picked={picked} setPicked={setPicked} />
        <ResultsTable
          s={s}
          open={open}
          setOpen={setOpen}
          picked={picked}
          setPicked={setPicked}
        />
      </div>
      {open && (
        <Drawer
          row={res.data?.rows.find((r) => r.handle === open)}
          handle={open}
          s={s}
          onClose={() => setOpen(null)}
          onFilter={(patch) => {
            set(patch)
            setOpen(null)
          }}
        />
      )}
    </div>
  )
}

// --- bar pieces ----------------------------------------------------------------

function BarButton({
  label,
  icon,
  count,
  open,
  onClick,
  width = "w-72",
  alignRight = false,
  children,
}: {
  label: string
  icon?: ReactNode
  count: number
  open: boolean
  onClick: () => void
  width?: string
  /** Open the panel leftward, for a button near the right edge. */
  alignRight?: boolean
  children: ReactNode
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${count ? "border-app-ink/60 bg-app-ink/10 font-semibold" : "border-app-ink/20 hover:bg-app-ink/5"}`}
      >
        {icon}
        {label}
        {count > 0 && (
          <span className="rounded-full bg-app-ink px-1.5 text-[10px] text-app-bg">
            {count}
          </span>
        )}
        <ChevronDown size={12} className={open ? "rotate-180" : ""} />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close"
            onClick={onClick}
            className="fixed inset-0 z-20 cursor-default"
          />
          <div
            className={`absolute top-full ${alignRight ? "right-0" : "left-0"} z-30 mt-1 ${width} rounded-lg border border-app-ink/15 bg-app-bg p-2 text-xs shadow-2xl`}
          >
            {children}
          </div>
        </>
      )}
    </div>
  )
}

function MenuSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: a menu opens on its search box
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="mb-1.5 w-full rounded border border-app-ink/20 bg-app-card px-2 py-1 outline-none focus:border-app-ink/60"
    />
  )
}

function LanguageMenu({ s }: { s: State }) {
  const { f, set, res } = s
  const [query, setQuery] = useState("")
  const langs = (res.data?.langs ?? []).filter((l) =>
    l.language.includes(query.trim().toLowerCase()),
  )
  const flip = (code: string) =>
    set({
      langs: f.langs.includes(code)
        ? f.langs.filter((x) => x !== code)
        : [...f.langs, code],
      langs_not: f.langs_not.filter((x) => x !== code),
    })
  const exclude = (code: string) =>
    set({
      langs_not: f.langs_not.includes(code)
        ? f.langs_not.filter((x) => x !== code)
        : [...f.langs_not, code],
      langs: f.langs.filter((x) => x !== code),
    })
  return (
    <>
      <MenuSearch
        value={query}
        onChange={setQuery}
        placeholder="Search languages…"
      />
      <p className="mb-1 flex justify-between px-1 text-[10px] text-app-ink/40">
        <span>Tick includes, ⊘ excludes, funnel shows only it</span>
        <span>channels</span>
      </p>
      <ul className="max-h-72 overflow-y-auto">
        {langs.map((l) => {
          const on = f.langs.includes(l.language)
          const off = f.langs_not.includes(l.language)
          return (
            <li
              key={l.language}
              className="group flex items-center gap-1.5 rounded px-1 py-1 hover:bg-app-ink/5"
            >
              <button
                type="button"
                onClick={() => flip(l.language)}
                className="flex flex-1 items-center gap-2 text-left"
              >
                <span
                  className={`flex size-3.5 items-center justify-center rounded-sm border ${on ? "border-app-ink bg-app-ink text-app-bg" : "border-app-ink/30"}`}
                >
                  {on && <CheckIcon size={10} />}
                </span>
                <span
                  className={`font-semibold ${off ? "line-through opacity-50" : ""}`}
                >
                  {languageLabel(l.language)}
                </span>
                <span className="font-mono text-app-ink/40">{l.language}</span>
              </button>
              <span className="font-mono text-[10px] text-app-ink/50">
                {fmt(l.n)}
              </span>
              <button
                type="button"
                title="Exclude"
                onClick={() => exclude(l.language)}
                className={`rounded p-0.5 ${off ? "text-red-500" : "text-app-ink/30 hover:text-app-ink"}`}
              >
                <Ban size={11} />
              </button>
              <button
                type="button"
                title="Only this"
                onClick={() => set({ langs: [l.language], langs_not: [] })}
                className="rounded p-0.5 text-app-ink/30 hover:text-app-ink"
              >
                <Filter size={11} />
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}

function languageLabel(code: string) {
  if (code === "?") return "Unknown"
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code
  } catch {
    return code
  }
}

function KindsMenu({ s }: { s: State }) {
  const { f, set } = s
  return (
    <>
      <p className="mb-1.5 px-1 text-[10px] text-app-ink/40">
        Narrows "Cited by", "Cites", "Cited by your channels" and the handle
        filters. None ticked counts every kind.
      </p>
      {KINDS.map((k) => (
        <label
          key={k}
          className="flex items-center gap-2 rounded px-1 py-1 hover:bg-app-ink/5"
        >
          <input
            type="checkbox"
            checked={f.ref_kinds.includes(k)}
            onChange={() =>
              set({
                ref_kinds: f.ref_kinds.includes(k)
                  ? f.ref_kinds.filter((x) => x !== k)
                  : [...f.ref_kinds, k],
              })
            }
          />
          <span className="font-semibold capitalize">{k}</span>
        </label>
      ))}
    </>
  )
}

function ScopeMenu({ s }: { s: State }) {
  const { f, set, selectedCount } = s
  const row = (on: boolean, label: string, patch: Partial<Filters>) => (
    <label className="flex items-center gap-2 rounded px-1 py-1 hover:bg-app-ink/5">
      <input type="checkbox" checked={on} onChange={() => set(patch)} />
      {label}
    </label>
  )
  return (
    <>
      {row(f.hide_followed, "Hide channels I follow", {
        hide_followed: !f.hide_followed,
      })}
      {row(f.include_unavailable, "Include unavailable channels", {
        include_unavailable: !f.include_unavailable,
      })}
      {row(f.has_photo, "Has a profile photo", { has_photo: !f.has_photo })}
      {row(
        f.use_selection,
        `"Your channels" means my ${selectedCount} selected, not every follow`,
        {
          use_selection: !f.use_selection,
        },
      )}
      <p className="mt-2 px-1 text-[10px] font-semibold tracking-widest text-app-ink/40 uppercase">
        Not interested
      </p>
      {(
        [
          ["hide", "Hide them"],
          ["show", "Show them, dimmed"],
          ["only", "Only them"],
        ] as const
      ).map(([value, label]) => (
        <label
          key={value}
          className="flex items-center gap-2 rounded px-1 py-1 hover:bg-app-ink/5"
        >
          <input
            type="radio"
            name="dismissed"
            checked={f.dismissed === value}
            onChange={() => set({ dismissed: value })}
          />
          {label}
        </label>
      ))}
    </>
  )
}

function SortPicker({ s }: { s: State }) {
  const { f, set } = s
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-app-ink/50">Sort</span>
      <select
        value={f.sort}
        onChange={(e) => set({ sort: e.target.value })}
        className="rounded-full border border-app-ink/20 bg-app-card px-2 py-1 font-semibold"
      >
        {SORTS.filter(
          (o) =>
            (o.key !== "relevance" || f.q) &&
            (o.key !== "shared_parents" || f.parents) &&
            (o.key !== "shared_children" || f.children),
        ).map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        title={f.desc ? "Descending" : "Ascending"}
        onClick={() => set({ desc: !f.desc })}
        className="rounded-full border border-app-ink/20 p-1 hover:bg-app-ink/5"
      >
        {f.desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
      </button>
    </div>
  )
}

// --- the Filters menu: pick a criterion, then edit it ----------------------------

function FiltersMenu({
  s,
  start,
  onDone,
}: {
  s: State
  start: string | null
  onDone: () => void
}) {
  const [step, setStep] = useState<string | null>(start)
  const [query, setQuery] = useState("")
  useEffect(() => setStep(start), [start])
  if (step === "parents" || step === "children")
    return (
      <RelationEditor
        s={s}
        relation={step}
        onBack={() => setStep(null)}
        onDone={onDone}
      />
    )
  if (step === "mentioned")
    return <MentionEditor s={s} onBack={() => setStep(null)} onDone={onDone} />
  if (step === "cited_by" || step === "cites")
    return (
      <HandleEditor
        s={s}
        side={step}
        onBack={() => setStep(null)}
        onDone={onDone}
      />
    )
  if (step)
    return (
      <BoundEditor
        s={s}
        metric={metricOf(step)}
        onBack={() => setStep(null)}
        onDone={onDone}
      />
    )
  const match = (t: string) =>
    t.toLowerCase().includes(query.trim().toLowerCase())
  const item = (key: string, label: string, hint?: string) => {
    const on =
      s.f.bounds.some((b) => b.metric === key) ||
      (key === "cited_by" && s.f.cited_by.length) ||
      (key === "cites" && s.f.cites.length) ||
      (key === "parents" && s.f.parents) ||
      (key === "children" && s.f.children) ||
      (key === "mentioned" && s.f.mentioned_days)
    return (
      <button
        type="button"
        key={key}
        onClick={() => setStep(key)}
        className="flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left hover:bg-app-ink/5"
      >
        <span className="font-semibold">{label}</span>
        {hint && (
          <span className="truncate text-[10px] text-app-ink/40">{hint}</span>
        )}
        {on ? (
          <span className="ml-auto text-[10px] text-emerald-600">on</span>
        ) : null}
      </button>
    )
  }
  return (
    <>
      <MenuSearch
        value={query}
        onChange={setQuery}
        placeholder="Search criteria…"
      />
      <div className="max-h-96 overflow-y-auto">
        {METRIC_SECTIONS.map((sec) => {
          // A weighted score only exists while its criterion is on.
          const items = sec.metrics.filter(
            (m) =>
              match(m.label) &&
              (m.key !== "shared_parents" || s.f.parents) &&
              (m.key !== "shared_children" || s.f.children),
          )
          const handles =
            sec.heading === "References"
              ? [
                  [
                    "parents",
                    "Shared parents with…",
                    "cited by the channels that cite your picks",
                  ],
                  [
                    "children",
                    "Shared children with…",
                    "cites the channels your picks cite",
                  ],
                  [
                    "mentioned",
                    "Mentioned by your channels…",
                    "in the last N days",
                  ],
                  [
                    "cited_by",
                    "Cited by @handle",
                    "channels a given channel cites",
                  ],
                  ["cites", "Cites @handle", "channels citing a given channel"],
                ].filter(([, l]) => match(l))
              : []
          if (!items.length && !handles.length) return null
          return (
            <div key={sec.heading} className="mb-1">
              <p className="px-2 pt-1 text-[10px] font-semibold tracking-widest text-app-ink/40 uppercase">
                {sec.heading}
              </p>
              {items.map((m) => item(m.key, m.label, m.hint))}
              {handles.map(([k, l, h]) => item(k, l, h))}
            </div>
          )
        })}
      </div>
    </>
  )
}

type Histogram = {
  total: number
  measured: number
  lo: number | null
  hi: number | null
  median: number | null
  scale: "log" | "linear"
  bins: { lo: number; hi: number; n: number }[]
}

function BoundEditor({
  s,
  metric,
  onBack,
  onDone,
}: {
  s: State
  metric: Metric
  onBack: () => void
  onDone: () => void
}) {
  const existing = s.f.bounds.find((b) => b.metric === metric.key)
  const [b, setB] = useState<Bound>(
    existing ?? {
      metric: metric.key,
      mode: metric.unit === "days" ? "atMost" : "atLeast",
      min: null,
      max: null,
      negate: false,
    },
  )
  const others = {
    ...s.f,
    bounds: s.f.bounds.filter((x) => x.metric !== metric.key),
  }
  const hist = useProto<Histogram>("/histogram", false, {
    filters: s.toBody(others),
    metric: metric.key,
  })
  const candidate = {
    ...others,
    bounds: [...others.bounds, b],
    count_only: true,
  }
  const [debounced, setDebounced] = useState(candidate)
  const key = JSON.stringify(candidate)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(candidate), 250)
    return () => clearTimeout(t)
  }, [key])
  const preview = useProto<{ total: number }>("/browse", true, {
    ...s.toBody(debounced),
    count_only: true,
  })
  const ready =
    b.mode === "none" ||
    (b.mode === "atLeast"
      ? b.min != null
      : b.mode === "atMost"
        ? b.max != null
        : b.min != null && b.max != null)
  const inBound = (v: number) =>
    b.mode === "atLeast"
      ? b.min != null && v >= b.min
      : b.mode === "atMost"
        ? b.max != null && v <= b.max
        : b.mode === "between"
          ? b.min != null && b.max != null && v >= b.min && v <= b.max
          : false
  const h = hist.data
  const peak = Math.max(1, ...(h?.bins.map((x) => x.n) ?? [1]))

  return (
    <div className="space-y-2 p-1">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 font-semibold"
      >
        <ArrowLeft size={12} /> {metric.label}
      </button>
      <div className="rounded bg-app-ink/5 p-2">
        <div className="flex h-16 items-end gap-px">
          {h?.bins.map((bin) => {
            const mid = (bin.lo + bin.hi) / 2
            return (
              <button
                type="button"
                key={bin.lo}
                title={`${fmtValue(metric, bin.lo)}–${fmtValue(metric, bin.hi)}: ${bin.n.toLocaleString()}`}
                onClick={() =>
                  setB({
                    ...b,
                    mode: b.mode === "none" ? "atLeast" : b.mode,
                    min: b.mode === "atMost" ? b.min : Math.floor(bin.lo),
                    max: b.mode === "atLeast" ? b.max : Math.ceil(bin.hi),
                  })
                }
                style={{
                  height: `${Math.max(3, Math.sqrt(bin.n / peak) * 100)}%`,
                }}
                className={`flex-1 rounded-t-sm ${ready && b.mode !== "none" && inBound(mid) !== b.negate ? "bg-fuchsia-500" : "bg-app-ink/30 hover:bg-app-ink/50"}`}
              />
            )
          })}
          {hist.isLoading && (
            <span className="m-auto text-[10px] text-app-ink/40">
              loading distribution…
            </span>
          )}
        </div>
        {h && (
          <div className="mt-1 flex justify-between font-mono text-[10px] text-app-ink/50">
            <span>{fmtValue(metric, h.lo)}</span>
            <span>
              median {fmtValue(metric, h.median)}
              {h.scale === "log" ? ", log scale" : ""}
            </span>
            <span>{fmtValue(metric, h.hi)}</span>
          </div>
        )}
      </div>
      <div className="grid grid-cols-4 gap-1">
        {(
          [
            ["atLeast", "at least"],
            ["atMost", "at most"],
            ["between", "between"],
            ["none", "no value"],
          ] as const
        ).map(([mode, label]) => (
          <button
            type="button"
            key={mode}
            onClick={() => setB({ ...b, mode })}
            className={`rounded px-1 py-1 ${b.mode === mode ? "bg-app-ink font-semibold text-app-bg" : "bg-app-ink/5 hover:bg-app-ink/10"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {b.mode !== "none" && (
        <div className="flex items-center gap-1.5">
          {b.mode !== "atMost" && (
            <NumberField
              value={b.min}
              placeholder={b.mode === "between" ? "from" : "value"}
              onChange={(min) => setB({ ...b, min })}
            />
          )}
          {b.mode === "between" && "–"}
          {b.mode !== "atLeast" && (
            <NumberField
              value={b.max}
              placeholder={b.mode === "between" ? "to" : "value"}
              onChange={(max) => setB({ ...b, max })}
            />
          )}
          <span className="text-app-ink/40">
            {metric.unit === "days" ? "days" : metric.unit === "pct" ? "%" : ""}
          </span>
        </div>
      )}
      {metric.unit === "days" && b.mode !== "none" && (
        <div className="flex gap-1">
          {[1, 7, 30, 90, 365].map((d) => (
            <button
              type="button"
              key={d}
              onClick={() =>
                setB(
                  b.mode === "atLeast"
                    ? { ...b, min: d }
                    : {
                        ...b,
                        mode: b.mode === "between" ? "atMost" : b.mode,
                        max: d,
                      },
                )
              }
              className="rounded-full bg-app-ink/5 px-2 py-0.5 font-mono hover:bg-app-ink/10"
            >
              {d}d
            </button>
          ))}
        </div>
      )}
      <label className="flex items-center gap-1.5 text-app-ink/70">
        <input
          type="checkbox"
          checked={b.negate}
          onChange={(e) => setB({ ...b, negate: e.target.checked })}
        />
        exclude the matches instead
      </label>
      {h && h.measured < h.total && b.mode !== "none" && (
        <p className="text-[10px] text-app-ink/40">
          {(h.total - h.measured).toLocaleString()} channels have no value and
          fail every bound. Choose "no value" to find them.
        </p>
      )}
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={!ready}
          onClick={() => {
            s.putBound(b)
            onDone()
          }}
          className="flex-1 rounded bg-app-ink/90 px-2 py-1.5 font-semibold text-app-bg disabled:opacity-40"
        >
          {existing ? "Update" : "Add"}
          {ready && preview.data
            ? ` · ${preview.data.total.toLocaleString()} channels`
            : ""}
          {ready && preview.isFetching ? " …" : ""}
        </button>
        {existing && (
          <button
            type="button"
            onClick={() => {
              s.set({
                bounds: s.f.bounds.filter((x) => x.metric !== metric.key),
              })
              onDone()
            }}
            className="rounded border border-app-ink/20 px-2 py-1.5 hover:bg-app-ink/5"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  )
}

function HandleEditor({
  s,
  side,
  onBack,
  onDone,
}: {
  s: State
  side: "cited_by" | "cites"
  onBack: () => void
  onDone: () => void
}) {
  const [text, setText] = useState(s.f[side].map((h) => `@${h}`).join(", "))
  const handles = text
    .split(/[\s,]+/)
    .map((h) => h.replace(/^@/, "").trim().toLowerCase())
    .filter(Boolean)
  return (
    <div className="space-y-2 p-1">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 font-semibold"
      >
        <ArrowLeft size={12} />{" "}
        {side === "cited_by" ? "Cited by @handle" : "Cites @handle"}
      </button>
      <p className="text-[10px] text-app-ink/50">
        {side === "cited_by"
          ? "Channels that any of these channels forwarded, mentioned, linked or replied to."
          : "Channels that forwarded, mentioned, linked or replied to any of these."}{" "}
        Reference kinds narrow it.
      </p>
      <input
        // biome-ignore lint/a11y/noAutofocus: the editor is this one field
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="@one, @two"
        className="w-full rounded border border-app-ink/20 bg-app-card px-2 py-1 font-mono outline-none focus:border-app-ink/60"
      />
      <button
        type="button"
        onClick={() => {
          s.set({ [side]: handles })
          onDone()
        }}
        className="w-full rounded bg-app-ink/90 px-2 py-1.5 font-semibold text-app-bg"
      >
        {handles.length
          ? `Apply ${handles.length} handle${handles.length > 1 ? "s" : ""}`
          : "Clear"}
      </button>
    </div>
  )
}

function NumberField({
  value,
  placeholder,
  onChange,
}: {
  value: number | null
  placeholder: string
  onChange: (v: number | null) => void
}) {
  return (
    <input
      inputMode="decimal"
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => {
        const v = e.target.value.trim()
        onChange(v === "" || Number.isNaN(Number(v)) ? null : Number(v))
      }}
      className="w-full rounded border border-app-ink/20 bg-app-card px-2 py-1 font-mono outline-none focus:border-app-ink/60"
    />
  )
}

function TogglePill({
  on,
  onClick,
  children,
}: {
  on: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2 py-1 font-mono ${on ? "bg-app-ink text-app-bg" : "bg-app-ink/5 hover:bg-app-ink/10"}`}
    >
      {children}
    </button>
  )
}

// --- chips -----------------------------------------------------------------------

function ChipRow({ s, onEdit }: { s: State; onEdit: (key: string) => void }) {
  const { f, set, setF } = s
  const chips: {
    key: string
    label: string
    edit?: () => void
    clear: () => void
  }[] = []
  if (f.langs.length)
    chips.push({
      key: "langs",
      label: `language ${f.langs.join(", ")}`,
      clear: () => set({ langs: [] }),
    })
  if (f.langs_not.length)
    chips.push({
      key: "langs_not",
      label: `not ${f.langs_not.join(", ")}`,
      clear: () => set({ langs_not: [] }),
    })
  for (const b of f.bounds)
    chips.push({
      key: b.metric,
      label: boundText(b),
      edit: () => onEdit(b.metric),
      clear: () => set({ bounds: f.bounds.filter((x) => x !== b) }),
    })
  if (f.cited_by.length)
    chips.push({
      key: "cited_by",
      label: `cited by ${f.cited_by.map((h) => `@${h}`).join(" or ")}`,
      edit: () => onEdit("cited_by"),
      clear: () => set({ cited_by: [] }),
    })
  if (f.cites.length)
    chips.push({
      key: "cites",
      label: `cites ${f.cites.map((h) => `@${h}`).join(" or ")}`,
      edit: () => onEdit("cites"),
      clear: () => set({ cites: [] }),
    })
  for (const relation of ["parents", "children"] as const) {
    const pk = f[relation]
    if (pk)
      chips.push({
        key: relation,
        label: `${pk.min}+ shared ${relation} with ${picksLabel(pk, s)}`,
        edit: () => onEdit(relation),
        clear: () => set(dropRelation(f, relation)),
      })
  }
  if (f.mentioned_days)
    chips.push({
      key: "mentioned",
      label: `your channels' mentions, last ${f.mentioned_days}d`,
      edit: () => onEdit("mentioned"),
      clear: () => set({ mentioned_days: null }),
    })
  if (f.ref_kinds.length)
    chips.push({
      key: "kinds",
      label: `kinds ${f.ref_kinds.join(", ")}`,
      clear: () => set({ ref_kinds: [] }),
    })
  if (f.has_photo)
    chips.push({
      key: "photo",
      label: "has photo",
      clear: () => set({ has_photo: false }),
    })
  if (f.use_selection)
    chips.push({
      key: "sel",
      label: "your channels = selection",
      clear: () => set({ use_selection: false }),
    })
  if (!f.hide_followed)
    chips.push({
      key: "followed",
      label: "showing followed",
      clear: () => set({ hide_followed: true }),
    })
  if (f.include_unavailable)
    chips.push({
      key: "unavail",
      label: "incl. unavailable",
      clear: () => set({ include_unavailable: false }),
    })
  if (f.dismissed !== "hide")
    chips.push({
      key: "dismissed",
      label:
        f.dismissed === "only"
          ? "only Not interested"
          : "showing Not interested",
      clear: () => set({ dismissed: "hide" }),
    })
  if (!chips.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-app-ink/10 pt-2">
      {chips.map((c) => (
        <span
          key={c.key}
          className="inline-flex items-center rounded-full bg-app-ink/10 text-xs"
        >
          <button
            type="button"
            onClick={c.edit}
            disabled={!c.edit}
            className={`py-0.5 pl-2.5 ${c.edit ? "hover:underline" : "cursor-default"}`}
          >
            {c.label}
          </button>
          <button
            type="button"
            aria-label={`Remove ${c.label}`}
            onClick={c.clear}
            className="rounded-full p-1 hover:bg-app-ink/20"
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={() =>
          setF({
            ...EMPTY,
            q: f.q,
            q_in: f.q_in,
            name_like: f.name_like,
            sort: f.sort,
            desc: f.desc,
            snippets: f.snippets,
          })
        }
        className="text-xs text-app-ink/50 underline"
      >
        clear filters
      </button>
    </div>
  )
}

// --- results ---------------------------------------------------------------------

type Column = { key: string; label: string; title: string; left?: boolean }
const COLUMNS: Column[] = [
  { key: "language", label: "Lang", title: "Language", left: true },
  { key: "subscribers", label: "Subs", title: "Subscribers" },
  { key: "reach", label: "Reach", title: "Average views per post" },
  { key: "posts_per_week", label: "Posts/wk", title: "Posts per week" },
  {
    key: "forward_pct",
    label: "Fwd %",
    title: "Share of posts that are forwards",
  },
  { key: "last_post_days", label: "Last post", title: "Last post" },
  { key: "indeg", label: "Cited by", title: "Distinct channels citing it" },
  { key: "outdeg", label: "Cites", title: "Distinct channels it cites" },
  { key: "mine", label: "Yours", title: "How many of your channels cite it" },
  { key: "found_days", label: "Found", title: "First seen by the Directory" },
]
// Ascending days means newest first, so those columns start ascending.
const ASC_FIRST = new Set([
  "last_post_days",
  "found_days",
  "mine_last_days",
  "handle",
])
const RELATION_COLUMNS: Record<Relation, Column> = {
  parents: {
    key: "shared_parents",
    label: "Parents",
    title:
      "Shared parents: how many channels citing your picks also cite it. Sorts by the weighted score.",
  },
  children: {
    key: "shared_children",
    label: "Children",
    title:
      "Shared children: how many of the channels your picks cite it cites too. Sorts by the weighted score.",
  },
}

function ResultsTable({
  s,
  open,
  setOpen,
  picked,
  setPicked,
}: {
  s: State
  open: string | null
  setOpen: (h: string) => void
  picked: Set<string>
  setPicked: (next: Set<string>) => void
}) {
  const { f, setF, set, res } = s
  const { state } = useContext(FollowCtx)
  // As in Discover, a Channel you follow is checked and cannot be picked.
  const pickable = (res.data?.rows ?? [])
    .map((r) => r.handle)
    .filter((h) => state(h) !== "done")
  const pickedHere = pickable.filter((h) => picked.has(h)).length
  const toggle = (handles: string[], on: boolean) => {
    const next = new Set(picked)
    for (const h of handles) on ? next.add(h) : next.delete(h)
    setPicked(next)
  }
  const relations = (["parents", "children"] as const).filter((k) => f[k])
  const columns = [
    ...relations.map((k) => RELATION_COLUMNS[k]),
    ...COLUMNS,
  ].filter((c) => !s.hiddenCols.includes(c.key))
  const sortBy = (key: string) =>
    set(
      f.sort === key
        ? { desc: !f.desc }
        : { sort: key, desc: !ASC_FIRST.has(key) },
    )
  const th = (key: string, label: string, title?: string, right = true) => (
    <th
      key={key}
      className={`px-2 py-2 ${right ? "text-right" : ""}`}
      title={title}
    >
      <button
        type="button"
        onClick={() => sortBy(key)}
        className={`inline-flex items-center gap-0.5 whitespace-nowrap hover:text-app-ink ${f.sort === key ? "text-app-ink" : ""}`}
      >
        {label}
        {f.sort === key &&
          (f.desc ? <ArrowDown size={10} /> : <ArrowUp size={10} />)}
      </button>
    </th>
  )
  return (
    <div className="h-[calc(100svh-270px)] overflow-auto rounded-lg border border-app-ink/10">
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10 bg-app-card text-left text-[11px] text-app-ink/60">
          <tr>
            <th className="w-8 pl-3">
              <input
                type="checkbox"
                aria-label="Pick every channel on this page"
                disabled={!pickable.length}
                checked={pickable.length > 0 && pickedHere === pickable.length}
                ref={(el) => {
                  if (el)
                    el.indeterminate =
                      pickedHere > 0 && pickedHere < pickable.length
                }}
                onChange={(e) => toggle(pickable, e.target.checked)}
              />
            </th>
            {th("handle", "Channel", undefined, false)}
            {columns.map((c) =>
              c.key === "language" ? (
                <th key={c.key} className="px-2 py-2" title={c.title}>
                  {c.label}
                </th>
              ) : (
                th(
                  c.key,
                  c.key === "mine" && f.mentioned_days
                    ? `Yours (${f.mentioned_days}d)`
                    : c.label,
                  c.title,
                )
              ),
            )}
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {res.data?.rows.map((r) => (
            <Fragment key={r.handle}>
              <tr
                onClick={() => setOpen(r.handle)}
                className={`cursor-pointer border-t border-app-ink/5 ${open === r.handle ? "bg-app-ink/10" : picked.has(r.handle) ? "bg-sky-500/10" : "hover:bg-app-ink/5"} ${r.dismissed ? "opacity-45" : ""}`}
              >
                <td className="pl-3" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`Pick @${r.handle}`}
                    disabled={state(r.handle) === "done"}
                    checked={state(r.handle) === "done" || picked.has(r.handle)}
                    onChange={(e) => toggle([r.handle], e.target.checked)}
                  />
                </td>
                <td className="max-w-72 px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <Avatar entry={r} size={26} />
                    <div className="min-w-0">
                      <div dir="auto" className="truncate font-semibold">
                        {r.display_name || r.handle}
                      </div>
                      <div className="truncate font-mono text-[10px] text-app-ink/40">
                        @{r.handle}
                      </div>
                    </div>
                  </div>
                </td>
                {columns.map((c) =>
                  c.key === "language" ? (
                    <td key={c.key} className="px-2 font-mono text-app-ink/60">
                      {r.language ?? ""}
                    </td>
                  ) : (
                    <Num key={c.key}>{cell(c.key, r)}</Num>
                  ),
                )}
                <td className="px-2 text-right whitespace-nowrap">
                  <DismissButton s={s} handle={r.handle} on={!!r.dismissed} />
                  <FollowButton handle={r.handle} size="sm" />
                </td>
              </tr>
              {f.snippets && (r.match || r.bio_hl) && (
                <tr
                  onClick={() => setOpen(r.handle)}
                  className={`cursor-pointer ${open === r.handle ? "bg-app-ink/10" : "hover:bg-app-ink/5"}`}
                >
                  <td colSpan={columns.length + 3} className="px-2 pb-2 pl-11">
                    {r.bio_hl && (
                      <p
                        dir="auto"
                        className="line-clamp-2 text-[11px] text-app-ink/60"
                      >
                        <Highlight text={r.bio_hl} />
                      </p>
                    )}
                    {r.match && (
                      <blockquote
                        dir="auto"
                        className="mt-1 line-clamp-2 border-l-2 border-amber-400 pl-2 text-[11px] text-app-ink/80"
                      >
                        <Highlight text={r.match.snippet} />
                        <span className="ml-2 font-mono text-[10px] text-app-ink/40">
                          post · {ago(r.match.timestamp)}
                        </span>
                      </blockquote>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      {res.data && res.data.total > PAGE && (
        <div className="flex items-center justify-center gap-3 py-3 text-xs">
          <button
            type="button"
            disabled={f.offset === 0}
            onClick={() => setF({ ...f, offset: Math.max(0, f.offset - PAGE) })}
            className="rounded border border-app-ink/15 px-2 py-1 disabled:opacity-30"
          >
            Previous
          </button>
          <span className="font-mono text-[11px] text-app-ink/50">
            {f.offset + 1}–{Math.min(f.offset + PAGE, res.data.total)}
          </span>
          <button
            type="button"
            disabled={f.offset + PAGE >= res.data.total}
            onClick={() => setF({ ...f, offset: f.offset + PAGE })}
            className="rounded border border-app-ink/15 px-2 py-1 disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}

/** What one numeric column shows for a row. */
function cell(key: string, r: Row): ReactNode {
  switch (key) {
    case "shared_parents":
      return <span title={relationLine(r, "parents")}>{r.parents_n}</span>
    case "shared_children":
      return <span title={relationLine(r, "children")}>{r.children_n}</span>
    case "subscribers":
      return fmt(r.subscribers)
    case "reach":
      return (
        <>
          {fmt(r.reach)}
          {r.reach_estimated && <span title="estimated">~</span>}
        </>
      )
    case "posts_per_week":
      return r.posts_per_week == null
        ? ""
        : r.posts_per_week.toFixed(r.posts_per_week < 10 ? 1 : 0)
    case "forward_pct":
      return r.forward_share == null
        ? ""
        : `${Math.round(r.forward_share * 100)}%`
    case "last_post_days":
      return ago(r.last_post_at)
    case "indeg":
      return r.indeg || ""
    case "outdeg":
      return r.outdeg || ""
    case "mine":
      return r.mine ? (
        <span title="last mentioned by your channels">
          <b>{r.mine}</b>
          {r.mine_last_at ? (
            <span className="text-app-ink/40"> · {ago(r.mine_last_at)}</span>
          ) : null}
        </span>
      ) : (
        ""
      )
    case "found_days":
      return ago(r.first_seen)
    default:
      return ""
  }
}

/** Which columns the table shows; the Channel and Follow columns always stay. */
function ColumnsMenu({ s }: { s: State }) {
  const all = [
    ...(["parents", "children"] as const).map((k) => ({
      ...RELATION_COLUMNS[k],
      hint: s.f[k] ? "" : " (when on)",
    })),
    ...COLUMNS.map((c) => ({ ...c, hint: "" })),
  ]
  const flip = (key: string) =>
    s.setHiddenCols(
      s.hiddenCols.includes(key)
        ? s.hiddenCols.filter((k) => k !== key)
        : [...s.hiddenCols, key],
    )
  return (
    <>
      {all.map((c) => (
        <label
          key={c.key}
          className="flex items-center gap-2 rounded px-1 py-1 hover:bg-app-ink/5"
          title={c.title}
        >
          <input
            type="checkbox"
            checked={!s.hiddenCols.includes(c.key)}
            onChange={() => flip(c.key)}
          />
          <span className="font-semibold">{c.label}</span>
          <span className="truncate text-[10px] text-app-ink/40">
            {c.title}
            {c.hint}
          </span>
        </label>
      ))}
      {s.hiddenCols.length > 0 && (
        <button
          type="button"
          onClick={() => s.setHiddenCols([])}
          className="mt-1 px-1 text-[11px] text-app-ink/50 underline"
        >
          show all
        </button>
      )}
    </>
  )
}

function Num({ children }: { children: ReactNode }) {
  return (
    <td className="px-2 text-right font-mono whitespace-nowrap text-app-ink/70">
      {children}
    </td>
  )
}

type Neighbour = {
  handle: string
  posts: number
  kinds: string[]
  display_name: string | null
  photo_url: string | null
  subscribers: number | null
}

function Drawer({
  row,
  handle,
  s,
  onClose,
  onFilter,
}: {
  row?: Row
  handle: string
  s: State
  onClose: () => void
  onFilter: (patch: Partial<Filters>) => void
}) {
  // The list leaves the bio out; /entry has it (and SampleList shares the fetch).
  const entry = useProto<{ entry: Entry }>(`/entry/${handle}`)
  const bio = entry.data?.entry.bio
  // The open Channel can be off the current page (it survives a reload), so
  // the header falls back to /entry when the list has no row for it.
  const head: Entry | undefined = row ?? entry.data?.entry
  const nb = useProto<{ cited_by: Neighbour[]; cites: Neighbour[] }>(
    `/neighbours/${handle}`,
  )
  return (
    <div className="fixed top-0 right-0 bottom-0 z-40 w-[440px] overflow-y-auto border-l border-app-ink/15 bg-app-bg p-5 shadow-2xl">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-3 right-3 rounded p-1 hover:bg-app-ink/10"
      >
        <X size={16} />
      </button>
      {head && (
        <header className="flex items-start gap-3 pr-6">
          <Avatar entry={head} size={56} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 dir="auto" className="text-lg font-bold">
                {head.display_name || head.handle}
              </h3>
              <TelegramLink handle={head.handle} />
            </div>
            <p className="font-mono text-[11px] text-app-ink/50">
              @{head.handle}
            </p>
            <Stats entry={head} />
          </div>
        </header>
      )}
      {bio && (
        <p
          dir="auto"
          className="mt-3 text-sm whitespace-pre-line text-app-ink/70"
        >
          {bio}
        </p>
      )}
      {head && (
        <div className="mt-3 flex items-center gap-2">
          <FollowButton handle={head.handle} />
          <DismissButton
            s={s}
            handle={head.handle}
            on={!!row?.dismissed}
            labelled
          />
          {row && (
            <span className="font-mono text-[10px] text-app-ink/40">
              {row.photos ?? 0} photos · {row.videos ?? 0} videos ·{" "}
              {row.files ?? 0} files · {row.links ?? 0} links
            </span>
          )}
        </div>
      )}
      <WhyHere row={row} handle={handle} s={s} />
      <h4 className="mt-5 mb-2 text-[11px] font-semibold tracking-wider text-app-ink/50 uppercase">
        Recent posts
      </h4>
      <SampleList handle={handle} />
      {(["cited_by", "cites"] as const).map((side) => (
        <div key={side}>
          <div className="mt-5 mb-2 flex items-center justify-between">
            <h4 className="text-[11px] font-semibold tracking-wider text-app-ink/50 uppercase">
              {side === "cited_by" ? "Cited most by" : "Cites most"}
            </h4>
            <button
              type="button"
              onClick={() =>
                onFilter(
                  side === "cited_by"
                    ? { cites: [handle] }
                    : { cited_by: [handle] },
                )
              }
              className="text-[11px] text-app-ink/50 underline hover:text-app-ink"
            >
              {side === "cited_by"
                ? `all channels citing @${handle}`
                : `all channels @${handle} cites`}
            </button>
          </div>
          <ul className="space-y-1">
            {nb.data?.[side].map((n) => (
              <li key={n.handle} className="flex items-center gap-2 text-xs">
                <Avatar entry={n} size={20} />
                <span dir="auto" className="min-w-0 flex-1 truncate">
                  {n.display_name || n.handle}{" "}
                  <span className="font-mono text-app-ink/40">@{n.handle}</span>
                </span>
                <span className="font-mono text-[10px] text-app-ink/40">
                  {n.posts} · {n.kinds.join(", ")}
                </span>
              </li>
            ))}
            {nb.data && nb.data[side].length === 0 && (
              <li className="text-xs text-app-ink/40">None recorded.</li>
            )}
          </ul>
        </div>
      ))}
    </div>
  )
}

// --- Shared parents / children and "Mentioned by your channels" (C and B in E) ---

const RELATION_TEXT: Record<
  Relation,
  { title: string; explain: string; metric: string }
> = {
  parents: {
    title: "Shared parents",
    explain:
      "Channels cited by the same channels that cite your picks (co-citation). A channel that many of your picks' parents also point at is probably read by the same people.",
    metric: "shared_parents",
  },
  children: {
    title: "Shared children",
    explain:
      "Channels that cite the same channels your picks cite (coupling). Only Channels someone follows have their own outbound references recorded, so picks you do not follow find little.",
    metric: "shared_children",
  },
}

function picksLabel(pk: Picks, s: State) {
  return pk.source === "selection"
    ? `my ${s.selectedCount} selected`
    : pk.source === "follows"
      ? `my ${s.followCount} follows`
      : pk.handles.map((h) => `@${h}`).join(", ")
}

/** The patch that turns a relation off, with its bounds and sort. */
function dropRelation(f: Filters, relation: Relation): Partial<Filters> {
  const metric = RELATION_TEXT[relation].metric
  return {
    [relation]: null,
    bounds: f.bounds.filter((b) => b.metric !== metric),
    ...(f.sort === metric ? { sort: "subscribers", desc: true } : {}),
  }
}

/** One relation's "why", from the row: how many shared, and a few of them. */
function relationLine(r: Row, relation: Relation) {
  const n = relation === "parents" ? r.parents_n : r.children_n
  const via = relation === "parents" ? r.parents_via : r.children_via
  if (!n) return ""
  const names = via?.length ? ` (${via.map((h) => `@${h}`).join(", ")})` : ""
  return relation === "parents"
    ? `Shared parents: ${n} channels citing your picks also cite it${names}`
    : `Shared children: it cites ${n} of the channels your picks cite${names}`
}

function RelationEditor({
  s,
  relation,
  onBack,
  onDone,
}: {
  s: State
  relation: Relation
  onBack: () => void
  onDone: () => void
}) {
  const current = s.f[relation]
  const text = RELATION_TEXT[relation]
  const [source, setSource] = useState<Picks["source"]>(
    current?.source ?? (s.selectedCount ? "selection" : "follows"),
  )
  const [typed, setTyped] = useState(
    (current?.handles ?? []).map((h) => `@${h}`).join(", "),
  )
  const [min, setMin] = useState<number>(current?.min ?? 2)
  const handles = typed
    .split(/[\s,]+/)
    .map((h) => h.replace(/^@/, "").trim().toLowerCase())
    .filter(Boolean)
  const ready = (source !== "handles" || handles.length > 0) && min >= 1
  const option = (value: Picks["source"], label: string, disabled = false) => (
    <label
      className={`flex items-center gap-2 rounded px-1 py-1 ${disabled ? "opacity-40" : "hover:bg-app-ink/5"}`}
    >
      <input
        type="radio"
        name={`${relation}-source`}
        disabled={disabled}
        checked={source === value}
        onChange={() => setSource(value)}
      />
      {label}
    </label>
  )
  return (
    <div className="space-y-2 p-1">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 font-semibold"
      >
        <ArrowLeft size={12} /> {text.title} with
      </button>
      <p className="text-[10px] text-app-ink/50">
        {text.explain} Sorting weighs the count against how connected the
        channel is overall, so giants do not win by size.
      </p>
      {option(
        "selection",
        `my Channels tab selection (${s.selectedCount})`,
        s.selectedCount === 0,
      )}
      {option("follows", `every channel I follow (${s.followCount})`)}
      {option("handles", "these channels:")}
      {source === "handles" && (
        <input
          // biome-ignore lint/a11y/noAutofocus: the field the choice opened
          autoFocus
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="@one, @two"
          className="w-full rounded border border-app-ink/20 bg-app-card px-2 py-1 font-mono outline-none focus:border-app-ink/60"
        />
      )}
      <label className="flex items-center gap-2">
        <span className="text-[10px] text-app-ink/50">
          at least this many shared {relation}
        </span>
        <input
          inputMode="numeric"
          value={min}
          onChange={(e) => setMin(Math.max(1, Number(e.target.value) || 1))}
          className="w-14 rounded border border-app-ink/20 bg-app-card px-2 py-0.5 font-mono outline-none"
        />
      </label>
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={!ready}
          onClick={() => {
            s.set({
              [relation]: {
                source,
                handles: source === "handles" ? handles : [],
                min,
              },
              sort: text.metric,
              desc: true,
            })
            onDone()
          }}
          className="flex-1 rounded bg-app-ink/90 px-2 py-1.5 font-semibold text-app-bg disabled:opacity-40"
        >
          {current ? "Update" : "Add"} · sort by {text.title.toLowerCase()}
        </button>
        {current && (
          <button
            type="button"
            onClick={() => {
              s.set(dropRelation(s.f, relation))
              onDone()
            }}
            className="rounded border border-app-ink/20 px-2 py-1.5 hover:bg-app-ink/5"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  )
}

const MENTION_WINDOWS = [7, 14, 30, 90]

function MentionEditor({
  s,
  onBack,
  onDone,
}: {
  s: State
  onBack: () => void
  onDone: () => void
}) {
  const current = s.f.bounds.find((b) => b.metric === "mine")
  // Any whole number of days; the pills are only shortcuts.
  const [days, setDays] = useState<number | null>(s.f.mentioned_days ?? 14)
  const [min, setMin] = useState<number>(current?.min ?? 1)
  const [selection, setSelection] = useState(s.f.use_selection)
  const [recent, setRecent] = useState(
    s.f.mentioned_days ? s.f.sort === "mine_last_days" : true,
  )
  return (
    <div className="space-y-2 p-1">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 font-semibold"
      >
        <ArrowLeft size={12} /> Mentioned by your channels
      </button>
      <p className="text-[10px] text-app-ink/50">
        Channels your channels forwarded, mentioned, linked or replied to
        lately: the Inbox, as a filter. Reference kinds narrow it.
      </p>
      <div>
        <span className="text-[10px] text-app-ink/50">within the last</span>
        <div className="mt-0.5 flex items-center gap-1">
          <input
            inputMode="numeric"
            aria-label="Days"
            value={days ?? ""}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10)
              setDays(Number.isFinite(n) && n > 0 ? n : null)
            }}
            className="w-16 rounded border border-app-ink/20 bg-app-card px-2 py-0.5 font-mono outline-none focus:border-app-ink/60"
          />
          <span className="mr-1 text-app-ink/50">days</span>
          {MENTION_WINDOWS.map((d) => (
            <TogglePill key={d} on={days === d} onClick={() => setDays(d)}>
              {d}d
            </TogglePill>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2">
        <span className="text-[10px] text-app-ink/50">
          by at least this many of them
        </span>
        <input
          inputMode="numeric"
          value={min}
          onChange={(e) => setMin(Math.max(1, Number(e.target.value) || 1))}
          className="w-14 rounded border border-app-ink/20 bg-app-card px-2 py-0.5 font-mono outline-none"
        />
      </label>
      <label className="flex items-center gap-1.5 text-app-ink/70">
        <input
          type="checkbox"
          checked={selection}
          disabled={s.selectedCount === 0}
          onChange={(e) => setSelection(e.target.checked)}
        />
        count only my Channels tab selection ({s.selectedCount}), not all{" "}
        {s.followCount} follows
      </label>
      <label className="flex items-center gap-1.5 text-app-ink/70">
        <input
          type="checkbox"
          checked={recent}
          onChange={(e) => setRecent(e.target.checked)}
        />
        sort by most recent mention
      </label>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => {
            if (!days) return
            s.set({
              mentioned_days: days,
              use_selection: selection,
              bounds: [
                ...s.f.bounds.filter((b) => b.metric !== "mine"),
                {
                  metric: "mine",
                  mode: "atLeast",
                  min,
                  max: null,
                  negate: false,
                },
              ],
              ...(recent ? { sort: "mine_last_days", desc: false } : {}),
            })
            onDone()
          }}
          disabled={!days}
          className="flex-1 rounded bg-app-ink/90 px-2 py-1.5 font-semibold text-app-bg disabled:opacity-40"
        >
          {s.f.mentioned_days ? "Update" : "Add"}
        </button>
        {s.f.mentioned_days && (
          <button
            type="button"
            onClick={() => {
              s.set({
                mentioned_days: null,
                bounds: s.f.bounds.filter((b) => b.metric !== "mine"),
                sort: s.f.sort === "mine_last_days" ? "subscribers" : s.f.sort,
                desc: s.f.sort === "mine_last_days" ? true : s.f.desc,
              })
              onDone()
            }}
            className="rounded border border-app-ink/20 px-2 py-1.5 hover:bg-app-ink/5"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  )
}

type Mention = {
  source_channel: string
  source_post_id: number
  timestamp: number
  kinds: string[]
  text: string | null
  source_name: string | null
}

const KIND_VERB: Record<string, string> = {
  forward: "forwarded",
  mention: "mentioned",
  link: "linked",
  reply: "replied to",
}

/**
 * Why this Channel is in the list: its shared parents and children with the
 * picks, and the Posts of yours that pointed at it (what the Inbox showed).
 */
function WhyHere({ row, handle, s }: { row?: Row; handle: string; s: State }) {
  const mentions = useProto<{ rows: Mention[] }>(
    row?.mine
      ? `/feed/${handle}/posts?days=${s.f.mentioned_days ?? 3650}`
      : null,
    false,
    { sources: s.mentionSources },
  )
  const lines = row
    ? (["parents", "children"] as const)
        .map((k) => relationLine(row, k))
        .filter(Boolean)
    : []
  const posts = mentions.data?.rows ?? []
  if (!lines.length && !row?.mine) return null
  return (
    <section className="mt-5 rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/5 p-3">
      <h4 className="mb-2 text-[11px] font-semibold tracking-wider text-app-ink/50 uppercase">
        Why it's here
      </h4>
      {lines.map((line) => (
        <p key={line} className="text-xs text-app-ink/80">
          {line}.
        </p>
      ))}
      {row?.mine ? (
        <>
          <p className="mt-1 text-xs text-app-ink/80">
            {row.mine} of your channels pointed at it
            {s.f.mentioned_days
              ? ` in the last ${s.f.mentioned_days} days`
              : ""}
            {mentions.isLoading ? "…" : ":"}
          </p>
          <ul className="mt-2 space-y-2">
            {posts.slice(0, 5).map((m) => (
              <li
                key={`${m.source_channel}/${m.source_post_id}`}
                className="rounded-md border border-app-ink/10 bg-app-bg p-2 text-xs"
              >
                <div className="mb-1 flex items-center gap-1.5 text-[11px] text-app-ink/60">
                  <b dir="auto" className="text-app-ink/80">
                    {m.source_name || m.source_channel}
                  </b>
                  {m.kinds.map((k) => KIND_VERB[k] ?? k).join(" + ")} it ·{" "}
                  {ago(m.timestamp)}
                  <TelegramLink
                    handle={m.source_channel}
                    post={m.source_post_id}
                  />
                </div>
                {m.text && (
                  <div dir="auto" className="text-app-ink/80">
                    <PostText text={m.text} />
                  </div>
                )}
              </li>
            ))}
          </ul>
          {posts.length > 5 && (
            <p className="mt-1 text-[10px] text-app-ink/40">
              and {posts.length - 5} more
            </p>
          )}
        </>
      ) : null}
    </section>
  )
}

/** "Not interested": hides the Channel from every view until undone. */
function DismissButton({
  s,
  handle,
  on,
  labelled = false,
}: {
  s: State
  handle: string
  on: boolean
  labelled?: boolean
}) {
  return (
    <button
      type="button"
      title={on ? "Show it again" : "Not interested: hide it"}
      onClick={(e) => {
        e.stopPropagation()
        s.setDismissed(handle, !on)
      }}
      className={`mr-1 inline-flex shrink-0 items-center gap-1 rounded-full align-middle whitespace-nowrap text-app-ink/40 hover:bg-app-ink/10 hover:text-app-ink ${labelled ? "border border-app-ink/20 px-2.5 py-1 text-xs" : "p-1"}`}
    >
      {on ? <Undo2 size={12} /> : <EyeOff size={12} />}
      {labelled && (on ? "Interested again" : "Not interested")}
    </button>
  )
}

/** The picked Channels and what to do with them, as Discover's bulk bar. */
function BulkBar({
  s,
  picked,
  setPicked,
}: {
  s: State
  picked: Set<string>
  setPicked: (next: Set<string>) => void
}) {
  const { followMany } = useContext(FollowCtx)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!picked.size) return null
  const handles = [...picked]
  const follow = async () => {
    setBusy(true)
    await followMany(handles)
    setBusy(false)
    setPicked(new Set())
  }
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs">
      <b>{picked.size} picked</b>
      <span className="truncate text-app-ink/50" title={handles.join(", ")}>
        {handles
          .slice(0, 4)
          .map((h) => `@${h}`)
          .join(", ")}
        {picked.size > 4 && ` +${picked.size - 4}`}
      </span>
      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            picked.size >= BULK_FOLLOW_CONFIRM_THRESHOLD
              ? setConfirming(true)
              : follow()
          }
          className="rounded-full bg-app-ink px-3 py-1 font-semibold text-app-bg hover:opacity-85 disabled:opacity-50"
        >
          {busy ? "Following…" : `Follow ${picked.size}`}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            await s.setDismissedMany(handles, true)
            setPicked(new Set())
          }}
          className="inline-flex items-center gap-1 rounded-full border border-app-ink/20 px-3 py-1 hover:bg-app-ink/10 disabled:opacity-50"
        >
          <EyeOff size={12} /> Not interested
        </button>
        <button
          type="button"
          onClick={() => setPicked(new Set())}
          className="rounded-full px-2 py-1 text-app-ink/60 hover:bg-app-ink/10"
        >
          Clear
        </button>
      </div>
      <TgConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Follow channels?"
        description={`Follow ${picked.size} channels? Each starts syncing into your account.`}
        confirmLabel="Follow"
        onConfirm={() => {
          setConfirming(false)
          void follow()
        }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}
