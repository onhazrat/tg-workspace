/**
 * The Post filter's controls (PTR-03): the Type, Media and Language dropdowns,
 * the Filters menu for a number bound, and the vocabulary the shared filter row
 * and condition picker read. Each is a shared `filter-tree` component told
 * what a Post Condition is; the Channels tab's are the same components.
 */
import {
  AtSign,
  ChevronDown,
  Eye,
  Forward,
  Hash,
  Image,
  Languages,
  type LucideIcon,
  SlidersHorizontal,
} from "lucide-react"
import { createContext, useContext, useState } from "react"
import type { PostValueHistogramResponse } from "@/client"
import {
  BarHeading,
  BarPopover,
  BarSearch,
  MenuRowLabel,
} from "@/components/BarPopover"
import { BoundHistogram } from "@/components/filter-tree/BarHistogram"
import { BoundFields } from "@/components/filter-tree/BoundFields"
import type { ConditionOption } from "@/components/filter-tree/ConditionPicker"
import {
  FacetMenu,
  type FacetMenuRow,
} from "@/components/filter-tree/FacetMenu"
import type { FilterVocabulary } from "@/components/filter-tree/FilterRow"
import { pillClass } from "@/components/PostFilterParts"
import { type Range, useZoomState } from "@/components/SpreadZoom"
import { NumberBoundEditor } from "@/components/spread-prototype/NumberBoundEditor"
import { useSpreadVariant } from "@/components/spread-prototype/variant"
import { TgButton } from "@/components/ui/tg-button"
import {
  type BoundKind,
  boundKind,
  boundText,
  type MetricBound,
  parseBound,
} from "@/lib/channels/channel-metrics"
import {
  append,
  atoms,
  clearFunnels,
  funnelledValues,
  removeFunnel,
} from "@/lib/filter-tree"
import {
  addPostFunnel,
  measureLabel,
  numberCond,
  POST_NUMBER,
  POST_NUMBERS,
  POST_TYPE_VALUES,
  type PostCond,
  type PostFacet,
  type PostFilter,
  type PostNumber,
  postConditionLabel,
  postNumberOf,
  wholeBound,
} from "@/lib/posts/post-filter"
import { MEDIA_KIND_OPTIONS } from "@/lib/posts/post-media"

export const POST_CONDITION_ICON: Record<PostCond["type"], LucideIcon> = {
  type: Forward,
  media: Image,
  language: Languages,
  channel: AtSign,
  views: Eye,
  channel_posts: Hash,
  channel_posts_filtered: Hash,
}

// ---- The number editor -----------------------------------------------------

/**
 * A hook answering a number's bars over the window and the selected
 * Channels, the filters aside but for Channel posts in filtered window, which
 * counts what they keep; `undefined` while they load. Context rather
 * than a prop so the filter bar renders, and tests, without the providers
 * the read needs: with none, the editors draw no histogram.
 */
export type ValueHistogramRead = (
  measure: PostNumber,
  zoom?: ValueHistogramZoom | null,
) => PostValueHistogramResponse | undefined

/** A zoomed read (TB-04): bin only `[lo, hi]`, on the scale first drawn. */
export type ValueHistogramZoom = { lo: number; hi: number; log: boolean }

export const PostValueHistogramContext =
  createContext<ValueHistogramRead | null>(null)

function PostValueHistogram({
  read,
  measure,
  bound,
  onSelect,
}: {
  read: ValueHistogramRead
  measure: PostNumber
  bound: MetricBound | null
  onSelect: (bound: MetricBound) => void
}) {
  const [zoomed, setZoomed] = useState<{ range: Range; log: boolean } | null>(
    null,
  )
  const d = read(
    measure,
    zoomed && { lo: zoomed.range[0], hi: zoomed.range[1], log: zoomed.log },
  )
  if (!d) return <p className="h-16 text-[11px] text-app-ink/50">Counting…</p>
  if (!d.measured)
    return (
      <p className="text-[11px] text-app-ink/50">
        Nothing in this window has a value yet.
      </p>
    )
  return (
    <BoundHistogram
      distribution={{
        bins: d.bins,
        edge: (i) => d.edges[i],
        lo: d.min ?? d.edges[0],
        hi: d.max ?? d.edges[d.edges.length - 1],
        median: d.median ?? 0,
        log: d.log,
      }}
      bound={bound}
      noun={POST_NUMBER[measure].noun}
      onSelect={onSelect}
      zoom={{
        range: zoomed?.range ?? null,
        setRange: (range) => setZoomed(range && { range, log: d.log }),
      }}
    />
  )
}

