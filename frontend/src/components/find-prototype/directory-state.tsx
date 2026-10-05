// PROTOTYPE (find-prototype): what the three bar variants (T, Q, R) share:
// one view in the URL (`?dir=`: the tree's text form, the search, the sort),
// the /browse body built from it, the Condition editors, the vocabulary the
// shared FilterRow and ConditionPicker read, and E's results, drawer and bulk
// bar reused through an adapter. Only the bars differ between the variants.

import { useQueryClient } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  CircleDot,
  GitFork,
  Hash,
  Inbox,
  Languages,
  type LucideIcon,
  Type,
  Users,
} from "lucide-react"
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { PickerEntry } from "@/components/filter-tree/ConditionPicker"
import type { FilterVocabulary } from "@/components/filter-tree/FilterRow"
import { useData } from "@/contexts/DataContext"
import { append, emptyTree } from "@/lib/filter-tree"
import {
  boundOf,
  condLabel,
  condsOf,
  type DCond,
  type DTree,
  FLAG_LABEL,
  type Flag,
  metricCond,
  OPENING,
  type PickSource,
  parseDirectory,
  printDirectory,
  setRoot,
  without,
} from "./directory-filter"
import { fmt, usePersistentState, useProto } from "./shared"
import {
  BoundEditor,
  BulkBar,
  Drawer,
  EMPTY,
  type Filters,
  languageLabel,
  MENTION_WINDOWS,
  METRIC_SECTIONS,
  ResultsTable,
  type Row,
  SORTS,
  type State,
  TogglePill,
  useDismiss,
} from "./VariantBrowseTop"

const workspaceRoute = getRouteApi("/_tg/workspace")
export const PAGE = 100

export type Yours = "follows" | "selection" | "picked"

/** The three ways to count "cited by your channels", as the sort offers them. */
export const YOURS_SORTS: { yours: Yours; label: string }[] = [
  { yours: "follows", label: "Cited by channels you follow" },
  { yours: "selection", label: "Cited by your Channels tab selection" },
  { yours: "picked", label: "Cited by channels ticked here" },
]

export type View = {
  /** The Directory filter in its text form. */
  f: string
  q: string
  q_in: string[]
  snippets: boolean
  sort: string
  desc: boolean
  /** Reference kinds: narrow every Reference Condition and "yours". */
  kinds: string[]
  /**
   * Whose citations "Cited by your channels" counts: the sort, the "Yours"
   * column and the Condition all read it.
   */
  yours: Yours
  offset: number
}

const DEFAULT_VIEW: View = {
  f: OPENING,
  q: "",
  q_in: ["name", "bio", "posts"],
  snippets: true,
  sort: "mine",
  desc: true,
  kinds: [],
  yours: "follows",
  offset: 0,
}

function encodeView(v: View) {
  const diff = Object.fromEntries(
    (Object.keys(DEFAULT_VIEW) as (keyof View)[])
      .filter((k) => JSON.stringify(v[k]) !== JSON.stringify(DEFAULT_VIEW[k]))
      .map((k) => [k, v[k]]),
  )
  return Object.keys(diff).length ? diff : undefined
}

/** `?dir=` first, else the last view kept in this browser; written back to both. */
function useUrlView() {
  const { dir } = workspaceRoute.useSearch()
  const navigate = workspaceRoute.useNavigate()
  const [stored, setStored] = usePersistentState<View>("D.view", DEFAULT_VIEW)
  const view = useMemo<View>(
    () => (dir ? { ...DEFAULT_VIEW, ...(dir as Partial<View>) } : stored),
    [dir, stored],
  )
  const latest = useRef(view)
  latest.current = view
  const write = useCallback(
    (next: View) => {
      latest.current = next
      setStored(next)
      navigate({
        search: (prev) => ({ ...prev, dir: encodeView(next) }),
        replace: true,
      })
    },
    [navigate, setStored],
  )
  useEffect(() => {
    if (!dir && encodeView(stored)) write(stored)
  }, [])
  /** A patch; anything but paging goes back to the first page. */
  const patch = useCallback(
    (p: Partial<View>) => write({ ...latest.current, offset: 0, ...p }),
    [write],
  )
  return [view, patch] as const
}

type Browse = {
  rows: Row[]
  total: number
  langs: { language: string; n: number }[]
  ms: number
}

