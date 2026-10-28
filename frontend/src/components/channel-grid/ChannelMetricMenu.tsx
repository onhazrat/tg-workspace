import { ChevronDown, Clock, Hash, SlidersHorizontal } from "lucide-react"
import { useState } from "react"
import {
  BarHeading,
  BarPopover,
  BarSearch,
  MenuRowLabel,
} from "@/components/BarPopover"
import { isProto } from "@/components/channel-tags-prototype/store"
import { pillClass } from "@/components/PostFilterParts"
import type { Cond, MetricAtom, TimeAtom } from "@/lib/channels/channel-filter"
import {
  boundText,
  isMetricKey,
  METRICS,
  type MetricData,
  type MetricKey,
} from "@/lib/channels/channel-metrics"
import {
  CHANNEL_MOMENTS,
  type ChannelMomentKey,
} from "@/lib/channels/channel-moments"
import { ChannelNumberEditor } from "./ChannelNumberEditor"
import { ChannelTimeEditor } from "./ChannelTimeEditor"

const rowClass =
  "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left font-semibold hover:bg-app-ink/5"

/**
 * The Filters dropdown (CTB-02): every number criterion with its bounds in
 * the Channel filter, then every moment under Times (TB-03), a search over
 * them, and picking one opens its editor. Adding always makes a new
 * Condition, so one criterion can be bound twice.
 */
export function ChannelMetricMenu({
  conditions,
  data,
  onAdd,
  presets,
}: {
  /** PROTOTYPE (channel-tags-usage, B): one-click filters at the top. */
  presets?: { label: string; onPick: () => void }[]
  /** The number and Time bound Conditions anywhere in the Channel filter. */
  conditions: (MetricAtom | TimeAtom)[]
  data: MetricData
  onAdd: (cond: Cond) => void
}) {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<MetricKey | ChannelMomentKey | null>(
    null,
  )
  const [query, setQuery] = useState("")
  const active = conditions.length > 0
  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setPicked(null)
  }
  const add = (cond: Cond) => {
    onAdd(cond)
    onOpenChange(false)
  }
  const matches = (label: string) =>
    label.toLowerCase().includes(query.trim().toLowerCase())
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
      {picked && isMetricKey(picked) ? (
        <ChannelNumberEditor
          metricKey={picked}
          data={data}
          onSubmit={(bound) =>
            add({ type: "metric", metric: picked, ...bound })
          }
          onBack={() => setPicked(null)}
        />
      ) : picked ? (
        <ChannelTimeEditor
          momentKey={picked}
          data={data}
          onSubmit={add}
          onBack={() => setPicked(null)}
        />
      ) : (
        <>
          <BarSearch
            value={query}
            onChange={setQuery}
            placeholder="Search criteria..."
          />
          {presets && presets.length > 0 && (
            <>
              <BarHeading>Presets</BarHeading>
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    preset.onPick()
                    onOpenChange(false)
                  }}
                  className={rowClass}
                >
                  <MenuRowLabel icon={Clock} label={preset.label} />
                </button>
              ))}
            </>
          )}
          <BarHeading>Filter by</BarHeading>
          {METRICS.filter((m) => matches(m.label)).map((m) => (
            <button
              key={m.key}
              type="button"
              data-testid={`channel-filters-${m.key}`}
              onClick={() => setPicked(m.key)}
              className={rowClass}
            >
              <MenuRowLabel icon={Hash} label={m.label} />
              <span className="text-[11px] font-normal tabular-nums text-app-ink/50">
                {conditions
                  .flatMap((a) =>
                    a.cond.type === "metric" && a.cond.metric === m.key
                      ? [`${a.not ? "not " : ""}${boundText(a.cond)}`]
                      : [],
                  )
                  .join(", ")}
              </span>
            </button>
          ))}
          <BarHeading>Times</BarHeading>
          {CHANNEL_MOMENTS.filter(
            (m) => (isProto() || m.key !== "last_post_at") && matches(m.label),
          ).map((m) => (
            <button
              key={m.key}
              type="button"
              data-testid={`channel-filters-time-${m.key}`}
              onClick={() => setPicked(m.key)}
              className={rowClass}
            >
              <MenuRowLabel icon={Clock} label={m.label} />
            </button>
          ))}
        </>
      )}
    </BarPopover>
  )
}