/**
 * One number's bound: at least, at most, between or (for a views measure) no
 * value, one or two fields, Add or Update, over the number's histogram,
 * which a drag across fills the fields from. A Channel posts bound is whole:
 * rounded inward, and refused when no whole number is left (PTI-02).
 */
type PostNumberEditorProps = {
  measure: PostNumber
  initial?: MetricBound
  floorHours: number
  onSubmit: (cond: PostCond) => void
  onBack?: () => void
}

// PROTOTYPE: variant 1 draws the one Number bound editor.
export function PostNumberEditor(props: PostNumberEditorProps) {
  const read = useContext(PostValueHistogramContext)
  if (useSpreadVariant() !== "1" || !read)
    return <PostNumberEditor0 {...props} />
  return <PostNumberEditor1 {...props} read={read} />
}

/** The server's bars for the zoom, read on the scale first drawn (TB-04). */
function PostNumberEditor1({
  read,
  ...props
}: PostNumberEditorProps & { read: ValueHistogramRead }) {
  const zoom = useZoomState()
  const [log, setLog] = useState<boolean | null>(null)
  const d = read(
    props.measure,
    zoom.range && { lo: zoom.range[0], hi: zoom.range[1], log: !!log },
  )
  if (d && log === null) setLog(d.log)
  const counts = POST_NUMBER[props.measure].whole
  return (
    <NumberBoundEditor
      label={measureLabel(props.measure)}
      description={POST_NUMBER[props.measure].description(props.floorHours)}
      initial={props.initial}
      source={{
        kind: "read",
        zoom,
        read:
          d &&
          (d.measured
            ? {
                bars: d.bins.map((count, i) => ({
                  lo: d.edges[i],
                  hi: d.edges[i + 1],
                  count,
                })),
                lo: d.min ?? d.edges[0],
                hi: d.max ?? d.edges[d.edges.length - 1],
                median: d.median ?? 0,
                log: d.log,
              }
            : null),
      }}
      min={0}
      whole={counts}
      noValue={!counts}
      noun={POST_NUMBER[props.measure].noun}
      onSubmit={(bound) => props.onSubmit(numberCond(props.measure, bound))}
      onBack={props.onBack}
    />
  )
}

function PostNumberEditor0({
  measure,
  initial,
  floorHours,
  onSubmit,
  onBack,
}: {
  measure: PostNumber
  /** The Condition being changed; without one the editor adds. */
  initial?: MetricBound
  floorHours: number
  onSubmit: (cond: PostCond) => void
  onBack?: () => void
}) {
  const counts = POST_NUMBER[measure].whole
  const [op, setOp] = useState<BoundKind>(boundKind(initial))
  const [a, setA] = useState(
    String((op === "lte" ? initial?.max : initial?.min) ?? ""),
  )
  const [b, setB] = useState(String(initial?.max ?? ""))
  const typed = parseBound(op, a, b, { min: 0 })
  const bound = counts && typed ? wholeBound(typed) : typed
  const read = useContext(PostValueHistogramContext)
  const select = (next: MetricBound) => {
    setOp(boundKind(next))
    setA(String(next.min ?? next.max))
    setB(String(next.max ?? ""))
  }
  return (
    <form
      className="space-y-2 p-1"
      onSubmit={(e) => {
        e.preventDefault()
        if (bound) onSubmit(numberCond(measure, bound))
      }}
    >
      <div className="flex items-center gap-2 text-xs font-semibold">
        {onBack && (
          <button
            type="button"
            aria-label="Back to the criteria"
            onClick={onBack}
            className="text-app-ink/50 hover:text-app-ink"
          >
            ←
          </button>
        )}
        {measureLabel(measure)}
      </div>
      <p className="text-[11px] text-app-ink/50">
        {POST_NUMBER[measure].description(floorHours)}
      </p>
      {read && (
        <PostValueHistogram
          read={read}
          measure={measure}
          bound={bound}
          onSelect={select}
        />
      )}
      <BoundFields
        op={op}
        setOp={setOp}
        a={a}
        setA={setA}
        b={b}
        setB={setB}
        min={0}
        noValue={!counts}
      />
      {!counts && (
        <p className="text-[11px] text-app-ink/50">
          A post with no {measureLabel(measure).toLowerCase()} does not match a
          bound.
          {op === "none"
            ? " No value finds exactly those posts, and NOT on it the ones that have one."
            : " Choose no value to find them."}
        </p>
      )}
      <TgButton
        type="submit"
        size="sm"
        disabled={!bound}
        data-testid="post-views-editor-submit"
        className="w-full"
      >
        {initial ? "Update" : "Add"}
      </TgButton>
    </form>
  )
}

