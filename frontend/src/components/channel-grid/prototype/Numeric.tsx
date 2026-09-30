/**
 * PROTOTYPE, throwaway: the Metrics filter (N2, the winner over a range menu
 * and percentile buckets, which live in 0c6d6e8) and the active-filters bar.
 * One bound per metric; setting a metric again replaces its bound.
 */
import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react"
import type React from "react"
import { useState } from "react"
import { TgButton } from "@/components/ui/tg-button"
import { TgInput } from "@/components/ui/tg-input"
import { cn } from "@/lib/utils"
import {
  describeFilter,
  formatNumber,
  METRICS,
  type MetricKey,
  metric,
  metricValues,
  type NumericFilter,
  quantile,
} from "./metrics"
import { Pop, PopLabel } from "./Pop"
import type { ChannelControlsProps } from "./types"

const trigger =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-app-ink/10 bg-app-muted/50 px-3 text-[11px] font-semibold text-app-ink/80 hover:border-app-ink/25 hover:text-app-ink data-[state=open]:border-app-ink/40"
const activeTrigger = "border-app-ink/50 bg-app-ink/10 text-app-ink"

const withFilter = (list: NumericFilter[], f: NumericFilter) => [
  ...list.filter((x) => x.metric !== f.metric),
  ...(f.min === undefined && f.max === undefined ? [] : [f]),
]
const withoutMetric = (list: NumericFilter[], key: MetricKey) =>
  list.filter((x) => x.metric !== key)

const parseBound = (s: string) =>
  s.trim() === "" || Number.isNaN(Number(s)) ? undefined : Number(s)

const useMetricSearch = () => {
  const [q, setQ] = useState("")
  const shown = METRICS.filter((m) =>
    m.label.toLowerCase().includes(q.trim().toLowerCase()),
  )
  const input = (
    <TgInput
      variant="muted"
      value={q}
      onChange={(e) => setQ(e.target.value)}
      placeholder="Search criteria…"
      className="mb-1 h-8 py-0 text-[11px]"
    />
  )
  return { shown, input }
}

/**
 * Radix's `asChild` trigger hands its child the click handler, ref and aria
 * state as props, so they must reach the <button> or the popover never opens.
 */
const TriggerButton: React.FC<
  React.ComponentProps<"button"> & {
    label: string
    count: number
    icon?: React.ReactNode
  }
> = ({ label, count, icon, className, ...buttonProps }) => (
  <button
    type="button"
    {...buttonProps}
    className={cn(trigger, count > 0 && activeTrigger, className)}
  >
    {icon ?? <SlidersHorizontal size={13} />}
    {label}
    {count > 0 && (
      <span className="rounded-full bg-app-ink/15 px-1.5 text-[9px] tabular-nums">
        {count}
      </span>
    )}
    <ChevronDown size={12} className="opacity-50" />
  </button>
)

const BINS = 32

/** Two significant figures, so a dragged edge reads 1200, not 1187.43. */
const nice = (v: number) => Number(v.toPrecision(2))

/**
 * The metric's spread across your channels, and a brush over it: drag (or
 * click a bar) to set the bound. Counts like subscribers span orders of
 * magnitude, so the axis goes logarithmic when the range is that wide, or
 * every channel would land in the first bar.
 */
