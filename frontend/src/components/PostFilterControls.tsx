/**
 * The Post filter's controls (PTR-03): the Type, Media and Language dropdowns,
 * the Filters menu for a views bound, and the vocabulary the shared filter row
 * and condition picker read. Each is a shared `filter-tree` component told
 * what a Post Condition is; the Channels tab's are the same components.
 */
import {
  AtSign,
  ChevronDown,
  Eye,
  Forward,
  Image,
  Languages,
  type LucideIcon,
  SlidersHorizontal,
} from "lucide-react"
import { useState } from "react"
import { BarHeading, BarPopover, BarSearch } from "@/components/BarPopover"
import { BoundFields } from "@/components/filter-tree/BoundFields"
import type { ConditionOption } from "@/components/filter-tree/ConditionPicker"
import {
  FacetMenu,
  type FacetMenuRow,
} from "@/components/filter-tree/FacetMenu"
import type { FilterVocabulary } from "@/components/filter-tree/FilterRow"
import { pillClass } from "@/components/PostFilterParts"
import { TgButton } from "@/components/ui/tg-button"
import {
  type BoundKind,
  boundKind,
  boundText,
  type MetricBound,
  parseBound,
} from "@/lib/channels/channel-metrics"
import {
  type AtomNode,
  append,
  atoms,
  clearFunnels,
  funnelledValues,
  removeFunnel,
} from "@/lib/filter-tree"
import type { ViewMeasure } from "@/lib/posts/estimated-views"
import {
  addPostFunnel,
  measureLabel,
  POST_TYPE_VALUES,
  type PostCond,
  type PostFacet,
  type PostFilter,
  type PostViewsCond,
  postConditionLabel,
} from "@/lib/posts/post-filter"
import {
  VIEW_MEASURE_OPTIONS,
  viewMeasureDescription,
} from "@/lib/posts/post-filter-bar"
import { MEDIA_KIND_OPTIONS } from "@/lib/posts/post-media"

export const POST_CONDITION_ICON: Record<PostCond["type"], LucideIcon> = {
  type: Forward,
  media: Image,
  language: Languages,
  channel: AtSign,
  views: Eye,
}

// ---- The views editor ------------------------------------------------------

/**
 * One measure's bound: at least, at most, between or no value, one or two
 * fields, Add or Update. No histogram: the server has no endpoint for one yet.
 */
export function PostViewsEditor({
  measure,
  initial,
  floorHours,
  onSubmit,
  onBack,
}: {
  measure: ViewMeasure
  /** The Condition being changed; without one the editor adds. */
  initial?: MetricBound
  floorHours: number
  onSubmit: (cond: PostViewsCond) => void
  onBack?: () => void
}) {
  const [op, setOp] = useState<BoundKind>(boundKind(initial))
  const [a, setA] = useState(
    String((op === "lte" ? initial?.max : initial?.min) ?? ""),
  )
  const [b, setB] = useState(String(initial?.max ?? ""))
  const bound = parseBound(op, a, b, { min: 0 })
  return (
    <form
      className="space-y-2 p-1"
      onSubmit={(e) => {
        e.preventDefault()
        if (bound) onSubmit({ type: "views", measure, ...bound })
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
        {viewMeasureDescription(measure, floorHours)}
      </p>
      <BoundFields
        op={op}
        setOp={setOp}
        a={a}
        setA={setA}
        b={b}
        setB={setB}
        min={0}
      />
      <p className="text-[11px] text-app-ink/50">
        A post with no {measureLabel(measure).toLowerCase()} does not match a
        bound.
        {op === "none"
          ? " No value finds exactly those posts, and NOT on it the ones that have one."
          : " Choose no value to find them."}
      </p>
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
        entries: VIEW_MEASURE_OPTIONS.map((m) => ({
          kind: "editor" as const,
          id: `views:${m.value}`,
          label: m.label,
          icon: Eye,
          render: ({ start, onSubmit, onBack }) => (
            <PostViewsEditor
              measure={m.value}
              initial={start?.type === "views" ? start : undefined}
              floorHours={floorHours}
              onBack={onBack}
              onSubmit={onSubmit}
            />
          ),
        })),
      },
    ],
    entryOf: (cond) =>
      cond.type === "views" ? `views:${cond.measure}` : cond.type,
    label: postConditionLabel,
    icon: (cond) => POST_CONDITION_ICON[cond.type],
    chipId: (cond) =>
      cond.type === "views"
        ? `views-${cond.measure}`
        : `${cond.type}-${cond.value}`,
  }
}

// ---- The dropdowns ---------------------------------------------------------

/** One value of a dropdown: how many Posts in the window have it, and are selected. */
export type PostFacetValue = {
  id: string
  label: string
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
 * The Filters menu: Views and Estimated views, each with the bounds already
 * in the filter, and picking one opens its editor. Adding always makes a new
 * Condition, so one measure can be bound twice.
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
  const [picked, setPicked] = useState<ViewMeasure | null>(null)
  const [query, setQuery] = useState("")
  const bounds = atoms(filter).filter(
    (a): a is AtomNode<PostCond> & { cond: PostViewsCond } =>
      a.cond.type === "views",
  )
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
        <PostViewsEditor
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
          {VIEW_MEASURE_OPTIONS.filter((m) =>
            m.label.toLowerCase().includes(query.trim().toLowerCase()),
          ).map((m) => (
            <button
              key={m.value}
              type="button"
              data-testid={`post-filters-${m.value}`}
              onClick={() => setPicked(m.value)}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left font-semibold hover:bg-app-ink/5"
            >
              {m.label}
              <span className="text-[11px] font-normal tabular-nums text-app-ink/50">
                {bounds
                  .filter((a) => a.cond.measure === m.value)
                  .map((a) => `${a.not ? "not " : ""}${boundText(a.cond)}`)
                  .join(", ")}
              </span>
            </button>
          ))}
        </>
      )}
    </BarPopover>
  )
}
