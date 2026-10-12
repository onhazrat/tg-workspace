/**
 * PROTOTYPE (variant A): the filtered Posts over time, in the Analysis window
 * editor. The window's bars are dark, the context around it light; drag across
 * the bars to set a Fixed window, click one bar to take just that bucket.
 */
import { useQuery } from "@tanstack/react-query"
import { useContext, useRef, useState } from "react"
import { shownPostsBody } from "@/api/data"
import { type DataPostsHistogramData, dataPostsHistogram } from "@/client"
import { useScope } from "@/contexts/ScopeContext"
import { useScraper } from "@/contexts/ScraperContext"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { useSelectedChannelNames } from "@/hooks/usePostsView"
import { spotlightView } from "@/lib/posts/channel-spotlight"
import { printPostFilter } from "@/lib/posts/post-filter"
import { FeedPagingContext } from "./variant"

const BUCKETS = 60
const W = 400
const H = 64
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

  const svg = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const bucketAt = (clientX: number) => {
    const box = svg.current?.getBoundingClientRect()
    if (!box) return 0
    const x = ((clientX - box.left) / box.width) * BUCKETS
    return Math.min(BUCKETS - 1, Math.max(0, Math.floor(x)))
  }
  const bw = W / BUCKETS
  const inWindow = (i: number) => {
    const t = extentStart + i * width
    return t + width > startDate && t < endDate
  }
  const lo = drag ? Math.min(drag.from, drag.to) : null
  const hi = drag ? Math.max(drag.from, drag.to) : null
  const total = counts.reduce((a, b) => a + b, 0)

  return (
    <div className="mt-3 space-y-1">
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
      <div className="relative">
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block h-16 w-full cursor-crosshair touch-none select-none"
          role="img"
          aria-label="Posts over time; drag to choose a window"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            const i = bucketAt(e.clientX)
            setDrag({ from: i, to: i })
          }}
          onPointerMove={(e) => {
            const i = bucketAt(e.clientX)
            setHover(i)
            if (drag) setDrag({ ...drag, to: i })
          }}
          onPointerLeave={() => setHover(null)}
          onPointerUp={() => {
            if (lo !== null && hi !== null)
              setFixedRange(
                Math.round(extentStart + lo * width),
                Math.round(extentStart + (hi + 1) * width),
              )
            setDrag(null)
          }}
        >
          <line
            x1={0}
            x2={W}
            y1={H - 0.5}
            y2={H - 0.5}
            className="stroke-app-ink/15"
          />
          {counts.map((n, i) => {
            const h = n === 0 ? 0 : Math.max(2, (n / max) * (H - 4))
            const picked = lo !== null && hi !== null && i >= lo && i <= hi
            return (
              <rect
                // biome-ignore lint/suspicious/noArrayIndexKey: buckets are positional
                key={i}
                x={i * bw + 1}
                y={H - h}
                width={Math.max(1, bw - 2)}
                height={h}
                rx={1.5}
                className={
                  picked
                    ? "fill-blue-500"
                    : inWindow(i)
                      ? "fill-app-ink/70"
                      : "fill-app-ink/20"
                }
              />
            )
          })}
          {hover !== null && (
            <rect
              x={hover * bw}
              y={0}
              width={bw}
              height={H}
              className="fill-app-ink/5"
            />
          )}
        </svg>
        {hover !== null && counts[hover] !== undefined && (
          <div
            className="pointer-events-none absolute -top-7 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-app-ink px-1.5 py-0.5 text-[10px] text-app-bg tabular-nums"
            style={{ left: `${((hover + 0.5) / BUCKETS) * 100}%` }}
          >
            {fmt(extentStart + hover * width, extentSpan)} ·{" "}
            {counts[hover].toLocaleString()} posts
          </div>
        )}
      </div>
      <div className="flex justify-between text-[10px] tabular-nums text-app-ink/50">
        <span>{fmt(extentStart, extentSpan)}</span>
        <span>{fmt(extentEnd, extentSpan)}</span>
      </div>
    </div>
  )
}
