// PROTOTYPE (request-stats): the Operator's Requests tab, three variants switchable via
// `?variant=` on `?tab=requests`, plus a sparkline bench at `?bench=sparklines`.
// Never merge. See docs/request-stats-prototype-plan.md.
import "./tokens.css"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { Users } from "lucide-react"
import type React from "react"
import { useMemo, useState } from "react"
import { FilterBar } from "@/components/FilterBar"
import { FacetMenu } from "@/components/filter-tree/FacetMenu"
import { Usage } from "@/components/settings-page/operator-panels"
import { TimeBoundBar } from "@/components/TimeBoundEditor"
import { TgInlineChoice } from "@/components/ui/tg-inline-segments"
import { useIsMobile } from "@/hooks/useMobile"
import { resolveTimeBound, type TimeBound } from "@/lib/time-bound/bound"
import { SparklineBench } from "./bench"
import { AccountCompare } from "./compare"
import {
  applyFilter,
  clipToRange,
  type Filter,
  fmt,
  groupBy,
  type Kind,
  LOADED_DAYS,
  loadModel,
  type Outcome,
  pickChannels,
  tally,
} from "./data"
import { PrototypeSwitcher } from "./PrototypeSwitcher"
import { StatStrip, TrendStrip, type VariantProps } from "./shared"
import { RequestedSpread } from "./spread"
import { Trend } from "./trend-plotly"
import { VariantA } from "./variant-a"

const workspaceRoute = getRouteApi("/_tg/")

const VARIANTS: {
  key: string
  name: string
  body?: React.FC<VariantProps>
}[] = [
  { key: "0", name: "Current" },
  { key: "A", name: "Ranked tables", body: VariantA },
]

/** Thirty days back from now: everything the prototype API loads. */
const DAY_MS = 86_400_000
const DEFAULT_BOUND: TimeBound = { mode: "live", start: -30 * DAY_MS }

export const RequestsPrototype: React.FC = () => {
  const search = workspaceRoute.useSearch()
  const navigate = workspaceRoute.useNavigate()
  const key = String(search.variant ?? "0")
  const variant = VARIANTS.find((v) => v.key === key) ?? VARIANTS[0]
  const setSearch = (patch: { variant?: string; bench?: string }) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })

  const switcher = (
    <PrototypeSwitcher
      variants={VARIANTS}
      current={variant.key}
      onChange={(k) => setSearch({ variant: k === "0" ? undefined : k })}
    />
  )
  if (search.bench === "sparklines")
    return (
      <div className="req-proto">
        <SparklineBench onClose={() => setSearch({ bench: undefined })} />
      </div>
    )
  return (
    <div className="req-proto space-y-3 pb-16" data-testid="requests-prototype">
      {variant.body ? <Stats body={variant.body} /> : <Usage />}
      <div className="text-right text-[11px] text-app-ink/40">
        <button
          type="button"
          className="underline"
          onClick={() => setSearch({ bench: "sparklines" })}
        >
          Open the sparkline bench
        </button>
      </div>
      {switcher}
    </div>
  )
}

