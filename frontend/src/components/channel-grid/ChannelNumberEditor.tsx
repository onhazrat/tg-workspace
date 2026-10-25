import { useMemo } from "react"
import { NumberBoundEditor } from "@/components/filter-tree/NumberBoundEditor"
import {
  type MetricBound,
  type MetricData,
  type MetricKey,
  metric,
} from "@/lib/channels/channel-metrics"

/**
 * A number Condition's editor (CTB-02): the one Number bound editor over the
 * Account's Channels' values, counted out of every Channel.
 */
export function ChannelNumberEditor({
  metricKey,
  data,
  ...rest
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
  return (
    <NumberBoundEditor
      label={m.label}
      unit={m.unit}
      source={{ kind: "values", values, total: data.total }}
      noun="channels"
      {...rest}
    />
  )
}
