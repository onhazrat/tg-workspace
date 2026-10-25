import { useMemo, useState } from "react"
import { BoundFields } from "@/components/filter-tree/BoundFields"
import { NumberSpread } from "@/components/filter-tree/NumberSpread"
import { useZoomState } from "@/components/SpreadZoom"
import { TgButton } from "@/components/ui/tg-button"
import {
  type BoundKind,
  boundKind,
  inBound,
  type MetricBound,
  type MetricData,
  type MetricKey,
  metric,
  parseBound,
} from "@/lib/channels/channel-metrics"
import { binSpread, median, nice } from "@/lib/spread"

/**
 * One number criterion's editor (CTB-02): a Spread of the Account's
 * Channels that a drag across sets the bound from, the operator, one or two
 * fields, and how many Channels the bound keeps before it is added.
 */
export function ChannelMetricEditor({
  metricKey,
  data,
  initial,
  onSubmit,
  onBack,
}: {
  metricKey: MetricKey
  data: MetricData
  /** The Condition being changed; without one the editor adds. */
  initial?: MetricBound
  onSubmit: (bound: MetricBound) => void
  onBack?: () => void
}) {
  const m = metric(metricKey)
  const values = useMemo(() => data.values(metricKey), [data, metricKey])
  const [op, setOp] = useState<BoundKind>(boundKind(initial))
  const [a, setA] = useState(() => {
    const start = op === "lte" ? initial?.max : initial?.min
    return String(start ?? (values.length ? nice(median(values)) : ""))
  })
  const [b, setB] = useState(String(initial?.max ?? ""))
  const bound = parseBound(op, a, b)
  const zoom = useZoomState()
  const kept = !bound
    ? 0
    : bound.none
      ? data.total - values.length
      : values.filter((v) => inBound(v, bound)).length
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
        if (bound) onSubmit(bound)
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
        {m.label}
        {m.unit && (
          <span className="font-normal text-app-ink/50">{m.unit}</span>
        )}
      </div>
      {values.length > 0 ? (
        <NumberSpread
          bars={binSpread(values, zoom.range)}
          zoom={zoom}
          bound={bound}
          onPick={select}
          noun="channels"
          title={m.label}
        />
      ) : (
        <p className="text-[11px] text-app-ink/50">
          None of your channels has a value yet.
        </p>
      )}
      <BoundFields op={op} setOp={setOp} a={a} setA={setA} b={b} setB={setB} />
      <p className="text-[11px] text-app-ink/50">
        A channel with no {m.label.toLowerCase()} does not match a bound.
        {op === "none"
          ? " No value finds exactly those channels, and NOT on it the ones that have one."
          : " Choose no value to find them."}
      </p>
      <TgButton
        type="submit"
        size="sm"
        disabled={!bound}
        data-testid="metric-editor-submit"
        className="w-full"
      >
        {initial ? "Update" : "Add"} ·{" "}
        {op === "none"
          ? `${kept} with no value`
          : `${kept} of ${values.length} measured`}
      </TgButton>
    </form>
  )
}
