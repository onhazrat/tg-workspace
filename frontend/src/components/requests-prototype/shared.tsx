// PROTOTYPE (request-stats): pieces every variant may use. Never merge.
import { AlertTriangle, CircleCheck, CircleDashed } from "lucide-react"
import type React from "react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts"
import {
  type Fact,
  type Filter,
  fmt,
  HOURLY_DAYS,
  KIND_LABEL,
  KINDS,
  type Kind,
  OUTCOMES,
  type Outcome,
  pct,
  type Tally,
  trend,
} from "./data"

export const KIND_COLOR: Record<Kind, string> = {
  auto: "var(--chart-1)",
  bulk: "var(--chart-2)",
  single: "var(--chart-3)",
  follow: "var(--chart-4)",
  probe: "var(--chart-5)",
  handle: "var(--chart-6)",
}
export const OUTCOME_COLOR: Record<Outcome, string> = {
  useful: "var(--outcome-useful)",
  idle: "var(--outcome-idle)",
  wasted: "var(--outcome-wasted)",
}
export const OUTCOME_ICON: Record<Outcome, React.FC<{ size?: number }>> = {
  useful: CircleCheck,
  idle: CircleDashed,
  wasted: AlertTriangle,
}

export interface VariantProps {
  hourFacts: Fact[]
  channelFacts: Fact[]
  filter: Filter
  days: string[]
  onDay: (day: string | null) => void
  /** Every Account, to name the one a fact is charged to. */
  accounts?: { id: string; email: string }[]
  /** Every Channel's facts in range, picked or not, so the Channel table lists them all. */
  allChannelFacts: Fact[]
  /** Channel rows left out of the whole tab; empty means every row is picked. */
  channelsOff: Set<string>
  onChannelsOff: (off: Set<string>) => void
  /** Kinds switched off: the kind table's Show boxes and the trend's legend alike. */
  hiddenKinds: Set<Kind>
  onHiddenKinds: (hidden: Set<Kind>) => void
  /** Outcomes switched off, one choice for the trend and the tables alike. */
  hiddenOutcomes: Set<Outcome>
  onHiddenOutcomes: (hidden: Set<Outcome>) => void
}

/** Bumps whenever the theme class on <html> changes, for canvas libraries. */
export function useThemeKey(): number {
  const [key, setKey] = useState(0)
  useEffect(() => {
    const o = new MutationObserver(() => setKey((k) => k + 1))
    o.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })
    return () => o.disconnect()
  }, [])
  return key
}

/** Resolves `var(--x)` strings for libraries that cannot read CSS variables. */
export function useResolvedColors<T extends Record<string, string>>(colors: T) {
  const ref = useRef<HTMLDivElement>(null)
  const themeKey = useThemeKey()
  const [resolved, setResolved] = useState<T | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read on theme change
  useLayoutEffect(() => {
    if (!ref.current) return
    const style = getComputedStyle(ref.current)
    const out = {} as Record<string, string>
    for (const [k, v] of Object.entries(colors)) {
      const name = v.match(/var\((--[\w-]+)\)/)?.[1]
      out[k] = name ? style.getPropertyValue(name).trim() : v
    }
    setResolved(out as T)
  }, [themeKey])
  return { ref, colors: resolved }
}

export function Swatch({ color }: { color: string }) {
  return (
    <span
      className="inline-block size-2.5 shrink-0 rounded-sm"
      style={{ background: color }}
    />
  )
}

export function OutcomeLegend() {
  return (
    <div className="flex flex-wrap gap-x-3 text-[11px] text-app-ink/70">
      {OUTCOMES.map((o) => {
        const Icon = OUTCOME_ICON[o.id]
        return (
          <span key={o.id} className="flex items-center gap-1.5">
            <span style={{ color: OUTCOME_COLOR[o.id] }}>
              <Icon size={12} />
            </span>
            {o.label}
          </span>
        )
      })}
    </div>
  )
}

/** A horizontal bar split by outcome, sized against the largest row. */
export function OutcomeBar({ t, max }: { t: Tally; max: number }) {
  const w = max ? Math.min(100, (100 * t.total) / max) : 0
  return (
    <div
      className="flex h-2.5 min-w-1 items-stretch gap-px"
      style={{ width: `${w}%` }}
    >
      {OUTCOMES.map((o) =>
        t[o.id] > 0 ? (
          <div
            key={o.id}
            className="first:rounded-l-sm last:rounded-r-sm"
            style={{ flexGrow: t[o.id], background: OUTCOME_COLOR[o.id] }}
            title={`${o.label} ${fmt(t[o.id])}`}
          />
        ) : null,
      )}
    </div>
  )
}