function Stats({ body: Body }: { body: React.FC<VariantProps> }) {
  const {
    data: full,
    isPending,
    error,
  } = useQuery({
    queryKey: ["proto", "request-stats", LOADED_DAYS],
    queryFn: () => loadModel(LOADED_DAYS),
    staleTime: 10 * 60_000,
  })
  // The range is a Time bound, as on the Posts, Logs and History tabs; days are UTC.
  const [bound, setBound] = useState<TimeBound>(DEFAULT_BOUND)
  const onDay = (day: string | null) =>
    setBound(
      day
        ? {
            mode: "fixed",
            start: Date.parse(`${day}T00:00:00Z`),
            end: Date.parse(`${day}T00:00:00Z`) + DAY_MS,
          }
        : DEFAULT_BOUND,
    )
  // Channel rows left out, picked in the Channel table: the whole tab reads only the rest.
  const [channelsOff, setChannelsOff] = useState<Set<string>>(new Set())
  // The range to the minute; `bound` changes when the operator picks a new one, and a
  // live range re-reads the clock then.
  const range = useMemo(() => resolveTimeBound(bound, Date.now()), [bound])
  // Picked Channels, every day: what the spread draws to pick a range from.
  const picked = useMemo(
    () => full && pickChannels(full, channelsOff),
    [full, channelsOff],
  )
  // Picked Channels within the range: what everything else on the tab reads.
  const model = useMemo(
    () => picked && clipToRange(picked, range.start, range.end),
    [picked, range],
  )
  const [accounts, setAccounts] = useState<string[]>([])
  const [layers, setLayers] = useState({ charged: true, uncharged: true })
  // One switch per outcome for the trend and the tables, so hiding Wasted hides it everywhere.
  const [hiddenOutcomes, setHiddenOutcomes] = useState<Set<Outcome>>(new Set())
  // Kinds switched off, in the kind table or the trend's legend: one switch for both.
  const [hiddenKinds, setHiddenKinds] = useState<Set<Kind>>(new Set())
  // Never both off: turning off the last layer turns the other one on.
  const toggleLayer = (layer: "charged" | "uncharged") =>
    setLayers((l) =>
      l[layer] && !l[layer === "charged" ? "uncharged" : "charged"]
        ? { charged: !l.charged, uncharged: !l.uncharged }
        : { ...l, [layer]: !l[layer] },
    )
  const toggleAccount = (id: string) =>
    setAccounts((a) =>
      a.includes(id) ? a.filter((x) => x !== id) : [...a, id],
    )

  const filter: Filter | null = useMemo(() => {
    if (!model) return null
    const { start, end } = range
    const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
    const first = model.days[0]
    const last = model.days[model.days.length - 1]
    // [start, end): the last day in range is the one holding the instant just before `end`.
    const from =
      start === undefined || utcDay(start) < first ? first : utcDay(start)
    const to =
      end === undefined || utcDay(end - 1) > last ? last : utcDay(end - 1)
    const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`)
    return {
      accounts,
      ...layers,
      from,
      to,
      start: Math.max(start ?? 0, dayMs(first)),
      end: Math.min(end ?? Number.POSITIVE_INFINITY, dayMs(last) + DAY_MS),
    }
  }, [model, range, accounts, layers])
  const phone = useIsMobile()

  if (error)
    return (
      <div className="text-sm text-red-500">
        The prototype API failed: {String(error)}
      </div>
    )
  if (isPending || !full || !picked || !model || !filter)
    return <div className="text-sm text-app-ink/50">Loading Requests…</div>

  const facts = applyFilter(model.channelFacts, filter)
  const props: VariantProps = {
    hourFacts: model.hourFacts,
    channelFacts: facts,
    filter,
    days: model.days,
    onDay,
    accounts: model.accounts,
    allChannelFacts: applyFilter(
      clipToRange(full, range.start, range.end).channelFacts,
      filter,
    ),
    channelsOff,
    onChannelsOff: setChannelsOff,
    hiddenOutcomes,
    onHiddenOutcomes: setHiddenOutcomes,
    hiddenKinds,
    onHiddenKinds: setHiddenKinds,
  }
  const inRange = applyFilter(model.channelFacts, {
    ...filter,
    charged: true,
    uncharged: true,
  })
  const layerCounts = tally(inRange)
  const layerChoice =
    filter.charged && filter.uncharged
      ? "all"
      : filter.charged
        ? "charged"
        : "uncharged"
  const spentBy = groupBy(
    applyFilter(model.channelFacts, { ...filter, accounts: [] }),
    (x) => x.account ?? "",
  )
  const total = tally(facts).total
  return (
    <>
      <FilterBar
        phone={phone}
        testIdPrefix="requests"
        active={
          Number(layerChoice !== "all") +
          accounts.length +
          Number(bound !== DEFAULT_BOUND) +
          Number(channelsOff.size > 0)
        }
        search={<h2 className="text-base font-semibold">Requests</h2>}
        controls={
          <>
            <TgInlineChoice
              aria-label="Charged or Uncharged"
              options={(["all", "charged", "uncharged"] as const).map((v) => ({
                value: v,
                "data-testid": `requests-layer-${v}`,
                label: (
                  <span>
                    {v === "all"
                      ? "All Requests"
                      : v === "charged"
                        ? "Charged"
                        : "Uncharged"}
                    <span className="ml-1 tabular-nums opacity-60">
                      {fmt(v === "all" ? layerCounts.total : layerCounts[v])}
                    </span>
                  </span>
                ),
              }))}
              value={layerChoice}
              onChange={(v) =>
                setLayers({
                  charged: v !== "uncharged",
                  uncharged: v !== "charged",
                })
              }
            />
            <FacetMenu
              icon={<Users size={12} />}
              label="Accounts"
              noun="account"
              testId="requests-accounts"
              countLabel="charged Requests"
              rows={model.accounts.map((a) => ({
                id: a.id,
                label: a.email,
                hint: a.synthetic ? "synthetic" : undefined,
                selected: 0,
                total: Math.round(spentBy.get(a.id)?.total ?? 0),
                tick: "false" as const,
              }))}
              funnelled={accounts}
              labelOf={(id) =>
                model.accounts.find((a) => a.id === id)?.email ?? id
              }
              onFunnel={(id, on) =>
                setAccounts((a) =>
                  on ? [...a, id] : a.filter((x) => x !== id),
                )
              }
              onClearFunnels={() => setAccounts([])}
            />
            <span className="mx-1 h-5 w-px bg-app-ink/10" />
            <TimeBoundBar
              label="Requested"
              value={bound}
              onChange={setBound}
              opts={{ openEnds: true }}
            >
              <RequestedSpread
                hourFacts={picked.hourFacts}
                dayFacts={picked.channelFacts}
                filter={filter}
                days={model.days}
                bound={bound}
                onPick={setBound}
              />
            </TimeBoundBar>
          </>
        }
        footer={
          <>
            <span data-testid="requests-total" className="font-semibold">
              {fmt(total)} Requests
            </span>
            <span className="text-app-ink/50">
              {rangeText(filter)} (UTC)
              {accounts.length > 0 &&
                " · Uncharged hidden, because no Account pays for it"}
            </span>
            {channelsOff.size > 0 && (
              <span className="text-app-ink/50">
                · {fmt(channelsOff.size)} Channel
                {channelsOff.size === 1 ? "" : "s"} left out{" "}
                <button
                  type="button"
                  className="underline hover:text-app-ink"
                  onClick={() => setChannelsOff(new Set())}
                >
                  Pick all
                </button>
              </span>
            )}
            {accounts.length === 1 && (
              <span className="ml-auto text-app-ink/50">
                Pick a second Account to compare them.
              </span>
            )}
          </>
        }
      />
      {accounts.length >= 2 && (
        <AccountCompare
          facts={facts}
          accounts={model.accounts.filter((a) => accounts.includes(a.id))}
          all={model.accounts}
        />
      )}
      <StatStrip t={tally(facts)} />
      {/* Both trends, the daily bars over the zoomable one: the bars for the range at a
          glance, Plotly to dig into it. */}
      <TrendStrip
        {...props}
        accountNames={model.accounts}
        onToggleLayer={toggleLayer}
      />
      <Trend
        dayFacts={model.channelFacts}
        hourFacts={model.hourFacts}
        fineFacts={model.fineFacts}
        filter={filter}
        days={model.days}
        onBound={setBound}
        hidden={hiddenOutcomes}
        onHidden={setHiddenOutcomes}
        hiddenKinds={hiddenKinds}
        onHiddenKinds={setHiddenKinds}
      />
      <Body {...props} />
      <StateReadout filter={filter} model={model} facts={facts.length} />
    </>
  )
}

/** The range in UTC: whole days as days, a range an edge cuts mid-day to the minute. */
function rangeText({ from, to, start, end }: Filter) {
  if (start % DAY_MS === 0 && end % DAY_MS === 0)
    return from === to ? `on ${from}` : `from ${from} to ${to}`
  const at = (ms: number) =>
    new Date(ms).toISOString().slice(0, 16).replace("T", " ")
  return `from ${at(start)} to ${at(end)}`
}

function StateReadout({
  filter,
  model,
  facts,
}: {
  filter: Filter
  model: { days: string[]; channelFacts: unknown[]; hourFacts: unknown[] }
  facts: number
}) {
  return (
    <details className="rounded-md border border-dashed border-fuchsia-500/40 px-3 py-2 text-[11px] text-app-ink/60">
      <summary className="cursor-pointer">
        Prototype state and how the data was made
      </summary>
      <pre className="mt-2 whitespace-pre-wrap font-mono">
        {JSON.stringify(
          {
            filter,
            daysLoaded: model.days.length,
            channelFactsInRange: facts,
            channelFactsTotal: model.channelFacts.length,
            hourFactsTotal: model.hourFacts.length,
          },
          null,
          2,
        )}
      </pre>
      <p className="mt-2">
        Real: each day's charged Requests per Account and Budget, each day's
        probe Requests, when probes ran and how often they found nothing, and
        every sync with its Channel, hour, source, status and Post count.
        Invented: how a day's charged Requests divide between its syncs
        (weighted by pages), the Idle share of syncs with no new Posts (75%),
        the retry share (3% of useful, two retries per failed sync), and every
        handle check.
      </p>
    </details>
  )
}