export function useDirectory() {
  const { selectedChannels, channels } = useData()
  const [view, patch] = useUrlView()
  const tree = useMemo(
    () => parseDirectory(view.f) ?? (parseDirectory(OPENING) as DTree),
    [view.f],
  )
  const setTree = useCallback(
    (t: DTree) => patch({ f: printDirectory(t) }),
    [patch],
  )
  const setQ = (q: string) =>
    patch({
      q,
      sort: q ? "relevance" : view.sort === "relevance" ? "mine" : view.sort,
    })

  const selection = useMemo(
    () => [...selectedChannels].sort(),
    [selectedChannels],
  )
  const follows = useMemo(() => channels.map((c) => c.name).sort(), [channels])
  // Ticked in the list for a bulk action; also a pick source for the relations.
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const pickedList = useMemo(() => [...picked].sort(), [picked])
  const picks = useCallback(
    (source: PickSource, handles: string[]) =>
      (source === "selection"
        ? selection
        : source === "follows"
          ? follows
          : source === "picked"
            ? pickedList
            : handles
      )
        .map((h) => h.toLowerCase())
        .sort(),
    [selection, follows, pickedList],
  )

  // The server reads no sources as "every follow", so an empty selection or
  // tick list is sent as one handle that matches nothing.
  const yoursSources = useCallback(
    (y: Yours) => {
      if (y === "follows") return []
      const list = y === "selection" ? selection : pickedList
      return list.length ? list.map((h) => h.toLowerCase()) : ["~none~"]
    },
    [selection, pickedList],
  )

  /** The /browse body for a tree and this view. */
  const bodyFor = useCallback(
    (t: DTree, v: View = view) => {
      const conds = condsOf(t)
      const rel = (type: "parents" | "children") => {
        const c = conds.find((x) => x.type === type) as
          | (DCond & { type: "parents" | "children" })
          | undefined
        return c ? { of: picks(c.source, c.handles), min: c.min } : null
      }
      const par = rel("parents")
      const chi = rel("children")
      const mine = conds.find((x) => x.type === "mine") as
        | (DCond & { type: "mine" })
        | undefined
      const sort =
        v.sort === "relevance" && !v.q
          ? "mine"
          : (v.sort === "shared_parents" && !par) ||
              (v.sort === "shared_children" && !chi)
            ? "mine"
            : v.sort
      return {
        q: v.q,
        q_in: v.q_in,
        snippets: v.snippets,
        sort,
        desc: v.desc,
        ref_kinds: v.kinds,
        offset: v.offset,
        limit: PAGE,
        hide_followed: false,
        include_unavailable: true,
        dismissed: "show",
        tree: t,
        parents_of: par?.of ?? [],
        parents_min: par?.min ?? 2,
        children_of: chi?.of ?? [],
        children_min: chi?.min ?? 2,
        mentioned_days: mine?.days ?? null,
        // "Your channels" are the selection, or every follow without one.
        sources: yoursSources(v.yours),
      }
    },
    [view, picks, yoursSources],
  )

  // The search waits out typing; clearing it applies at once and cancels.
  const body = bodyFor(tree)
  const [debounced, setDebounced] = useState(body)
  const key = JSON.stringify(body)
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!body.q && debounced.q) {
      queryClient.cancelQueries({ queryKey: ["proto", "/browse"] })
      setDebounced(body)
      return
    }
    const t = setTimeout(() => setDebounced(body), 300)
    return () => clearTimeout(t)
  }, [key])
  const res = useProto<Browse>("/browse", true, debounced)
  // "N of M": the whole Directory, counted once and cached by the server.
  const all = useProto<{ total: number }>("/browse", false, {
    ...bodyFor(emptyTree<DCond>(), { ...DEFAULT_VIEW }),
    count_only: true,
  })

  const reload = () => {
    queryClient.invalidateQueries({ queryKey: ["proto", "/browse"] })
    queryClient.invalidateQueries({ queryKey: ["proto", "/histogram"] })
  }
  const { setDismissed, setDismissedMany } = useDismiss(reload)
  const [hiddenCols, setHiddenCols] = usePersistentState<string[]>(
    "E.hiddenColumns",
    [],
  )

  const langs = res.data?.langs ?? []
  const conds = condsOf(tree)
  const relation = (type: "parents" | "children") => {
    const c = conds.find((x) => x.type === type) as
      | (DCond & { type: "parents" | "children" })
      | undefined
    if (!c) return null
    // E's shape has no "picked"; to E's table it is just those handles.
    return c.source === "picked"
      ? { source: "handles" as const, handles: pickedList, min: c.min }
      : { source: c.source, handles: c.handles, min: c.min }
  }
  const mine = conds.find((x) => x.type === "mine") as
    | (DCond & { type: "mine" })
    | undefined

  // E's table, drawer and bulk bar read E's state; this is that shape, filled
  // from the view. ponytail: a cast, not a shared type; fine for a prototype.
  const f: Filters = {
    ...EMPTY,
    q: view.q,
    snippets: view.snippets,
    sort: body.sort,
    desc: view.desc,
    offset: view.offset,
    parents: relation("parents"),
    children: relation("children"),
    mentioned_days: mine?.days ?? null,
    use_selection: selection.length > 0,
  }
  const s = {
    f,
    set: (p: Partial<Filters>) =>
      patch({
        ...(p.sort !== undefined ? { sort: p.sort } : {}),
        ...(p.desc !== undefined ? { desc: p.desc } : {}),
      }),
    setF: (next: Filters) => patch({ offset: next.offset }),
    res,
    hiddenCols,
    setHiddenCols,
    setDismissed,
    setDismissedMany,
    selectedCount: selection.length,
    followCount: follows.length,
    mentionSources:
      view.yours === "follows"
        ? follows
        : view.yours === "selection"
          ? selection
          : pickedList,
  } as unknown as State

  const langName = (code: string) => languageLabel(code)
  const vocabulary = useVocabulary({
    tree,
    bodyFor,
    langs,
    selectedCount: selection.length,
    followCount: follows.length,
    picked: pickedList,
  })
  const sortOptions = SORTS.filter(
    (o) =>
      (o.key !== "relevance" || view.q) &&
      (o.key !== "shared_parents" || f.parents) &&
      (o.key !== "shared_children" || f.children),
  ).flatMap((o) =>
    o.key === "mine"
      ? YOURS_SORTS.map((y) => ({ value: `mine:${y.yours}`, label: y.label }))
      : [{ value: o.key, label: o.label }],
  )

  return {
    view,
    patch,
    tree,
    setTree,
    setQ,
    body,
    bodyFor,
    res,
    all,
    langs,
    langName,
    s,
    vocabulary,
    sortOptions,
    selectedCount: selection.length,
    followCount: follows.length,
    picked,
    setPicked,
    /** Add a Condition at the root, joined with the rest by AND. */
    add: (cond: DCond, not = false) =>
      setTree(setRoot(tree, () => false, { cond, not })),
  }
}
export type Dir = ReturnType<typeof useDirectory>

