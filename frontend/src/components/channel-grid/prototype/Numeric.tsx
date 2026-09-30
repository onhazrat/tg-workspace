/**
 * PROTOTYPE, throwaway: three ways to filter on numbers (N1 range menu, N2
 * filter builder, N3 percentile buckets), and the active-filters bar they share.
 * One bound per metric; setting a metric again replaces its bound.
 */
import { ChevronDown, Plus, Search, SlidersHorizontal, X } from "lucide-react"
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

/** 24 bins across the known range, the part inside the bound drawn solid. */
const Histogram: React.FC<{ values: number[]; min?: number; max?: number }> = ({
  values,
  min,
  max,
}) => {
  if (values.length === 0)
    return <div className="h-6 text-[9px] text-app-ink/40">no data</div>
  const lo = values[0]
  const hi = values[values.length - 1]
  const bins = new Array(24).fill(0)
  const binOf = (v: number) =>
    hi === lo ? 0 : Math.min(23, Math.floor(((v - lo) / (hi - lo)) * 24))
  for (const v of values) bins[binOf(v)]++
  const peak = Math.max(...bins)
  return (
    <div className="flex h-6 items-end gap-px">
      {bins.map((n, i) => {
        const binLo = lo + ((hi - lo) * i) / 24
        const binHi = lo + ((hi - lo) * (i + 1)) / 24
        const inside =
          (min === undefined || binHi >= min) &&
          (max === undefined || binLo <= max)
        return (
          <div
            key={i}
            className={cn(
              "flex-1 rounded-t-[1px]",
              inside ? "bg-app-ink/60" : "bg-app-ink/15",
            )}
            style={{
              height: `${n === 0 ? 0 : Math.max(8, (n / peak) * 100)}%`,
            }}
          />
        )
      })}
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

const MinMax: React.FC<{
  filter?: NumericFilter
  values: number[]
  onChange: (min?: number, max?: number) => void
}> = ({ filter, values, onChange }) => (
  <div className="flex items-center gap-1">
    <input
      type="number"
      aria-label="Minimum"
      value={filter?.min ?? ""}
      placeholder={values.length ? `min ${formatNumber(values[0])}` : "min"}
      onChange={(e) => onChange(parseBound(e.target.value), filter?.max)}
      className="h-7 w-24 rounded-md border border-app-ink/15 bg-app-card px-2 text-[11px] tabular-nums"
    />
    <span className="text-app-ink/40">–</span>
    <input
      type="number"
      aria-label="Maximum"
      value={filter?.max ?? ""}
      placeholder={
        values.length ? `max ${formatNumber(values[values.length - 1])}` : "max"
      }
      onChange={(e) => onChange(filter?.min, parseBound(e.target.value))}
      className="h-7 w-24 rounded-md border border-app-ink/15 bg-app-card px-2 text-[11px] tabular-nums"
    />
  </div>
)

/** N1: every metric at once, each with its distribution and a min/max pair. */
export const RangeMenu: React.FC<ChannelControlsProps> = (p) => {
  const { shown, input } = useMetricSearch()
  return (
    <Pop
      trigger={
        <TriggerButton label="Numbers" count={p.numericFilters.length} />
      }
      className="w-[26rem]"
    >
      {input}
      <div className="flex items-center justify-between px-2 pb-1 pt-1 text-[9px] font-bold uppercase tracking-widest text-app-ink/45">
        <span>{p.filteredCount} channels match</span>
        {p.numericFilters.length > 0 && (
          <button
            type="button"
            onClick={() => p.onNumericFiltersChange([])}
            className="normal-case tracking-normal text-app-ink/60 hover:text-app-ink"
          >
            Clear numbers
          </button>
        )}
      </div>
      {shown.map((m) => {
        const values = metricValues(m.key, p.channels, p.metricInputs)
        const f = p.numericFilters.find((x) => x.metric === m.key)
        return (
          <div
            key={m.key}
            className={cn(
              "space-y-1 rounded-md px-2 py-2",
              f ? "bg-app-ink/5" : "hover:bg-app-ink/[0.03]",
            )}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-semibold">
                {m.label}
                {m.unit && (
                  <span className="ml-1 font-normal text-app-ink/45">
                    {m.unit}
                  </span>
                )}
              </span>
              <RangeHint values={values} />
            </div>
            <Histogram values={values} min={f?.min} max={f?.max} />
            <div className="flex items-center justify-between">
              <MinMax
                filter={f}
                values={values}
                onChange={(min, max) =>
                  p.onNumericFiltersChange(
                    withFilter(p.numericFilters, { metric: m.key, min, max }),
                  )
                }
              />
              {f && (
                <button
                  type="button"
                  aria-label={`Clear ${m.label}`}
                  onClick={() =>
                    p.onNumericFiltersChange(
                      withoutMetric(p.numericFilters, m.key),
                    )
                  }
                  className="grid h-6 w-6 place-items-center rounded hover:bg-app-ink/10"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          </div>
        )
      })}
    </Pop>
  )
}

type Op = "gte" | "lte" | "between"

/** N2's editor: one metric, an operator, a value or two. */
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
      <Histogram values={values} min={min} max={max} />
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

/** N2: "+ Filter" picks a criterion, then an operator and a value. */
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
        <button type="button" className={trigger}>
          <Plus size={13} />
          Filter
        </button>
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
              {p.numericFilters.some((f) => f.metric === m.key) && (
                <span className="text-[9px] text-app-ink/45">set</span>
              )}
            </button>
          ))}
        </>
      )}
    </Pop>
  )
}

