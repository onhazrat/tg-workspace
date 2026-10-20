import { ChevronDown, Clock, Hash, SlidersHorizontal } from "lucide-react"
import { useState } from "react"
import { BarHeading, BarPopover, BarSearch } from "@/components/BarPopover"
import { pillClass } from "@/components/PostFilterParts"
import { MenuRowLabel } from "@/components/time-bound-prototype/MenuRowLabel"
import { useIsVariant1 } from "@/components/time-bound-prototype/variant"
import type {
  Cond,
  MetricAtom,
  MetricCond,
} from "@/lib/channels/channel-filter"
import {
  boundText,
  METRICS,
  type MetricBound,
  type MetricData,
  type MetricKey,
} from "@/lib/channels/channel-metrics"
import {
  CHANNEL_MOMENTS,
  type ChannelMomentKey,
} from "@/lib/channels/channel-moments"
import { ChannelMetricEditor } from "./ChannelMetricEditor"
import { ChannelTimeEditor } from "./ChannelTimeEditor"

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
  conditions: MetricAtom[]
  data: MetricData
  onAdd: (cond: MetricCond | Cond) => void
}) {
  const v1 = useIsVariant1()
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<MetricKey | null>(null)
  const [moment, setMoment] = useState<ChannelMomentKey | null>(null)
  const [query, setQuery] = useState("")
  const active = conditions.length > 0
  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setPicked(null)
      setMoment(null)
    }
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
      {moment ? (
        <ChannelTimeEditor
          momentKey={moment}
          channels={data.channels ?? []}
          onSubmit={(cond) => {
            onAdd(cond)
            onOpenChange(false)
          }}
          onBack={() => setMoment(null)}
        />
      ) : picked ? (
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
          {METRICS.filter(
            (m) =>
              m.label.toLowerCase().includes(query.trim().toLowerCase()) &&
              !(
                v1 &&
                (m.key === "days_since_update" || m.key === "days_followed")
              ),
          ).map((m) => (
            <button
              key={m.key}
              type="button"
              data-testid={`channel-filters-${m.key}`}
              onClick={() => setPicked(m.key)}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left font-semibold hover:bg-app-ink/5"
            >
              {v1 ? <MenuRowLabel icon={Hash} label={m.label} /> : m.label}
              <span className="text-[11px] font-normal tabular-nums text-app-ink/50">
                {conditions
                  .filter((a) => a.cond.metric === m.key)
                  .map((a) => `${a.not ? "not " : ""}${boundText(a.cond)}`)
                  .join(", ")}
              </span>
            </button>
          ))}
          {v1 && <BarHeading>Times</BarHeading>}
          {v1 &&
            CHANNEL_MOMENTS.filter((m) =>
              m.label.toLowerCase().includes(query.trim().toLowerCase()),
            ).map((m) => (
              <button
                key={m.key}
                type="button"
                data-testid={`channel-filters-time-${m.key}`}
                onClick={() => setMoment(m.key)}
                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left font-semibold hover:bg-app-ink/5"
              >
                <MenuRowLabel icon={Clock} label={m.label} />
              </button>
            ))}
        </>
      )}
    </BarPopover>
  )
}
