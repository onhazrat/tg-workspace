/**
 * The Operator's Requests tab (RQS-03, ADR-035): where every Request to
 * Telegram went. Loaded lazily from `App`, so its code downloads only when
 * the tab opens. The tab-wide state lives here, as one `RequestsFilter`.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import {
  requestsReadRequestBreakdown,
  requestsReadRequestTrend,
} from "@/client"
import { useSettingsRegistry } from "@/components/settings-page/registry"
import { queryKeys } from "@/hooks/queryKeys"
import { useIsMobile } from "@/hooks/useMobile"
import {
  type ChargedFilter,
  chargedCounts,
  initialRequestsFilter,
  type RequestsFilter,
  requestsRange,
} from "@/lib/requests/breakdown"
import { offeredTab } from "@/lib/workspace-tabs"
import { RequestsView } from "./RequestsView"

/** What narrows the Breakdown and the trend besides the range. */
type Picked = { charged: ChargedFilter; accounts: readonly string[] }

function useBreakdown(
  range: { start: number; end: number },
  { charged, accounts }: Picked,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.requestBreakdown(
      range.start,
      range.end,
      charged,
      accounts,
    ),
    queryFn: () =>
      requestsReadRequestBreakdown({
        query: {
          start: new Date(range.start).toISOString(),
          end: new Date(range.end).toISOString(),
          charged,
          accounts: [...accounts],
        },
      }),
    placeholderData: keepPreviousData,
    enabled,
  })
}

/** The range in buckets, for the daily bars (RQS-06). */
function useTrend(
  range: { start: number; end: number },
  { charged, accounts }: Picked,
) {
  return useQuery({
    queryKey: queryKeys.requestTrend(range.start, range.end, charged, accounts),
    queryFn: () =>
      requestsReadRequestTrend({
        query: {
          start: new Date(range.start).toISOString(),
          end: new Date(range.end).toISOString(),
          charged,
          accounts: [...accounts],
        },
      }),
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
  // The unfiltered Breakdown gives the choice and Account counts; the picked
  // one, the rest.
  const unfiltered = filter.charged === "all" && !filter.accounts.length
  const all = useBreakdown(range, { charged: "all", accounts: [] }, true)
  const picked = useBreakdown(range, filter, !unfiltered)
  const shown = unfiltered ? all : picked
  const trend = useTrend(range, filter)
  const phone = useIsMobile()
  return (
    <RequestsView
      filter={filter}
      onFilter={(patch) => setFilter((f) => ({ ...f, ...patch }))}
      range={range}
      counts={all.data && chargedCounts(all.data.byKind)}
      byAccount={all.data?.byAccount}
      breakdown={shown.data}
      trend={trend.data}
      error={all.error ?? shown.error ?? trend.error}
      phone={phone}
    />
  )
}
