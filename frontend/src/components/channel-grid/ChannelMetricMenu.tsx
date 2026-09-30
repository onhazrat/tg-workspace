import { ChevronDown, SlidersHorizontal } from "lucide-react"
import { useState } from "react"
import { pillClass } from "@/components/PostFilterParts"
import type { MetricCond } from "@/lib/channels/channel-filter"
import {
  boundText,
  METRICS,
  type MetricBound,
  type MetricKey,
} from "@/lib/channels/channel-metrics"
import { BarHeading, BarPopover, BarSearch } from "./BarPopover"
import { ChannelMetricEditor, type MetricData } from "./ChannelMetricEditor"

/**
 * The Filters dropdown (CTB-02): every number criterion with its bounds in
 * the Channel filter, a search over them, and picking one opens its editor.
 * Adding always makes a new Condition, so one criterion can be bound twice.
 */
export function ChannelMetricMenu({
  conditions,
  data,
  onAdd,
}: {
  /** The number Conditions anywhere in the Channel filter. */
  conditions: MetricCond[]
  data: MetricData
  onAdd: (cond: MetricCond) => void
}) {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<MetricKey | null>(null)
  const [query, setQuery] = useState("")
  const active = conditions.length > 0
  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setPicked(null)
  }
  const add = (metric: MetricKey, bound: MetricBound) => {
    onAdd({ type: "metric", metric, ...bound })
    onOpenChange(false)
  }
  return (
    <BarPopover
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <button
          type="button"
          data-testid="channel-filters"
          data-active={active}
          className={pillClass(active)}
        >
          <SlidersHorizontal size={12} /> Filters
          {active && (
            <span className="rounded-full bg-app-bg/20 px-1.5 text-[10px] tabular-nums">
              {conditions.length}
            </span>
          )}
          <ChevronDown size={12} className="opacity-60" />
        </button>
      }
    >
      {picked ? (
        <ChannelMetricEditor
          metricKey={picked}
          data={data}
          onSubmit={(bound) => add(picked, bound)}
          onBack={() => setPicked(null)}
        />
      ) : (
        <>
          <BarSearch
            value={query}
            onChange={setQuery}
            placeholder="Search criteria..."
          />
          <BarHeading>Filter by</BarHeading>
          {METRICS.filter((m) =>
            m.label.toLowerCase().includes(query.trim().toLowerCase()),
          ).map((m) => (
            <button
              key={m.key}
              type="button"
              data-testid={`channel-filters-${m.key}`}
              onClick={() => setPicked(m.key)}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left font-semibold hover:bg-app-ink/5"
            >
              {m.label}
              <span className="text-[11px] font-normal tabular-nums text-app-ink/50">
                {conditions
                  .filter((c) => c.metric === m.key)
                  .map(boundText)
                  .join(", ")}
              </span>
            </button>
          ))}
        </>
      )}
    </BarPopover>
  )
}