// --- the Condition editors ------------------------------------------------------

function EditorShell({
  title,
  explain,
  onBack,
  submit,
  disabled,
  onSubmit,
  children,
}: {
  title: string
  explain?: string
  onBack: () => void
  submit: string
  disabled?: boolean
  onSubmit: () => void
  children: ReactNode
}) {
  return (
    <div className="space-y-2 p-1">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 font-semibold"
      >
        <ArrowLeft size={12} /> {title}
      </button>
      {explain && <p className="text-[10px] text-app-ink/50">{explain}</p>}
      {children}
      <button
        type="button"
        disabled={disabled}
        onClick={onSubmit}
        className="w-full rounded bg-app-ink/90 px-2 py-1.5 font-semibold text-app-bg disabled:opacity-40"
      >
        {submit}
      </button>
    </div>
  )
}

const fieldClass =
  "w-full rounded border border-app-ink/20 bg-app-card px-2 py-1 font-mono outline-none focus:border-app-ink/60"

const parseHandles = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((h) => h.replace(/^@/, "").trim().toLowerCase())
    .filter(Boolean)

type EditorProps<C> = {
  start?: C
  onSubmit: (cond: DCond) => void
  onBack: () => void
}

export function NameEditor({
  start,
  onSubmit,
  onBack,
}: EditorProps<DCond & { type: "name" }>) {
  const [text, setText] = useState(start?.value ?? "")
  return (
    <EditorShell
      title="Name contains"
      explain="The handle or the display name contains this text."
      onBack={onBack}
      submit={start ? "Update" : "Add"}
      disabled={!text.trim()}
      onSubmit={() => onSubmit({ type: "name", value: text.trim() })}
    >
      <input
        // biome-ignore lint/a11y/noAutofocus: the editor is this one field
        autoFocus
        dir="auto"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className={fieldClass}
      />
    </EditorShell>
  )
}