// ---- The vocabulary --------------------------------------------------------

/** What the picker offers for a Language and a Channel, which vary by Account. */
export type PostConditionOptions = {
  languages: ConditionOption[]
  channels: ConditionOption[]
}

const LISTS: {
  type: PostFacet | "channel"
  label: string
  options: (o: PostConditionOptions) => ConditionOption[]
}[] = [
  {
    type: "type",
    label: "Type",
    options: () =>
      POST_TYPE_VALUES.map((t) => ({ id: t.value, label: t.label })),
  },
  {
    type: "media",
    label: "Media",
    options: () =>
      MEDIA_KIND_OPTIONS.map((m) => ({ id: m.value, label: m.label })),
  },
  { type: "language", label: "Language", options: (o) => o.languages },
  { type: "channel", label: "Channel", options: (o) => o.channels },
]

/** `start`'s bound when it bounds `number`, the Condition that editor changes. */
const numberStart = (start: PostCond | undefined, number: PostNumber) => {
  const n = start && postNumberOf(start)
  return n && n.number === number ? n.bound : undefined
}

/** The Post Conditions as the shared filter row and picker read them. */
export function postVocabulary(
  options: PostConditionOptions,
  floorHours: number,
): FilterVocabulary<PostCond> {
  return {
    sections: [
      {
        entries: LISTS.map(({ type, label, options: of }) => ({
          kind: "list" as const,
          id: type,
          label,
          icon: POST_CONDITION_ICON[type],
          options: of(options),
          make: (value: string) => ({ type, value }) as PostCond,
          current: (cond: PostCond) =>
            cond.type === type && "value" in cond ? cond.value : undefined,
        })),
      },
      {
        heading: "Numbers",
        entries: POST_NUMBERS.map((m) => ({
          kind: "editor" as const,
          id: m.entry,
          label: m.label,
          icon: m.icon,
          render: ({ start, onSubmit, onBack }) => (
            <PostNumberEditor
              measure={m.value}
              initial={numberStart(start, m.value)}
              floorHours={floorHours}
              onBack={onBack}
              onSubmit={onSubmit}
            />
          ),
        })),
      },
    ],
    entryOf: (cond) => {
      const number = postNumberOf(cond)?.number
      return number === undefined ? cond.type : POST_NUMBER[number].entry
    },
    label: postConditionLabel,
    icon: (cond) => POST_CONDITION_ICON[cond.type],
    chipId: (cond) =>
      cond.type === "views"
        ? `views-${cond.measure}`
        : "value" in cond
          ? `${cond.type}-${cond.value}`
          : cond.type,
  }
}

// ---- The dropdowns ---------------------------------------------------------

/** One value of a dropdown: how many Posts in the window have it, and are selected. */
export type PostFacetValue = {
  id: string
  label: string
  /** Dimmed beside the label: a Language's code (ADR-021). */
  hint?: string
  count?: number
  selected?: number
}

/** The tick a row reads: all of its Posts selected, some, or none. */
const tickOf = (selected: number, total: number): FacetMenuRow["tick"] =>
  total > 0 && selected >= total ? "true" : selected > 0 ? "mixed" : "false"

