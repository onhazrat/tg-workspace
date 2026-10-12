/**
 * PROTOTYPE (variant A): the filtered Posts over time, in the Analysis window
 * editor, drawn by the same `BarHistogram` as the filter editors. The window's
 * bars are solid, the context around it light; drag across the bars to set a
 * Fixed window, click one bar to take just that bucket.
 */
import { useQuery } from "@tanstack/react-query"
import { useContext, useState } from "react"
import { shownPostsBody } from "@/api/data"
import { type DataPostsHistogramData, dataPostsHistogram } from "@/client"
import { BarHistogram } from "@/components/filter-tree/BarHistogram"
import { useScope } from "@/contexts/ScopeContext"
import { useScraper } from "@/contexts/ScraperContext"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { useSelectedChannelNames } from "@/hooks/usePostsView"
import { spotlightView } from "@/lib/posts/channel-spotlight"
import { printPostFilter } from "@/lib/posts/post-filter"
import { FeedPagingContext } from "./variant"

const BUCKETS = 60
const DAY = 86_400_000

const fmt = (ms: number, span: number) =>
  new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    ...(span < 3 * DAY ? { hour: "2-digit", minute: "2-digit" } : {}),
  })

export function WindowHistogram() {
  const feed = useContext(FeedPagingContext)
  const { startDate, endDate, setFixedRange } = useScope()
  const {
    postFilter,
    postSearch,
    maxPostsPerChannel,
    viewMeasure,
    postSortOrder,
  } = useScraper()
  const keyword = useDebouncedValue(postSearch, 300)
  const view = spotlightView(feed?.spotlight ?? null, {
    channelNames: useSelectedChannelNames(),
    keyword,
    filter: postFilter,
    maxPerChannel: maxPostsPerChannel,
    groupByChannel: false,
  })
  const [zoom, setZoom] = useState(0)
  const [now] = useState(Date.now)

  // The window plus context: three window spans (x3 per zoom-out), the window
  // centred, never past now.
  const span = Math.max(endDate - startDate, 60_000)
  const extentSpan = span * 3 * 3 ** zoom
  const extentEnd = Math.min(
    Math.max(now, endDate),
    endDate + (extentSpan - span) / 2,
  )
  const extentStart = Math.round(extentEnd - extentSpan)
  const width = extentSpan / BUCKETS

  const query = useQuery({
    queryKey: [
      "proto-histogram",
      view.channelNames,
      view.keyword,
      printPostFilter(view.filter),
      viewMeasure,
      startDate,
      endDate,
      zoom,
    ],
    queryFn: async () =>
      (
        await dataPostsHistogram({
          body: {
            ...shownPostsBody({
              channelNames: view.channelNames,
              keyword: view.keyword,
              filter: view.filter,
              viewMeasure,
              sort: postSortOrder,
              startDate,
              endDate,
            }),
            extentStart,
            extentEnd: Math.round(extentEnd),
            buckets: BUCKETS,
          } as DataPostsHistogramData["body"],
        })
      ).counts,
    placeholderData: (previous) => previous,
  })
  const counts = query.data ?? []
  const max = Math.max(1, ...counts)

  const inWindow = (i: number) => {
    const t = extentStart + i * width
    return t + width > startDate && t < endDate
  }
  const total = counts.reduce((a, b) => a + b, 0)

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-app-ink/50">
        <span>
          Posts over time{query.isFetching ? " …" : ""} ·{" "}
          {total.toLocaleString()}
        </span>
        <span className="flex gap-1">
          <button
            type="button"
            className="rounded border border-app-ink/15 px-1.5 hover:bg-app-ink/5 disabled:opacity-30"
            disabled={zoom === 0}
            onClick={() => setZoom((z) => z - 1)}
          >
            zoom in
          </button>
          <button
            type="button"
            className="rounded border border-app-ink/15 px-1.5 hover:bg-app-ink/5"
            onClick={() => setZoom((z) => z + 1)}
          >
            zoom out
          </button>
        </span>
      </div>
      <BarHistogram
        testIdPrefix="window"
        bins={counts}
        solid={inWindow}
        onSelect={(run) =>
          setFixedRange(
            Math.round(extentStart + Math.min(run.from, run.to) * width),
            Math.round(extentStart + (Math.max(run.from, run.to) + 1) * width),
          )
        }
        caption={(shown) => [
          fmt(extentStart, extentSpan),
          shown !== null && counts[shown] !== undefined
            ? `${counts[shown].toLocaleString()} posts, ${fmt(extentStart + shown * width, extentSpan)}`
            : "drag to set the window",
          fmt(extentEnd, extentSpan),
        ]}
      />
    </div>
  )
}