export function HandlesEditor({
  side,
  start,
  onSubmit,
  onBack,
}: EditorProps<DCond & { type: "cited_by" | "cites" }> & {
  side: "cited_by" | "cites"
}) {
  const [text, setText] = useState(
    (start?.handles ?? []).map((h) => `@${h}`).join(", "),
  )
  const handles = parseHandles(text)
  return (
    <EditorShell
      title={side === "cited_by" ? "Cited by @handle" : "Cites @handle"}
      explain={
        side === "cited_by"
          ? "Channels any of these forwarded, mentioned, linked or replied to. Reference kinds narrow it."
          : "Channels that forwarded, mentioned, linked or replied to any of these. Reference kinds narrow it."
      }
      onBack={onBack}
      submit={`${start ? "Update" : "Add"} · ${handles.length} handle${handles.length === 1 ? "" : "s"}`}
      disabled={!handles.length}
      onSubmit={() => onSubmit({ type: side, handles })}
    >
      <input
        // biome-ignore lint/a11y/noAutofocus: the editor is this one field
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="@one, @two"
        className={fieldClass}
      />
    </EditorShell>
  )
}

export function MentionEditor({
  start,
  onSubmit,
  onBack,
}: EditorProps<DCond & { type: "mine" }>) {
  const [days, setDays] = useState<number | null>(start ? start.days : 14)
  return (
    <EditorShell
      title="Cited by your channels"
      explain="Your channels forwarded, mentioned, linked or replied to it. Which channels count as yours is the Sort's Cited by choice: your follows, your Channels tab selection, or the channels ticked here. Bound the Cited by your channels number for at least N of them."
      onBack={onBack}
      submit={start ? "Update" : "Add"}
      onSubmit={() => onSubmit({ type: "mine", days })}
    >
      <div className="flex flex-wrap items-center gap-1">
        <TogglePill on={days === null} onClick={() => setDays(null)}>
          any time
        </TogglePill>
        {MENTION_WINDOWS.map((d) => (
          <TogglePill key={d} on={days === d} onClick={() => setDays(d)}>
            {d}d
          </TogglePill>
        ))}
        <input
          inputMode="numeric"
          aria-label="Days"
          value={days ?? ""}
          onChange={(e) => {
            const n = Number.parseInt(e.target.value, 10)
            setDays(Number.isFinite(n) && n > 0 ? n : null)
          }}
          className="w-14 rounded border border-app-ink/20 bg-app-card px-2 py-0.5 font-mono outline-none"
        />
      </div>
    </EditorShell>
  )
}

/** How the relation editor offers each pick source; "frozen" saves the ticks as handles. */
type PickChoice = PickSource | "frozen"

