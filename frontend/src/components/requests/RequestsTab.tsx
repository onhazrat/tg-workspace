/**
 * The Operator's Requests tab (RQS-03, ADR-035): where every Request to
 * Telegram went. Loaded lazily from `App`, so its code downloads only when
 * the tab opens. The tab-wide state lives here, as one `RequestsFilter`.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import {
  requestsReadRequestBreakdown,
  requestsReadRequestSpread,
  requestsReadRequestTrend,
} from "@/client"
import { useSettingsRegistry } from "@/components/settings-page/registry"
import { queryKeys } from "@/hooks/queryKeys"
import { useIsMobile } from "@/hooks/useMobile"
import {
  type ChannelRow,
  type ChargedFilter,
  initialRequestsFilter,
  leftOutQuery,
  type RequestsFilter,
  requestsRange,
  updated,
} from "@/lib/requests/breakdown"
import { offeredTab } from "@/lib/workspace-tabs"
import { RequestsSheet } from "./RequestsSheet"
import { RequestsView } from "./RequestsView"

/** What narrows the Breakdown and the trend besides the range. */
type Picked = {
  charged: ChargedFilter
  accounts: readonly string[]
  leftOut: ReadonlySet<string>
}

const NONE = new Set<string>()

function query(range: { start: number; end: number }, picked: Picked) {
  return {
    start: new Date(range.start).toISOString(),
    end: new Date(range.end).toISOString(),
    charged: picked.charged,
    accounts: [...picked.accounts],
    ...leftOutQuery(picked.leftOut),
  }
}

/**
 * One Breakdown. The tab asks for up to three; two that pick the same are
 * one key, so react-query asks the server once.
 */
function useBreakdown(range: { start: number; end: number }, picked: Picked) {
  const q = query(range, picked)
  return useQuery({
    queryKey: queryKeys.requestBreakdown(
      range.start,
      range.end,
      q.charged,
      q.accounts,
      { leftOut: q.leftOut, leftOutKinds: q.leftOutKinds },
    ),
    queryFn: () => requestsReadRequestBreakdown({ query: q }),
    placeholderData: keepPreviousData,
  })
}

/** The range in buckets, for the daily bars (RQS-06). */
function useTrend(range: { start: number; end: number }, picked: Picked) {
  const q = query(range, picked)
  return useQuery({
    queryKey: queryKeys.requestTrend(
      range.start,
      range.end,
      q.charged,
      q.accounts,
      { leftOut: q.leftOut, leftOutKinds: q.leftOutKinds },
    ),
    queryFn: () => requestsReadRequestTrend({ query: q }),
    placeholderData: keepPreviousData,
  })
}

/** When Requests were made, over everything kept: the range picker's (RQS-09). */
function useSpread(picked: Picked) {
  const q = {
    charged: picked.charged,
    accounts: [...picked.accounts],
    ...leftOutQuery(picked.leftOut),
  }
  return useQuery({
    queryKey: queryKeys.requestSpread(q.charged, q.accounts, {
      leftOut: q.leftOut,
      leftOutKinds: q.leftOutKinds,
    }),
    queryFn: () => requestsReadRequestSpread({ query: q }),
    placeholderData: keepPreviousData,
  })
}

/** Only the Operator reads the Breakdown; anyone else is told so. */
export default function RequestsTab() {
  const registry = useSettingsRegistry()
  if (registry.isLoading)
    return <p className="text-sm text-app-ink/50">Loading…</p>
  if (!offeredTab("requests", registry.permissions))
    return (
      <p className="text-sm text-app-ink/60" data-testid="requests-refused">
        The Requests tab is for the Operator.
      </p>
    )
  return <OperatorRequests />
}

function OperatorRequests() {
  const [filter, setFilter] = useState<RequestsFilter>(initialRequestsFilter)
  // A live range reads the clock when it is picked, not on every render.
  const range = useMemo(
    () => requestsRange(filter.bound, Date.now()),
    [filter.bound],
  )
  // Before Charged and the Accounts narrow it: the choice and Account counts.
  const all = useBreakdown(range, {
    charged: "all",
    accounts: [],
    leftOut: filter.leftOut,
  })
  // Before the Channels left out leave it: the Channel table's rows (RQS-04).
  const listed = useBreakdown(range, { ...filter, leftOut: NONE })
  const shown = useBreakdown(range, filter)
  const trend = useTrend(range, filter)
  const spread = useSpread(filter)
  const phone = useIsMobile()
  const [opened, setOpened] = useState<ChannelRow | null>(null)
  return (
    <>
      <RequestsView
        filter={filter}
        onFilter={(update) => setFilter((f) => updated(f, update))}
        range={range}
        unfiltered={all.data}
        breakdown={shown.data}
        listed={listed.data}
        trend={trend.data}
        spread={spread.data}
        error={all.error ?? shown.error ?? listed.error ?? trend.error}
        phone={phone}
        onOpenRow={setOpened}
      />
      <RequestsSheet
        row={opened}
        range={range}
        filter={filter}
        onClose={() => setOpened(null)}
      />
    </>
  )
}