const BUCKETS: { note: string; lo?: number; hi?: number }[] = [
  { note: "top 10%", lo: 0.9 },
  { note: "top 25%", lo: 0.75 },
  { note: "middle 50%", lo: 0.25, hi: 0.75 },
  { note: "bottom 25%", hi: 0.25 },
  { note: "bottom 10%", hi: 0.1 },
]

/** N3: relative buckets per metric, turned into numbers when picked. */
export const BucketMenu: React.FC<ChannelControlsProps> = (p) => {
  const { shown, input } = useMetricSearch()
  const [custom, setCustom] = useState<MetricKey | null>(null)
  return (
    <Pop
      trigger={<TriggerButton label="Ranges" count={p.numericFilters.length} />}
      className="w-[28rem]"
    >
      {input}
      <PopLabel>Relative to the channels you follow</PopLabel>
      {shown.map((m) => {
        const values = metricValues(m.key, p.channels, p.metricInputs)
        const f = p.numericFilters.find((x) => x.metric === m.key)
        const set = (next?: NumericFilter) =>
          p.onNumericFiltersChange(
            next
              ? withFilter(p.numericFilters, next)
              : withoutMetric(p.numericFilters, m.key),
          )
        return (
          <div key={m.key} className="rounded-md px-2 py-1.5">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-[11px] font-semibold">{m.label}</span>
              <RangeHint values={values} />
            </div>
            <div className="flex flex-wrap gap-1">
              <Bucket on={!f} onClick={() => set()}>
                any
              </Bucket>
              {BUCKETS.map((b) => (
                <Bucket
                  key={b.note}
                  on={f?.note === b.note}
                  disabled={values.length === 0}
                  onClick={() =>
                    set({
                      metric: m.key,
                      note: b.note,
                      min:
                        b.lo === undefined ? undefined : quantile(values, b.lo),
                      max:
                        b.hi === undefined ? undefined : quantile(values, b.hi),
                    })
                  }
                >
                  {b.note}
                </Bucket>
              ))}
              <Bucket
                on={custom === m.key || (!!f && !f.note)}
                onClick={() => setCustom(custom === m.key ? null : m.key)}
              >
                custom…
              </Bucket>
            </div>
            {custom === m.key && (
              <div className="mt-1.5">
                <MinMax
                  filter={f?.note ? undefined : f}
                  values={values}
                  onChange={(min, max) => set({ metric: m.key, min, max })}
                />
              </div>
            )}
          </div>
        )
      })}
    </Pop>
  )
}

const Bucket: React.FC<{
  on: boolean
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}> = ({ on, onClick, disabled, children }) => (
  <button
    type="button"
    aria-pressed={on}
    disabled={disabled}
    onClick={onClick}
    className={cn(
      "rounded-full border px-2.5 py-0.5 text-[10px] font-semibold disabled:opacity-30",
      on
        ? "border-app-ink bg-app-ink text-app-bg"
        : "border-app-ink/15 hover:border-app-ink/40",
    )}
  >
    {children}
  </button>
)

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

/** N2: a numeric chip reopens its editor when clicked. */
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