export function RelationEditor({
  type,
  start,
  onSubmit,
  onBack,
  selectedCount,
  followCount,
  picked = [],
}: EditorProps<DCond & { type: "parents" | "children" }> & {
  type: "parents" | "children"
  selectedCount: number
  followCount: number
  /** The channels ticked in the Directory list right now. */
  picked?: string[]
}) {
  const [choice, setChoice] = useState<PickChoice>(
    start?.source ??
      (picked.length ? "picked" : selectedCount ? "selection" : "follows"),
  )
  const [typed, setTyped] = useState(
    (start?.handles ?? []).map((h) => `@${h}`).join(", "),
  )
  const [min, setMin] = useState(start?.min ?? 2)
  const handles = parseHandles(typed)
  const option = (
    value: PickChoice,
    label: string,
    hint: string,
    off = false,
  ) => (
    <label
      className={`flex items-start gap-2 rounded px-1 py-1 ${off ? "opacity-40" : "hover:bg-app-ink/5"}`}
    >
      <input
        type="radio"
        className="mt-0.5"
        disabled={off}
        checked={choice === value}
        onChange={() => setChoice(value)}
      />
      <span>
        {label}
        <span className="block text-[10px] text-app-ink/50">{hint}</span>
      </span>
    </label>
  )
  const n = (count: number) => ` (${count.toLocaleString()})`
  return (
    <EditorShell
      title={
        type === "parents" ? "Shared parents with…" : "Shared children with…"
      }
      explain={
        type === "parents"
          ? "Cited by the same channels that cite the ones below (co-citation)."
          : "Cites the same channels the ones below cite (coupling)."
      }
      onBack={onBack}
      submit={start ? "Update" : "Add"}
      disabled={choice === "handles" && !handles.length}
      onSubmit={() =>
        onSubmit(
          choice === "frozen"
            ? { type, source: "handles", handles: picked, min }
            : {
                type,
                source: choice,
                handles: choice === "handles" ? handles : [],
                min,
              },
        )
      }
    >
      <p className="px-1 text-[10px] font-semibold tracking-widest text-app-ink/40 uppercase">
        Compared with
      </p>
      {option(
        "picked",
        `Channels ticked in this list${n(picked.length)}`,
        "Live: follows your ticks as you change them. A ticked channel leaves the results, since it is now a pick.",
        !picked.length && start?.source !== "picked",
      )}
      {option(
        "frozen",
        `Channels ticked in this list, saved now${n(picked.length)}`,
        "Fixed: keeps these handles; ticking or clearing later leaves it alone.",
        !picked.length,
      )}
      {option(
        "selection",
        `Channels selected on the Channels tab${n(selectedCount)}`,
        "Live: follows that tab's selection.",
        !selectedCount,
      )}
      {option(
        "follows",
        `Every channel you follow${n(followCount)}`,
        "Live: follows your follows.",
      )}
      {option("handles", "These channels", "Typed handles, fixed.")}
      {choice === "handles" && (
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="@one, @two"
          className={fieldClass}
        />
      )}
      <label className="flex items-center gap-2 text-[10px] text-app-ink/50">
        at least this many shared
        <input
          inputMode="numeric"
          value={min}
          onChange={(e) => setMin(Math.max(1, Number(e.target.value) || 1))}
          className="w-14 rounded border border-app-ink/20 bg-app-card px-2 py-0.5 font-mono outline-none"
        />
      </label>
    </EditorShell>
  )
}

/**
 * A metric's bound in a tree: the distribution is drawn under the tree with
 * that metric's other bounds taken out, and the preview ANDs the candidate on.
 * ponytail: under an OR the preview is a guess; exact needs the node's id.
 */
export function TreeBoundEditor({
  metric,
  start,
  tree,
  bodyFor,
  onSubmit,
  onBack,
}: {
  metric: string
  start?: DCond & { type: "metric" }
  tree: DTree
  bodyFor: (t: DTree) => unknown
  onSubmit: (cond: DCond) => void
  onBack: () => void
}) {
  const m = METRIC_SECTIONS.flatMap((x) => x.metrics).find(
    (x) => x.key === metric,
  )
  const others = without(
    tree,
    (c) => c.type === "metric" && c.metric === metric,
  )
  return (
    <BoundEditor
      metric={m ?? { key: metric, label: metric }}
      start={start && boundOf(start)}
      histFilters={bodyFor(others)}
      previewBody={(b) => ({
        ...(bodyFor(append(others, "root", metricCond(b))) as object),
        count_only: true,
      })}
      onSubmit={(b) => onSubmit(metricCond(b))}
      onBack={onBack}
      negatable={false}
    />
  )
}

// --- the vocabulary ---------------------------------------------------------------

const KEY_ICON: Record<string, LucideIcon> = {
  language: Languages,
  flag: CircleDot,
  name: Type,
  cited_by: ArrowDownLeft,
  cites: ArrowUpRight,
  mine: Inbox,
  parents: Users,
  children: GitFork,
}

export const entryOf = (c: DCond) => (c.type === "metric" ? c.metric : c.type)

