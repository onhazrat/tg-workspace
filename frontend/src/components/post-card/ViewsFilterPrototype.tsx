/**
 * PROTOTYPE (post-card): the Channels tab's number filter and sort, brought to
 * the Posts filter bar. A variant of A-plus, all with the Channels-style
 * Sort (one searchable pill and a direction arrow):
 *
 *   A-plus-menu   a Filters dropdown listing Views and Estimated views, each
 *                 opening a histogram editor, as Channels → Filters does
 *   (a Views pill with the editor, and an always-open strip, were dropped.)
 *
 * Two shims stand in for server work, both marked `ponytail:`. The histogram
 * is drawn from a sample of the Scope's newest Posts, and "between" sends the
 * lower bound to the server and applies the upper one to the loaded pages.
 */
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  SlidersHorizontal,
} from "lucide-react"
import { useMemo, useState } from "react"
import { useScraper } from "@/contexts/ScraperContext"
import {
  useViewEstimate,
  useViewsSample,
  VIEWS_SAMPLE,
} from "@/hooks/usePostsView"
import type { MetricBound } from "@/lib/channels/channel-metrics"
import { postViewValue } from "@/lib/posts/estimated-views"
import { viewMeasureDescription } from "@/lib/posts/post-filter-bar"
import type { PostSortOrder, ViewMeasure } from "@/lib/posts/post-view"
import type { Post } from "@/types"
import { BarHeading, BarPopover, BarSearch } from "../channel-grid/BarPopover"
import { Histogram } from "../channel-grid/ChannelMetricEditor"
import { Options, Pill, pillClass } from "../PostFilterParts"
import { TgButton } from "../ui/tg-button"
import { TgIconButton } from "../ui/tg-icon-button"
import { useCardVariant, useFeedPrefs } from "./PostCardPrototype"

const MEASURES: { value: ViewMeasure; label: string }[] = [
  { value: "views", label: "Views" },
  { value: "estimated", label: "Estimated views" },
]
const measureLabel = (m: ViewMeasure) =>
  MEASURES.find((x) => x.value === m)?.label ?? "Views"

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumSignificantDigits: 3,
})

// ---------------------------------------------------------------------------
// The one views bound, read and written as the Channels editor's MetricBound.

export function useViewsBound(): {
  measure: ViewMeasure
  bound: MetricBound | null
} {
  const { viewMeasure, viewsFilter } = useScraper()
  const { viewsMax } = useFeedPrefs()
  if (!viewsFilter) return { measure: viewMeasure, bound: null }
  if (viewsFilter.op === "lte")
    return { measure: viewMeasure, bound: { max: viewsFilter.value } }
  return {
    measure: viewMeasure,
    bound: { min: viewsFilter.value, max: viewsMax ?? undefined },
  }
}

export function useApplyViews() {
  const { setViewMeasure, setViewsFilter } = useScraper()
  const prefs = useFeedPrefs()
  return (measure: ViewMeasure, bound: MetricBound | null) => {
    setViewMeasure(measure)
    if (!bound || (bound.min == null && bound.max == null)) {
      setViewsFilter(null)
      prefs.set({ viewsMax: null })
    } else if (bound.min != null) {
      setViewsFilter({ op: "gte", value: Math.round(bound.min) })
      prefs.set({ viewsMax: bound.max ?? null })
    } else if (bound.max != null) {
      setViewsFilter({ op: "lte", value: Math.round(bound.max) })
      prefs.set({ viewsMax: null })
    }
  }
}

export function boundSummary(bound: MetricBound | null, measure: ViewMeasure) {
  if (!bound) return "Any"
  const unit = measure === "estimated" ? "est. views" : "views"
  if (bound.min != null && bound.max != null)
    return `${compact.format(bound.min)}–${compact.format(bound.max)} ${unit}`
  if (bound.min != null) return `≥ ${compact.format(bound.min)} ${unit}`
  return `≤ ${compact.format(bound.max ?? 0)} ${unit}`
}

/** A-plus-* "between": drop loaded Posts above the browser-side upper bound. */
export function useViewsMaxFilter(posts: Post[], skip: boolean): Post[] {
  const { viewMeasure } = useScraper()
  const { viewsMax } = useFeedPrefs()
  const estimate = useViewEstimate()
  const on = useCardVariant().startsWith("A-plus-") && viewsMax != null && !skip
  return useMemo(
    () =>
      on
        ? posts.filter((p) => {
            const v = postViewValue(p, viewMeasure, estimate)
            return v != null && v <= (viewsMax ?? 0)
          })
        : posts,
    [on, posts, viewMeasure, estimate, viewsMax],
  )
}

/** The sampled values under one measure, ascending, as the histogram wants. */
function useSampleValues(measure: ViewMeasure, enabled: boolean) {
  const sample = useViewsSample(enabled)
  const estimate = useViewEstimate()
  const values = useMemo(
    () =>
      (sample ?? [])
        .map((p) => postViewValue(p, measure, estimate))
        .filter((v): v is number => v != null)
        .sort((a, b) => a - b),
    [sample, measure, estimate],
  )
  return { values, sampled: sample?.length ?? 0, loading: !sample }
}