export function StatStrip({ t }: { t: Tally }) {
  const stats: [string, string, string?][] = [
    ["Requests", fmt(t.total)],
    ["Charged", fmt(t.charged), pct(t.charged, t.total)],
    ["Uncharged", fmt(t.uncharged), pct(t.uncharged, t.total)],
    ["Idle", fmt(t.idle), pct(t.idle, t.total)],
    ["Wasted", fmt(t.wasted), pct(t.wasted, t.total)],
  ]
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {stats.map(([label, value, share]) => (
        <div
          key={label}
          className="rounded-md border border-app-ink/10 bg-app-card px-3 py-2"
        >
          <div className="text-[10px] uppercase tracking-wider text-app-ink/50">
            {label}
          </div>
          <div className="text-lg font-semibold">{value}</div>
          {share && (
            <div className="text-[11px] text-app-ink/50">{share} of all</div>
          )}
        </div>
      ))}
    </div>
  )
}

export function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { name: string; value: number; color?: string; fill?: string }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border border-app-ink/15 bg-app-card px-2.5 py-1.5 text-[11px] shadow-lg">
      <div className="mb-1 font-semibold">{label}</div>
      {payload
        .filter((p) => p.value > 0)
        .map((p) => (
          <div key={p.name} className="flex items-center gap-1.5">
            <Swatch color={p.color ?? p.fill ?? "currentColor"} />
            <span className="text-app-ink/70">{p.name}</span>
            <span className="ml-auto pl-3 tabular-nums">{fmt(p.value)}</span>
          </div>
        ))}
    </div>
  )
}

/** 2500 as "2.5k", not "3k". */
export const kTick = (v: number) =>
  v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : String(v)

/** Sized from its own box, because ResponsiveContainer measures nothing in tests. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    if (!ref.current) return
    const o = new ResizeObserver(([e]) =>
      setWidth(Math.floor(e.contentRect.width)),
    )
    o.observe(ref.current)
    return () => o.disconnect()
  }, [])
  return { ref, width }
}

/**
 * An Account's colour, from its fixed place in the Account list rather than in the
 * selection, so picking another Account never repaints the ones already shown.
 */
// ponytail: four ramp steps; a fifth Account repeats the first, add steps or fold into "Other" when needed
export const accountColor = (index: number) =>
  `var(--account-${(index % 4) + 1})`

/**
 * The shared trend: Charged and Uncharged per day of the range, or per hour of the
 * picked day. Clicking a day narrows every breakdown to it, and the legend chips turn a
 * layer off for the whole page. With two or more Accounts picked, the bars stack by
 * Account instead.
 */