/**
 * A Type, Media or Language dropdown: a search and a row per value with a
 * funnel. Two funnels in one dropdown join with OR, different dropdowns with
 * AND. With `onTick`, each row also has a tick that selects every Post with
 * the value in the window when none is selected, and deselects them when
 * some or all are, whatever the filter shows (PTR-06).
 */
export function PostFacetMenu({
  facet,
  label,
  values,
  filter,
  onChange,
  onOpenChange,
  onTick,
}: {
  facet: PostFacet
  label: string
  values: PostFacetValue[]
  filter: PostFilter
  onChange: (next: PostFilter) => void
  onOpenChange?: (open: boolean) => void
  onTick?: (value: string, select: boolean) => void
}) {
  const Icon = POST_CONDITION_ICON[facet]
  const rows: FacetMenuRow[] = values.map((v) => {
    const total = v.count ?? 0
    const selected = v.selected ?? 0
    return {
      id: v.id,
      label: v.label,
      hint: v.hint,
      selected,
      total,
      tick: tickOf(selected, total),
    }
  })
  return (
    <FacetMenu
      icon={<Icon size={12} />}
      label={label}
      noun={label.toLowerCase()}
      testId={`post-filter-${facet}`}
      rows={rows}
      funnelled={funnelledValues(filter, facet)}
      labelOf={(id) => values.find((v) => v.id === id)?.label ?? id}
      // Partly selected deselects: dropping a whole value from what an Action
      // covers is what a tick is for (story 56).
      onToggleSelect={onTick && ((row) => onTick(row.id, row.tick === "false"))}
      tickHint="Tick: every Post with it, whatever the filter shows"
      onFunnel={(id, on) =>
        onChange(
          on
            ? addPostFunnel(filter, facet, id)
            : removeFunnel(filter, facet, id),
        )
      }
      onClearFunnels={() => onChange(clearFunnels(filter, facet))}
      onOpenChange={onOpenChange}
    />
  )
}

/**
 * The Filters menu: every number in `POST_NUMBERS`, each with the bounds
 * already in the filter, and picking one opens its editor. Adding always
 * makes a new Condition, so one number can be bound twice.
 */
export function PostFiltersMenu({
  filter,
  onChange,
  floorHours,
}: {
  filter: PostFilter
  onChange: (next: PostFilter) => void
  floorHours: number
}) {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<PostNumber | null>(null)
  const [query, setQuery] = useState("")
  const bounds = atoms(filter).flatMap((a) => {
    const n = postNumberOf(a.cond)
    return n ? [{ ...n, not: a.not }] : []
  })
  const active = bounds.length > 0
  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setPicked(null)
  }
  return (
    <BarPopover
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <button
          type="button"
          data-testid="post-filters"
          data-active={active}
          className={pillClass(active)}
        >
          <SlidersHorizontal size={12} /> Filters
          {active && (
            <span className="rounded-full bg-app-bg/20 px-1.5 text-[10px] tabular-nums">
              {bounds.length}
            </span>
          )}
          <ChevronDown size={12} className="opacity-60" />
        </button>
      }
    >
      {picked ? (
        <PostNumberEditor
          measure={picked}
          floorHours={floorHours}
          onBack={() => setPicked(null)}
          onSubmit={(cond) => {
            onChange(append(filter, "root", cond))
            onOpenChange(false)
          }}
        />
      ) : (
        <>
          <BarSearch
            value={query}
            onChange={setQuery}
            placeholder="Search criteria..."
          />
          <BarHeading>Filter by</BarHeading>
          {POST_NUMBERS.filter((m) =>
            m.label.toLowerCase().includes(query.trim().toLowerCase()),
          ).map((m) => (
            <button
              key={m.value}
              type="button"
              data-testid={`post-filters-${m.value}`}
              onClick={() => setPicked(m.value)}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left font-semibold hover:bg-app-ink/5"
            >
              <MenuRowLabel icon={m.icon} label={m.label} />
              <span className="text-[11px] font-normal tabular-nums text-app-ink/50">
                {bounds
                  .filter((a) => a.number === m.value)
                  .map((a) => `${a.not ? "not " : ""}${boundText(a.bound)}`)
                  .join(", ")}
              </span>
            </button>
          ))}
        </>
      )}
    </BarPopover>
  )
}
