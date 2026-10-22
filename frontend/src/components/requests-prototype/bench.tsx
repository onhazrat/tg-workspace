// PROTOTYPE (request-stats): the sparkline bench. 300 Channels, one sparkline each, in a
// virtualized list, drawn by Recharts, ECharts or Plotly, timed in this browser. Never merge.
import { useQuery } from "@tanstack/react-query"
import { useVirtualizer } from "@tanstack/react-virtual"
import { LineChart as ELineChart } from "echarts/charts"
import { GridComponent } from "echarts/components"
import * as echarts from "echarts/core"
import { CanvasRenderer } from "echarts/renderers"
import ReactEChartsCoreModule from "echarts-for-react/lib/core"
import Plotly from "plotly.js-dist-min"
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react"
import createPlotlyComponentModule from "react-plotly.js/factory"
import { Line, LineChart } from "recharts"
import { channelRows, fmt, LOADED_DAYS, loadModel } from "./data"
import { useResolvedColors } from "./shared"

echarts.use([ELineChart, GridComponent, CanvasRenderer])
// CommonJS again: unwrap `{ default }` the way the Plotly factory is unwrapped.
const ReactEChartsCore =
  (
    ReactEChartsCoreModule as unknown as {
      default?: typeof ReactEChartsCoreModule
    }
  ).default ?? ReactEChartsCoreModule
const createPlotlyComponent =
  (
    createPlotlyComponentModule as unknown as {
      default?: typeof createPlotlyComponentModule
    }
  ).default ?? createPlotlyComponentModule
const Plot = createPlotlyComponent(Plotly)

type Lib = "recharts" | "echarts" | "plotly"
const LIBS: { id: Lib; label: string }[] = [
  { id: "recharts", label: "Recharts" },
  { id: "echarts", label: "ECharts" },
  { id: "plotly", label: "Plotly" },
]
const W = 160
const H = 28
const ROW = 36
const COUNT = 300

interface Result {
  lib: Lib
  mode: string
  mountMs: number
  fps?: number
  worstFrameMs?: number
  longFrames?: number
  heapMb?: number
}