export function TrendStrip({
  hourFacts,
  channelFacts,
  filter,
  days,
  onDay,
  accountNames = [],
  onToggleLayer,
}: VariantProps & {
  accountNames?: { id: string; email: string }[]
  onToggleLayer?: (layer: "charged" | "uncharged") => void
}) {
  const { hourly, points } = trend(hourFacts, channelFacts, filter, days)
  // A day past the hourly tier has only its daily total.
  const noHours =
    hourly && filter.from < days[Math.max(0, days.length - HOURLY_DAYS)]
  const { ref, width } = useWidth<HTMLDivElement>()
  const compare = filter.accounts.length >= 2
  const layers = (["charged", "uncharged"] as const).filter(
    (l) => filter[l] && !(l === "uncharged" && filter.accounts.length),
  )
  const stacked = compare
    ? accountNames
        .map((a, i) => ({ key: a.id, name: a.email, color: accountColor(i) }))
        .filter((s) => filter.accounts.includes(s.key))
    : layers.map((l) => ({
        key: l,
        name: l === "charged" ? "Charged" : "Uncharged",
        color: `var(--layer-${l})`,
      }))
  const data = compare
    ? (() => {
        const per = stacked.map(
          (s) =>
            trend(
              hourFacts,
              channelFacts,
              { ...filter, accounts: [s.key] },
              days,
            ).points,
        )
        return points.map((p, i) => ({
          x: p.x,
          ...Object.fromEntries(
            stacked.map((s, j) => [s.key, per[j][i].charged]),
          ),
        }))
      })()
    : points
  return (
    <div
      ref={ref}
      className="rounded-md border border-app-ink/10 bg-app-card p-2"
    >
      <div className="mb-1 flex flex-wrap items-center gap-2 px-1 text-[11px] text-app-ink/60">
        <span>
          {hourly
            ? `Requests per hour on ${filter.from} (UTC)`
            : "Requests per day (UTC). Click a day to narrow everything to it."}
        </span>
        <span className="ml-auto" />
        {compare
          ? stacked.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5 px-1">
                <Swatch color={s.color} />
                {s.name}
              </span>
            ))
          : (["charged", "uncharged"] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={filter[l]}
                onClick={() => onToggleLayer?.(l)}
                className={`flex items-center gap-1.5 rounded px-1 hover:bg-app-ink/10 ${filter[l] ? "" : "line-through opacity-50"}`}
              >
                <Swatch color={`var(--layer-${l})`} />
                {l === "charged" ? "Charged" : "Uncharged"}
              </button>
            ))}
        {hourly && (
          <button
            type="button"
            className="rounded border border-app-ink/20 px-1.5 hover:bg-app-ink/10"
            onClick={() => onDay(null)}
          >
            Back to the range
          </button>
        )}
      </div>
      {noHours && (
        <p className="px-1 py-6 text-center text-[12px] text-app-ink/50">
          Hourly totals are kept for {HOURLY_DAYS} days, so {filter.from} has
          its daily total only.
        </p>
      )}
      {width > 0 && !noHours && (
        <BarChart
          width={width - 16}
          height={compare ? 160 : 120}
          data={data}
          margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
          barCategoryGap={2}
          // On the chart, not each Bar: the day under the cursor, wherever in its column the click lands.
          onClick={(e: { activeLabel?: string | number }) => {
            if (!hourly && e?.activeLabel !== undefined)
              onDay(String(e.activeLabel))
          }}
          style={{ cursor: hourly ? "default" : "pointer" }}
        >
          <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
          <XAxis
            dataKey="x"
            tick={{ fontSize: 10, fill: "var(--viz-axis)" }}
            tickFormatter={(x: string) => (hourly ? x : x.slice(5))}
            stroke="var(--viz-grid)"
          />
          <YAxis
            width={44}
            tick={{ fontSize: 10, fill: "var(--viz-axis)" }}
            tickFormatter={kTick}
            stroke="var(--viz-grid)"
          />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ fill: "var(--viz-grid)", opacity: 0.5 }}
          />
          {stacked.map((s, j) => (
            // A 1px surface-coloured stroke is the gap between stacked segments.
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              stackId="a"
              fill={s.color}
              stroke="var(--viz-surface)"
              strokeWidth={compare ? 1 : 0}
              radius={j === stacked.length - 1 ? [3, 3, 0, 0] : 0}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      )}
    </div>
  )
}

export const toggleIn = <T,>(set: Set<T>, item: T) => {
  const next = new Set(set)
  if (!next.delete(item)) next.add(item)
  return next
}

/**
 * Useful, Idle and Wasted as chips that hide or show each, shared by the kind table and
 * the trend. The last one shown stays shown: hiding it would leave nothing to compare.
 * `swatch` adds the chart's shade for each, where the chart has one.
 */
export function OutcomeToggles({
  hidden,
  onHidden,
  swatch,
}: {
  hidden: Set<Outcome>
  onHidden: (hidden: Set<Outcome>) => void
  swatch?: Record<Outcome, string>
}) {
  return (
    <span className="flex gap-1">
      {OUTCOMES.map((o) => {
        const Icon = OUTCOME_ICON[o.id]
        const off = hidden.has(o.id)
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={!off}
            disabled={!off && hidden.size === OUTCOMES.length - 1}
            onClick={() => onHidden(toggleIn(hidden, o.id))}
            className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${off ? "border-app-ink/15 text-app-ink/40 line-through" : "border-app-ink/40 text-app-ink/80"}`}
          >
            {swatch && (
              <span
                aria-hidden
                className="inline-block size-2.5 rounded-sm border border-app-ink/20"
                style={{ background: swatch[o.id], opacity: off ? 0.4 : 1 }}
              />
            )}
            <span
              style={{ color: OUTCOME_COLOR[o.id], opacity: off ? 0.4 : 1 }}
            >
              <Icon size={12} />
            </span>
            {o.label}
          </button>
        )
      })}
    </span>
  )
}
