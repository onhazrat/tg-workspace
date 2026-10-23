import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts"
import type { RequestTrendResponse } from "@/client"
import type { RequestsFilter } from "@/lib/requests/breakdown"
import { dailyBars } from "@/lib/requests/trend"
import { Swatch } from "./parts"

const LAYERS = [
  { key: "charged", label: "Charged", color: "var(--layer-charged)" },
  { key: "uncharged", label: "Uncharged", color: "var(--layer-uncharged)" },
] as const

const kTick = (v: number) =>
  v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : String(v)

const AXIS = { fontSize: 10, fill: "var(--viz-axis)" }

/**
 * The daily bar trend (RQS-06): the range's Requests per UTC day, Charged
 * and Uncharged stacked, or per hour when the range is one day. Clicking a
 * day narrows the whole tab to it. Hidden kinds and outcomes add nothing.
 */
export function DailyBars({
  trend,
  range,
  filter,
  onDay,
}: {
  trend: RequestTrendResponse
  range: { start: number; end: number }
  filter: RequestsFilter
  /** A day was clicked: its midnight, epoch ms. */
  onDay: (start: number) => void
}) {
  const { grain, bars, dailyOnly } = dailyBars(
    trend.buckets,
    range,
    filter.hiddenKinds,
    filter.hiddenOutcomes,
  )
  const day =
    grain === "hour" && new Date(range.start).toISOString().slice(0, 10)
  const layers = LAYERS.filter(
    (l) => filter.charged === "all" || filter.charged === l.key,
  )
  return (
    <section
      data-testid="requests-daily-bars"
      className="rounded-md border border-app-ink/10 bg-app-card p-2"
    >
      <div className="mb-1 flex flex-wrap items-center gap-2 px-1 text-[11px] text-app-ink/60">
        <span data-testid="requests-daily-title">
          {day
            ? `Requests per hour on ${day} (UTC)`
            : "Requests per day (UTC). Click a day to narrow everything to it."}
        </span>
        <span className="ml-auto" />
        {layers.map((l) => (
          <span key={l.key} className="flex items-center gap-1.5 px-1">
            <Swatch color={l.color} />
            {l.label}
          </span>
        ))}
      </div>
      {dailyOnly ? (
        <p
          data-testid="requests-daily-only"
          className="px-1 py-6 text-center text-[12px] text-app-ink/50"
        >
          Hourly totals are kept for {trend.hourlyDays} days, so {day} has its
          daily total only.
        </p>
      ) : (
        <BarChart
          responsive
          style={{
            width: "100%",
            height: 120,
            cursor: day ? "auto" : "pointer",
          }}
          data={bars}
          margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
          barCategoryGap={2}
          // On the chart, not each Bar: the day under the cursor, wherever
          // in its column the click lands.
          onClick={(state) => {
            const bar = bars.find((b) => b.x === state.activeLabel)
            if (!day && bar) onDay(bar.at)
          }}
        >
          <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
          <XAxis
            dataKey="x"
            tick={AXIS}
            tickFormatter={(x: string) => (day ? x : x.slice(5))}
            stroke="var(--viz-grid)"
          />
          <YAxis
            width={44}
            tick={AXIS}
            tickFormatter={kTick}
            stroke="var(--viz-grid)"
          />
          <Tooltip
            cursor={{ fill: "var(--viz-grid)", opacity: 0.5 }}
            contentStyle={{
              background: "var(--card-bg)",
              borderColor: "var(--line-color)",
              fontSize: 11,
            }}
          />
          {layers.map((l, i) => (
            <Bar
              key={l.key}
              dataKey={l.key}
              name={l.label}
              stackId="requests"
              fill={l.color}
              radius={i === layers.length - 1 ? [3, 3, 0, 0] : 0}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      )}
    </section>
  )
}