// ---------------------------------------------------------------------------
// The editor: the Channels number editor, for a post's views.

type Op = "gte" | "lte" | "between"
const OPS: [Op, string][] = [
  ["gte", "at least"],
  ["lte", "at most"],
  ["between", "between"],
]
const opOf = (b: MetricBound | null | undefined): Op =>
  b?.min != null && b?.max != null ? "between" : b?.max != null ? "lte" : "gte"
const num = (t: string) =>
  t.trim() === "" || !Number.isFinite(Number(t)) ? undefined : Number(t)
function boundOf(op: Op, a: string, b: string): MetricBound | null {
  const [x, y] = [num(a), num(b)]
  if (x === undefined) return null
  if (op === "gte") return { min: x }
  if (op === "lte") return { max: x }
  return y === undefined || y < x ? null : { min: x, max: y }
}
const inBound = (v: number, b: MetricBound) =>
  (b.min == null || v >= b.min) && (b.max == null || v <= b.max)
const fieldClass =
  "h-8 min-w-0 w-24 rounded-md border border-app-ink/15 bg-app-muted px-2 text-xs tabular-nums outline-none focus:border-app-ink/40"

export function ViewsEditor({
  fixedMeasure,
  onDone,
  onBack,
  initial,
  onSubmitBound,
}: {
  /** The Filters menu picks the measure before opening the editor. */
  fixedMeasure?: ViewMeasure
  onDone?: () => void
  onBack?: () => void
  /**
   * A-plus-select: the editor returns a bound for a tree Condition instead
   * of writing the feed's one views filter, as the Channels metric editor does.
   */
  initial?: MetricBound
  onSubmitBound?: (bound: MetricBound) => void
}) {
  const current = useViewsBound()
  const apply = useApplyViews()
  const estimate = useViewEstimate()
  const [measure, setMeasure] = useState<ViewMeasure>(
    fixedMeasure ?? current.measure,
  )
  const own = onSubmitBound
    ? (initial ?? null)
    : measure === current.measure
      ? current.bound
      : null
  const [op, setOp] = useState<Op>(opOf(own))
  const [a, setA] = useState(String((op === "lte" ? own?.max : own?.min) ?? ""))
  const [b, setB] = useState(String(own?.max ?? ""))
  const { values, sampled, loading } = useSampleValues(measure, true)
  const bound = boundOf(op, a, b)
  const kept = bound ? values.filter((v) => inBound(v, bound)).length : 0

  const select = (next: MetricBound) => {
    const nextOp = opOf(next)
    setOp(nextOp)
    setA(String(next.min ?? next.max ?? ""))
    setB(String(next.max ?? ""))
  }
  const submit = () => {
    if (bound && onSubmitBound) onSubmitBound(bound)
    else if (bound) apply(measure, bound)
    onDone?.()
  }
  const clear = () => {
    apply(measure, null)
    setA("")
    setB("")
    onDone?.()
  }
  const replacing =
    !onSubmitBound &&
    fixedMeasure &&
    current.bound &&
    current.measure !== fixedMeasure
      ? `Replaces the ${measureLabel(current.measure).toLowerCase()} bound: the feed takes one.`
      : null

  const measureTabs = !fixedMeasure && (
    <div className="flex gap-3 border-b border-app-ink/10" role="tablist">
      {MEASURES.map((m) => (
        <button
          key={m.value}
          type="button"
          role="tab"
          aria-selected={m.value === measure}
          onClick={() => setMeasure(m.value)}
          className={`-mb-px border-b-2 pb-1.5 ${m.value === measure ? "border-app-ink font-semibold" : "border-transparent text-app-ink/60"}`}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
  const histogram = loading ? (
    <div className="h-16 animate-pulse rounded-md bg-app-ink/[0.05]" />
  ) : values.length > 0 ? (
    <Histogram
      key={measure}
      values={values}
      bound={bound}
      onSelect={select}
      noun="posts"
    />
  ) : (
    <p className="text-[11px] text-app-ink/50">
      No post in this scope has a value yet.
    </p>
  )
  const opButtons = (
    <fieldset aria-label="Operator" className="m-0 flex gap-1 border-0 p-0">
      {OPS.map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={op === key}
          onClick={() => setOp(key)}
          className={`flex-1 whitespace-nowrap rounded-md border px-1.5 py-1 text-[11px] font-semibold ${
            op === key
              ? "border-app-ink bg-app-ink text-app-bg"
              : "border-app-ink/15 hover:border-app-ink/40"
          }`}
        >
          {label}
        </button>
      ))}
    </fieldset>
  )
  const fields = (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        step="any"
        aria-label={op === "between" ? "From" : "Views"}
        value={a}
        onChange={(e) => setA(e.target.value)}
        className={fieldClass}
      />
      {op === "between" && (
        <>
          <span className="text-app-ink/50">and</span>
          <input
            type="number"
            step="any"
            aria-label="To"
            value={b}
            onChange={(e) => setB(e.target.value)}
            className={fieldClass}
          />
        </>
      )}
    </div>
  )
  const sampleNote = `${kept.toLocaleString()} of ${values.length.toLocaleString()} sampled posts (the newest ${Math.min(sampled, VIEWS_SAMPLE).toLocaleString()} in scope).`

  return (
    <form
      className="space-y-2 p-1"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      {(onBack || fixedMeasure) && (
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
      )}
      {measureTabs}
      <p className="text-[11px] text-app-ink/60">
        {viewMeasureDescription(measure, estimate?.estimationFloorHours ?? 3)}
      </p>
      {histogram}
      {opButtons}
      {fields}
      {replacing && <p className="text-[11px] text-amber-600">{replacing}</p>}
      <TgButton type="submit" size="sm" disabled={!bound} className="w-full">
        {onSubmitBound ? (initial ? "Update" : "Add") : "Apply"} ·{" "}
        {bound ? sampleNote : "pick a bound"}
      </TgButton>
      {!onSubmitBound && current.bound && (
        <button
          type="button"
          onClick={clear}
          className="w-full text-center text-[11px] text-app-ink/60 hover:underline"
        >
          Clear the views bound
        </button>
      )}
    </form>
  )
}

// ---------------------------------------------------------------------------
// The three ways in.

export function ViewsFiltersMenu() {
  const { measure, bound } = useViewsBound()
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<ViewMeasure | null>(null)
  const [query, setQuery] = useState("")
  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setPicked(null)
  }
  return (
    <BarPopover
      open={open}
      onOpenChange={onOpenChange}
      width={picked ? "w-96" : "w-72"}
      trigger={
        <button
          type="button"
          data-testid="post-filters"
          className={pillClass(bound != null)}
        >
          <SlidersHorizontal size={12} /> Filters
          {bound && (
            <span className="rounded-full bg-app-bg/20 px-1.5 text-[10px] tabular-nums">
              1
            </span>
          )}
          <ChevronDown size={12} className="opacity-60" />
        </button>
      }
    >
      {picked ? (
        <ViewsEditor
          key={picked}
          fixedMeasure={picked}
          onBack={() => setPicked(null)}
          onDone={() => onOpenChange(false)}
        />
      ) : (
        <>
          <BarSearch
            value={query}
            onChange={setQuery}
            placeholder="Search criteria..."
          />
          <BarHeading>Filter by</BarHeading>
          {MEASURES.filter((m) =>
            m.label.toLowerCase().includes(query.trim().toLowerCase()),
          ).map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setPicked(m.value)}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left font-semibold hover:bg-app-ink/5"
            >
              {m.label}
              <span className="text-[11px] font-normal tabular-nums text-app-ink/50">
                {bound && measure === m.value
                  ? boundSummary(bound, measure)
                  : ""}
              </span>
            </button>
          ))}
        </>
      )}
    </BarPopover>
  )
}