const heap = () =>
  (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    ?.usedJSHeapSize

const Spark = memo(function Spark({
  lib,
  values,
  color,
}: {
  lib: Lib
  values: number[]
  color: string
}) {
  if (lib === "recharts")
    return (
      <LineChart
        width={W}
        height={H}
        data={values.map((v) => ({ v }))}
        margin={{ top: 2, right: 2, bottom: 2, left: 2 }}
      >
        <Line
          dataKey="v"
          dot={false}
          stroke={color}
          strokeWidth={1.5}
          isAnimationActive={false}
        />
      </LineChart>
    )
  if (lib === "echarts")
    return (
      <ReactEChartsCore
        echarts={echarts}
        style={{ width: W, height: H }}
        option={{
          animation: false,
          grid: { left: 2, right: 2, top: 2, bottom: 2 },
          xAxis: { type: "category", show: false },
          yAxis: { type: "value", show: false, scale: true },
          series: [
            {
              type: "line",
              data: values,
              showSymbol: false,
              lineStyle: { width: 1.5, color },
            },
          ],
        }}
      />
    )
  return (
    <Plot
      data={[
        {
          y: values,
          type: "scatter",
          mode: "lines",
          line: { width: 1.5, color },
          hoverinfo: "skip",
        },
      ]}
      layout={{
        width: W,
        height: H,
        margin: { l: 2, r: 2, t: 2, b: 2 },
        xaxis: { visible: false },
        yaxis: { visible: false },
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        showlegend: false,
      }}
      config={{ staticPlot: true, displayModeBar: false }}
    />
  )
})

export function SparklineBench({ onClose }: { onClose: () => void }) {
  const { data: model } = useQuery({
    queryKey: ["proto", "request-stats", LOADED_DAYS],
    queryFn: () => loadModel(LOADED_DAYS),
    staleTime: 10 * 60_000,
  })
  const { ref: colorRef, colors } = useResolvedColors({
    line: "var(--chart-1)",
  })
  const [lib, setLib] = useState<Lib>("recharts")
  const [virtual, setVirtual] = useState(true)
  const [results, setResults] = useState<Result[]>([])
  const [running, setRunning] = useState(false)
  const mountStart = useRef<number | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  const series = useMemo(() => {
    if (!model) return []
    const rows = channelRows(
      model.channelFacts.filter((x) => x.account !== null),
    ).slice(0, COUNT)
    const index = new Map(model.days.map((d, i) => [d, i]))
    const byChannel = new Map(
      rows.map((r) => [
        r.channel,
        Array(model.days.length).fill(0) as number[],
      ]),
    )
    for (const x of model.channelFacts) {
      const s = x.channel ? byChannel.get(x.channel) : undefined
      if (s) s[index.get(x.day) ?? 0] += x.requests
    }
    return rows.map((r) => ({
      channel: r.channel,
      total: r.total,
      values: byChannel.get(r.channel) as number[],
    }))
  }, [model])

  const virtualizer = useVirtualizer({
    count: series.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW,
    overscan: 6,
  })

  // Time from the switch to the second frame after React commits: mount plus first paint.
  // biome-ignore lint/correctness/useExhaustiveDependencies: measures each switch
  useLayoutEffect(() => {
    const t0 = mountStart.current
    if (t0 === null || !series.length) return
    mountStart.current = null
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const h = heap()
        setResults((r) => [
          ...r,
          {
            lib,
            mode: virtual ? "virtualized" : `all ${series.length} mounted`,
            mountMs: performance.now() - t0,
            heapMb: h ? h / 1e6 : undefined,
          },
        ])
      }),
    )
  }, [lib, virtual, series.length])

  const switchTo = (next: Lib, nextVirtual = virtual) => {
    mountStart.current = performance.now()
    setLib(next)
    setVirtual(nextVirtual)
  }

  const scrollTest = () => {
    const el = scroller.current
    if (!el) return
    setRunning(true)
    el.scrollTop = 0
    const duration = 6000
    const start = performance.now()
    let last = start
    let frames = 0
    let worst = 0
    let long = 0
    const step = (now: number) => {
      const dt = now - last
      last = now
      frames++
      worst = Math.max(worst, dt)
      if (dt > 50) long++
      const p = Math.min(1, (now - start) / duration)
      el.scrollTop = p * (el.scrollHeight - el.clientHeight)
      if (p < 1) requestAnimationFrame(step)
      else {
        const h = heap()
        setResults((r) => [
          ...r,
          {
            lib,
            mode: `${virtual ? "virtualized" : "all mounted"}, scroll 6s`,
            mountMs: Number.NaN,
            fps: (1000 * frames) / (now - start),
            worstFrameMs: worst,
            longFrames: long,
            heapMb: h ? h / 1e6 : undefined,
          },
        ])
        setRunning(false)
      }
    }
    requestAnimationFrame(step)
  }

  const btn = (on: boolean) =>
    `rounded border px-2 py-1 text-[12px] ${on ? "border-app-ink/70 bg-app-ink/10" : "border-app-ink/20 hover:bg-app-ink/5"}`
  return (
    <div className="space-y-3 pb-16" ref={colorRef}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-base font-semibold">Sparkline bench</h2>
        {LIBS.map((l) => (
          <button
            key={l.id}
            type="button"
            className={btn(lib === l.id)}
            onClick={() => switchTo(l.id)}
            disabled={running}
          >
            {l.label}
          </button>
        ))}
        <span className="mx-1 text-app-ink/30">|</span>
        <button
          type="button"
          className={btn(virtual)}
          onClick={() => switchTo(lib, true)}
          disabled={running}
        >
          Virtualized
        </button>
        <button
          type="button"
          className={btn(!virtual)}
          onClick={() => switchTo(lib, false)}
          disabled={running}
        >
          All {COUNT} mounted
        </button>
        <button
          type="button"
          className={btn(false)}
          onClick={scrollTest}
          disabled={running}
        >
          {running ? "Scrolling…" : "Run 6s scroll test"}
        </button>
        <button
          type="button"
          className="ml-auto text-[12px] underline text-app-ink/60"
          onClick={onClose}
        >
          Back to the Requests tab
        </button>
      </div>
      <p className="text-[11px] text-app-ink/50">
        {series.length} Channels, each with 30 daily points, ranked by charged
        Requests. Switching library or mode logs its mount time; the scroll test
        logs frame rate and frames over 50 ms. Heap is Chromium only. Measure in
        Chromium with the window in front, and switch each library twice: the
        first switch also loads its code.
      </p>
      <div className="grid gap-3 lg:grid-cols-[1fr_420px]">
        <div
          ref={scroller}
          className="h-[560px] overflow-auto rounded-md border border-app-ink/10 bg-app-card"
        >
          {colors &&
            series.length > 0 &&
            (virtual ? (
              <div
                style={{
                  height: virtualizer.getTotalSize(),
                  position: "relative",
                }}
              >
                {virtualizer.getVirtualItems().map((v) => {
                  const s = series[v.index]
                  return (
                    <div
                      key={`${lib}-${s.channel}`}
                      className="absolute inset-x-0 flex items-center gap-3 border-b border-app-ink/5 px-3"
                      style={{ top: v.start, height: ROW }}
                    >
                      <BenchRow
                        lib={lib}
                        s={s}
                        i={v.index}
                        color={colors.line}
                      />
                    </div>
                  )
                })}
              </div>
            ) : (
              series.map((s, i) => (
                <div
                  key={`${lib}-${s.channel}`}
                  className="flex items-center gap-3 border-b border-app-ink/5 px-3"
                  style={{ height: ROW }}
                >
                  <BenchRow lib={lib} s={s} i={i} color={colors.line} />
                </div>
              ))
            ))}
        </div>
        <table className="h-fit w-full rounded-md border border-app-ink/10 bg-app-card text-[11px]">
          <thead>
            <tr className="text-left text-app-ink/50">
              <th className="px-2 py-1.5 font-normal">Library</th>
              <th className="px-2 py-1.5 font-normal">Run</th>
              <th className="px-2 py-1.5 text-right font-normal">Mount</th>
              <th className="px-2 py-1.5 text-right font-normal">FPS</th>
              <th className="px-2 py-1.5 text-right font-normal">Worst</th>
              <th className="px-2 py-1.5 text-right font-normal">&gt;50ms</th>
              <th className="px-2 py-1.5 text-right font-normal">Heap</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: an append-only log
              <tr key={i} className="border-t border-app-ink/5 tabular-nums">
                <td className="px-2 py-1">
                  {LIBS.find((l) => l.id === r.lib)?.label}
                </td>
                <td className="px-2 py-1 text-app-ink/60">{r.mode}</td>
                <td className="px-2 py-1 text-right">
                  {Number.isNaN(r.mountMs) ? "" : `${Math.round(r.mountMs)} ms`}
                </td>
                <td className="px-2 py-1 text-right">
                  {r.fps ? Math.round(r.fps) : ""}
                </td>
                <td className="px-2 py-1 text-right">
                  {r.worstFrameMs ? `${Math.round(r.worstFrameMs)} ms` : ""}
                </td>
                <td className="px-2 py-1 text-right">{r.longFrames ?? ""}</td>
                <td className="px-2 py-1 text-right">
                  {r.heapMb ? `${Math.round(r.heapMb)} MB` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function BenchRow({
  lib,
  s,
  i,
  color,
}: {
  lib: Lib
  s: { channel: string; total: number; values: number[] }
  i: number
  color: string
}) {
  return (
    <>
      <span className="w-8 text-right text-[11px] tabular-nums text-app-ink/40">
        {i + 1}
      </span>
      <span className="w-56 truncate text-[12px]">@{s.channel}</span>
      <Spark lib={lib} values={s.values} color={color} />
      <span className="ml-auto text-[12px] tabular-nums">{fmt(s.total)}</span>
    </>
  )
}