const HistogramBrush: React.FC<{
  values: number[]
  min?: number
  max?: number
  /** undefined at an end means that end is open. */
  onSelect: (lo?: number, hi?: number) => void
}> = ({ values, min, max, onSelect }) => {
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  if (values.length === 0)
    return <div className="h-16 text-[10px] text-app-ink/40">no data</div>
  const lo = values[0]
  const hi = values[values.length - 1]
  const log = lo >= 0 && hi / Math.max(lo, 1) > 100
  const f = log ? Math.log1p : (x: number) => x
  const inv = log ? Math.expm1 : (x: number) => x
  const flo = f(lo)
  const fhi = f(hi)
  const edge = (i: number) => inv(flo + ((fhi - flo) * i) / BINS)
  const binOf = (v: number) =>
    fhi === flo
      ? 0
      : Math.min(BINS - 1, Math.floor(((f(v) - flo) / (fhi - flo)) * BINS))
  const bins = new Array(BINS).fill(0)
  for (const v of values) bins[binOf(v)]++
  const peak = Math.max(...bins)

  const indexAt = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return Math.min(
      BINS - 1,
      Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * BINS)),
    )
  }
  const commit = (from: number, to: number) => {
    const s = Math.min(from, to)
    const t = Math.max(from, to)
    onSelect(
      s === 0 ? undefined : nice(edge(s)),
      t === BINS - 1 ? undefined : nice(edge(t + 1)),
    )
  }
  const selected = (i: number) =>
    drag
      ? i >= Math.min(drag.from, drag.to) && i <= Math.max(drag.from, drag.to)
      : (min === undefined || edge(i + 1) > min) &&
        (max === undefined || edge(i) <= max)
  const shown = drag ? drag.to : hover

  return (
    <div className="space-y-1">
      <div
        role="presentation"
        className="flex h-16 cursor-crosshair touch-none select-none items-end gap-px rounded-md bg-app-ink/[0.03] px-0.5"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          const i = indexAt(e)
          setDrag({ from: i, to: i })
        }}
        onPointerMove={(e) => {
          const i = indexAt(e)
          setHover(i)
          if (drag) setDrag({ ...drag, to: i })
        }}
        onPointerUp={() => {
          if (drag) commit(drag.from, drag.to)
          setDrag(null)
        }}
        onPointerLeave={() => setHover(null)}
      >
        {bins.map((n, i) => (
          <div
            key={i}
            className={cn(
              "flex-1 rounded-t-[2px]",
              selected(i) ? "bg-app-ink/70" : "bg-app-ink/15",
              shown === i && "ring-1 ring-app-ink/60",
            )}
            style={{
              height: `${n === 0 ? 2 : Math.max(8, (n / peak) * 100)}%`,
            }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[9px] tabular-nums text-app-ink/45">
        <span>{formatNumber(lo)}</span>
        <span>
          {shown !== null
            ? `${bins[shown]} channels · ${formatNumber(nice(edge(shown)))}–${formatNumber(nice(edge(shown + 1)))}`
            : `drag across the bars to select${log ? " · log scale" : ""}`}
        </span>
        <span>{formatNumber(hi)}</span>
      </div>
    </div>
  )
}

const RangeHint: React.FC<{ values: number[] }> = ({ values }) =>
  values.length ? (
    <span className="text-[9px] tabular-nums text-app-ink/45">
      {formatNumber(values[0])} · median {formatNumber(quantile(values, 0.5))} ·{" "}
      {formatNumber(values[values.length - 1])}
    </span>
  ) : null

/** The bound alone, e.g. "≥ 1.2k", for the list; "" when unset. */
const boundText = (f?: NumericFilter) =>
  !f
    ? ""
    : f.min !== undefined && f.max !== undefined
      ? `${formatNumber(f.min)}–${formatNumber(f.max)}`
      : f.min !== undefined
        ? `≥ ${formatNumber(f.min)}`
        : `≤ ${formatNumber(f.max ?? 0)}`

type Op = "gte" | "lte" | "between"

/** The Metrics editor: one metric, an operator, a value or two. */
export const NumericEditor: React.FC<{
  p: ChannelControlsProps
  metricKey: MetricKey
  initial?: NumericFilter
  onDone: () => void
  onBack?: () => void
}> = ({ p, metricKey, initial, onDone, onBack }) => {
  const m = metric(metricKey)
  const values = metricValues(metricKey, p.channels, p.metricInputs)
  const [op, setOp] = useState<Op>(
    initial?.min !== undefined && initial?.max !== undefined
      ? "between"
      : initial?.max !== undefined
        ? "lte"
        : "gte",
  )
  const [a, setA] = useState(
    String(
      (op === "lte" ? initial?.max : initial?.min) ??
        Math.round(quantile(values, 0.5) * 100) / 100,
    ),
  )
  const [b, setB] = useState(String(initial?.max ?? ""))
  const min = op === "lte" ? undefined : parseBound(a)
  const max =
    op === "gte" ? undefined : op === "lte" ? parseBound(a) : parseBound(b)
  const matching = values.filter(
    (v) => (min === undefined || v >= min) && (max === undefined || v <= max),
  ).length
  return (
    <form
      className="space-y-2 p-1"
      onSubmit={(e) => {
        e.preventDefault()
        p.onNumericFiltersChange(
          withFilter(p.numericFilters, { metric: metricKey, min, max }),
        )
        onDone()
      }}
    >
      <div className="flex items-center gap-2 text-[11px] font-bold">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="text-app-ink/50 hover:text-app-ink"
          >
            ←
          </button>
        )}
        {m.label}
        {m.unit && (
          <span className="font-normal text-app-ink/45">{m.unit}</span>
        )}
      </div>
      <HistogramBrush
        values={values}
        min={min}
        max={max}
        onSelect={(lo, hi) => {
          if (lo !== undefined && hi !== undefined) {
            setOp("between")
            setA(String(lo))
            setB(String(hi))
          } else if (hi !== undefined) {
            setOp("lte")
            setA(String(hi))
          } else {
            setOp("gte")
            setA(lo === undefined ? "" : String(lo))
          }
        }}
      />
      <RangeHint values={values} />
      <div className="flex gap-1">
        {(
          [
            ["gte", "at least"],
            ["lte", "at most"],
            ["between", "between"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={op === key}
            onClick={() => setOp(key)}
            className={cn(
              "flex-1 rounded-md border px-2 py-1 text-[10px] font-semibold",
              op === key
                ? "border-app-ink bg-app-ink text-app-bg"
                : "border-app-ink/15 hover:border-app-ink/40",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={a}
          onChange={(e) => setA(e.target.value)}
          className="h-8 min-w-0 flex-1 rounded-md border border-app-ink/15 bg-app-card px-2 text-[11px] tabular-nums"
        />
        {op === "between" && (
          <>
            <span className="text-app-ink/40">and</span>
            <input
              type="number"
              value={b}
              onChange={(e) => setB(e.target.value)}
              className="h-8 min-w-0 flex-1 rounded-md border border-app-ink/15 bg-app-card px-2 text-[11px] tabular-nums"
            />
          </>
        )}
      </div>
      <TgButton type="submit" size="sm" className="w-full">
        {initial ? "Update" : "Add"} · {matching} of {values.length} measured
      </TgButton>
    </form>
  )
}

/**
 * "Metrics ▾" lists the numeric criteria, each with its current bound; picking
 * one opens its editor in place.
 */
export const FilterBuilder: React.FC<ChannelControlsProps> = (p) => {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<MetricKey | null>(null)
  const { shown, input } = useMetricSearch()
  const close = () => {
    setOpen(false)
    setPicked(null)
  }
  return (
    <Pop
      open={open}
      onOpenChange={(o) => (o ? setOpen(true) : close())}
      trigger={
        <TriggerButton label="Metrics" count={p.numericFilters.length} />
      }
      className="w-72"
    >
      {picked ? (
        <NumericEditor
          p={p}
          metricKey={picked}
          initial={p.numericFilters.find((f) => f.metric === picked)}
          onDone={close}
          onBack={() => setPicked(null)}
        />
      ) : (
        <>
          {input}
          <PopLabel>Filter by</PopLabel>
          {shown.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setPicked(m.key)}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[11px] font-semibold hover:bg-app-ink/5"
            >
              {m.label}
              <span className="text-[10px] tabular-nums text-app-ink/50">
                {boundText(p.numericFilters.find((f) => f.metric === m.key))}
              </span>
            </button>
          ))}
        </>
      )}
    </Pop>
  )
}

/**
 * Every filter in force, whatever set it, each with its own ×, and one
 * "Clear all". Shown whenever anything filters the grid, selection or not.
 */
export const ActiveFiltersBar: React.FC<
  ChannelControlsProps & { editableNumbers?: boolean }
> = ({ editableNumbers, ...p }) => {
  const groupName = (id: string) =>
    p.groups.find((g) => g.id === id)?.name ?? id
  const languageName = (code: string) =>
    p.allLanguages.find((l) => l.code === code)?.name ?? code
  const tagName = (id: string) =>
    p.pseudoTagChips.find((c) => c.id === id)?.label ?? id
  const count =
    p.groupFilters.length +
    p.tagFilters.length +
    p.languageFilters.length +
    p.numericFilters.length +
    (p.channelSearch.trim() ? 1 : 0)
  if (count === 0) return null
  const clearAll = () => {
    p.onChannelSearchChange("")
    p.onGroupFiltersChange([])
    p.onTagFiltersChange([])
    p.onLanguageFiltersChange([])
    p.onNumericFiltersChange([])
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-app-ink/10 bg-app-muted/30 px-3 py-2">
      <span className="mr-1 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-app-ink/45">
        <Search size={10} />
        {p.filteredCount} of {p.totalCount}
      </span>
      {p.channelSearch.trim() && (
        <Chip kind="Search" onClear={() => p.onChannelSearchChange("")}>
          “{p.channelSearch}”
        </Chip>
      )}
      {p.groupFilters.map((id) => (
        <Chip
          key={`g-${id}`}
          kind="Group"
          onClear={() =>
            p.onGroupFiltersChange(p.groupFilters.filter((x) => x !== id))
          }
        >
          {groupName(id)}
        </Chip>
      ))}
      {p.tagFilters.map((id) => (
        <Chip
          key={`t-${id}`}
          kind="Tag"
          onClear={() =>
            p.onTagFiltersChange(p.tagFilters.filter((x) => x !== id))
          }
        >
          {tagName(id)}
        </Chip>
      ))}
      {p.languageFilters.map((code) => (
        <Chip
          key={`l-${code}`}
          kind="Language"
          onClear={() =>
            p.onLanguageFiltersChange(
              p.languageFilters.filter((x) => x !== code),
            )
          }
        >
          {languageName(code)}
        </Chip>
      ))}
      {p.numericFilters.map((f) => {
        const clear = () =>
          p.onNumericFiltersChange(withoutMetric(p.numericFilters, f.metric))
        return editableNumbers ? (
          <EditableNumberChip key={f.metric} p={p} filter={f} onClear={clear} />
        ) : (
          <Chip key={f.metric} kind="Number" onClear={clear}>
            {describeFilter(f)}
          </Chip>
        )
      })}
      <button
        type="button"
        onClick={clearAll}
        className="ml-auto inline-flex h-6 items-center gap-1 rounded-md px-2 text-[10px] font-bold text-app-ink/60 hover:bg-app-ink/10 hover:text-app-ink"
      >
        <X size={11} /> Clear all{count > 1 ? ` ${count}` : ""}
      </button>
    </div>
  )
}

const chipClass =
  "inline-flex h-6 items-center gap-1 rounded-full border border-app-ink/15 bg-app-card pl-2.5 pr-1 text-[10px] font-semibold"

const Chip: React.FC<{
  kind: string
  onClear: () => void
  children: React.ReactNode
}> = ({ kind, onClear, children }) => (
  <span className={chipClass}>
    <span className="text-app-ink/45">{kind}</span>
    {children}
    <button
      type="button"
      aria-label={`Remove ${kind} filter`}
      onClick={onClear}
      className="grid h-4 w-4 place-items-center rounded-full hover:bg-app-ink/15"
    >
      <X size={10} />
    </button>
  </span>
)

/** A numeric chip reopens its editor when clicked. */
const EditableNumberChip: React.FC<{
  p: ChannelControlsProps
  filter: NumericFilter
  onClear: () => void
}> = ({ p, filter, onClear }) => {
  const [open, setOpen] = useState(false)
  return (
    <span className={chipClass}>
      <Pop
        open={open}
        onOpenChange={setOpen}
        trigger={
          <button type="button" className="hover:underline">
            {describeFilter(filter)}
          </button>
        }
        className="w-72"
      >
        <NumericEditor
          p={p}
          metricKey={filter.metric}
          initial={filter}
          onDone={() => setOpen(false)}
        />
      </Pop>
      <button
        type="button"
        aria-label="Remove filter"
        onClick={onClear}
        className="grid h-4 w-4 place-items-center rounded-full hover:bg-app-ink/15"
      >
        <X size={10} />
      </button>
    </span>
  )
}