function useVocabulary({
  tree,
  bodyFor,
  langs,
  selectedCount,
  followCount,
  picked,
}: {
  tree: DTree
  bodyFor: (t: DTree) => unknown
  langs: { language: string; n: number }[]
  selectedCount: number
  followCount: number
  picked: string[]
}): FilterVocabulary<DCond> {
  const relationsOn = new Set(condsOf(tree).map((c) => c.type))
  const editor = (
    id: string,
    label: string,
    icon: LucideIcon,
    render: Extract<PickerEntry<DCond>, { kind: "editor" }>["render"],
  ): PickerEntry<DCond> => ({ kind: "editor", id, label, icon, render })
  const metricEntries = (keys: { key: string; label: string }[]) =>
    keys
      .filter(
        (m) =>
          (m.key !== "shared_parents" || relationsOn.has("parents")) &&
          (m.key !== "shared_children" || relationsOn.has("children")),
      )
      .map((m) =>
        editor(m.key, m.label, Hash, ({ start, onSubmit, onBack }) => (
          <TreeBoundEditor
            metric={m.key}
            start={start?.type === "metric" ? start : undefined}
            tree={tree}
            bodyFor={bodyFor}
            onSubmit={onSubmit}
            onBack={onBack}
          />
        )),
      )
  const [size, content, refs] = METRIC_SECTIONS
  return {
    sections: [
      {
        heading: "Channel",
        entries: [
          {
            kind: "list",
            id: "language",
            label: "Language",
            icon: Languages,
            options: langs.map((l) => ({
              id: l.language,
              label: languageLabel(l.language),
              hint: fmt(l.n),
            })),
            make: (value) => ({ type: "language", value }),
            current: (c) => (c.type === "language" ? c.value : undefined),
          },
          {
            kind: "list",
            id: "flag",
            label: "State",
            icon: CircleDot,
            options: (Object.keys(FLAG_LABEL) as Flag[]).map((k) => ({
              id: k,
              label: FLAG_LABEL[k],
            })),
            make: (value) => ({ type: "flag", value: value as Flag }),
            current: (c) => (c.type === "flag" ? c.value : undefined),
          },
          editor("name", "Name contains", Type, (p) => (
            <NameEditor
              {...p}
              start={p.start?.type === "name" ? p.start : undefined}
            />
          )),
        ],
      },
      { heading: size.heading, entries: metricEntries(size.metrics) },
      { heading: content.heading, entries: metricEntries(content.metrics) },
      {
        heading: refs.heading,
        entries: [
          ...metricEntries(refs.metrics),
          editor("mine", "Cited by your channels…", Inbox, (p) => (
            <MentionEditor
              {...p}
              start={p.start?.type === "mine" ? p.start : undefined}
            />
          )),
          ...(["cited_by", "cites"] as const).map((side) =>
            editor(
              side,
              side === "cited_by" ? "Cited by @handle" : "Cites @handle",
              KEY_ICON[side],
              (p) => (
                <HandlesEditor
                  {...p}
                  side={side}
                  start={p.start?.type === side ? p.start : undefined}
                />
              ),
            ),
          ),
          ...(["parents", "children"] as const).map((type) =>
            editor(
              type,
              type === "parents"
                ? "Shared parents with…"
                : "Shared children with…",
              KEY_ICON[type],
              (p) => (
                <RelationEditor
                  {...p}
                  type={type}
                  start={p.start?.type === type ? p.start : undefined}
                  selectedCount={selectedCount}
                  followCount={followCount}
                  picked={picked}
                />
              ),
            ),
          ),
        ],
      },
    ],
    entryOf,
    label: (c) => condLabel(c, languageLabel),
    icon: (c) => (c.type === "metric" ? Hash : (KEY_ICON[c.type] ?? Hash)),
    chipId: (c) =>
      c.type === "metric"
        ? c.metric
        : `${c.type}-${"value" in c ? c.value : ""}`,
  }
}

// --- results ------------------------------------------------------------------------

/** E's bulk bar, table and drawer, under any of the bars. */
export function DirectoryResults({
  d,
  tableHeight,
}: {
  d: Dir
  tableHeight?: string
}) {
  const [open, setOpen] = usePersistentState<string | null>("E.open", null)
  const { picked, setPicked } = d
  return (
    <>
      <BulkBar s={d.s} picked={picked} setPicked={setPicked} />
      <div
        style={tableHeight ? { height: tableHeight } : undefined}
        className={tableHeight ? "[&>div]:h-full" : undefined}
      >
        <ResultsTable
          s={d.s}
          open={open}
          setOpen={setOpen}
          picked={picked}
          setPicked={setPicked}
          linkHandles
        />
      </div>
      {open && (
        <Drawer
          row={d.res.data?.rows.find((r) => r.handle === open)}
          handle={open}
          s={d.s}
          onClose={() => setOpen(null)}
          onFilter={(p) => {
            if (p.cites) d.add({ type: "cites", handles: p.cites })
            if (p.cited_by) d.add({ type: "cited_by", handles: p.cited_by })
            setOpen(null)
          }}
        />
      )}
    </>
  )
}