// ---------------------------------------------------------------------------
// Sort as the Channels tab does it: what to sort by, then which way.

type SortKey = "date" | "views" | "estimated"
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "date", label: "Post date" },
  { value: "views", label: "Views" },
  { value: "estimated", label: "Estimated views" },
]

export function PostSortMenu() {
  const { postSortOrder, setPostSortOrder, viewMeasure, setViewMeasure } =
    useScraper()
  const [query, setQuery] = useState("")
  const byDate = postSortOrder === "newest" || postSortOrder === "oldest"
  const key: SortKey = byDate
    ? "date"
    : viewMeasure === "estimated"
      ? "estimated"
      : "views"
  const desc = postSortOrder === "newest" || postSortOrder === "most_views"
  const orderFor = (k: SortKey, d: boolean): PostSortOrder =>
    k === "date" ? (d ? "newest" : "oldest") : d ? "most_views" : "fewest_views"
  const choose = (k: SortKey) => {
    if (k !== "date") setViewMeasure(k === "estimated" ? "estimated" : "views")
    setPostSortOrder(orderFor(k, desc))
  }
  const direction = desc ? "descending" : "ascending"
  return (
    <div className="flex items-center gap-0.5">
      <Pill
        label="Sort"
        value={SORT_OPTIONS.find((o) => o.value === key)?.label ?? "Post date"}
        active={false}
        width="w-56"
        testId="post-sort"
      >
        <BarSearch
          value={query}
          onChange={setQuery}
          placeholder="Search sort options..."
        />
        <Options
          options={SORT_OPTIONS.filter((o) =>
            o.label.toLowerCase().includes(query.trim().toLowerCase()),
          )}
          value={key}
          onChange={choose}
        />
        <p className="mt-1 px-2 text-[10px] text-app-ink/50">
          A views sort reads the same measure as the views filter.
        </p>
      </Pill>
      <TgIconButton
        aria-label={`Sort ${direction}`}
        tooltip={`Sort ${direction}`}
        onClick={() => setPostSortOrder(orderFor(key, !desc))}
        className="h-8 w-8"
      >
        {desc ? <ArrowDown size={13} /> : <ArrowUp size={13} />}
      </TgIconButton>
    </div>
  )
}
