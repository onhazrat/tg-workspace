/**
 * PROTOTYPE (variant A): a Posts filter editor's histogram, drawn by the
 * Channels tab's `BoundHistogram` from bars the server bins (`POST
 * /data/posts/value-histogram`), over the window with the filters aside.
 *
 * The fetch arrives by context from `PostFeed`, which has the scope; without
 * it (the filter bar rendered alone, as its tests do) nothing is drawn.
 */
import { useQuery } from "@tanstack/react-query"
import { createContext, useContext } from "react"
import type { PostValueHistogramResponse } from "@/client"
import {
  BoundHistogram,
  type Distribution,
} from "@/components/filter-tree/BarHistogram"
import type { MetricBound } from "@/lib/channels/channel-metrics"

export type HistogramMeasure = "views" | "estimated" | "channel_posts"

export const ValueHistogramContext = createContext<{
  /** What the fetch depends on, for the query key. */
  key: unknown[]
  fetch: (measure: HistogramMeasure) => Promise<PostValueHistogramResponse>
} | null>(null)

export function PostValueHistogram(props: {
  measure: HistogramMeasure
  bound: MetricBound | null
  onSelect: (bound: MetricBound) => void
}) {
  const source = useContext(ValueHistogramContext)
  return source ? <Loaded source={source} {...props} /> : null
}

function Loaded({
  source,
  measure,
  bound,
  onSelect,
}: {
  source: NonNullable<React.ContextType<typeof ValueHistogramContext>>
  measure: HistogramMeasure
  bound: MetricBound | null
  onSelect: (bound: MetricBound) => void
}) {
  const query = useQuery({
    queryKey: ["proto-value-histogram", measure, ...source.key],
    queryFn: () => source.fetch(measure),
    placeholderData: (previous) => previous,
  })
  const d = query.data
  if (!d) return <p className="h-16 text-[11px] text-app-ink/50">Counting…</p>
  if (!d.measured)
    return (
      <p className="text-[11px] text-app-ink/50">
        Nothing in this window has a value yet.
      </p>
    )
  const distribution: Distribution = {
    bins: d.bins,
    edge: (i) => d.edges[i],
    lo: d.edges[0],
    hi: d.edges[d.edges.length - 1],
    median: d.median ?? 0,
    log: d.log,
  }
  return (
    <BoundHistogram
      distribution={distribution}
      bound={bound}
      noun={measure === "channel_posts" ? "channels" : "posts"}
      onSelect={onSelect}
    />
  )
}
