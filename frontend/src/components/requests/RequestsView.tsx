import type { RequestBreakdownResponse, RequestTrendResponse } from "@/client"
import { FilterBar } from "@/components/FilterBar"
import { TimeBoundBar } from "@/components/TimeBoundEditor"
import { TgInlineChoice } from "@/components/ui/tg-inline-segments"
import {
  type ChargedFilter,
  channelRows,
  fmt,
  kindRows,
  type RequestsFilter,
  rangeText,
  statTotals,
  toggled,
} from "@/lib/requests/breakdown"
import { DAY_MS } from "@/lib/scope/window"
import { extractErrorMessage } from "@/utils"
import { ChannelTable } from "./ChannelTable"
import { DailyBars } from "./DailyBars"
import { KindTable } from "./KindTable"
import { OutcomeChips, StatStrip } from "./parts"

const CHOICES: { value: ChargedFilter; label: string }[] = [
  { value: "all", label: "All Requests" },
  { value: "charged", label: "Charged" },
  { value: "uncharged", label: "Uncharged" },
]

/**
 * The Requests tab, props only (RQS-03): the filter bar, the stat strip, the
 * daily bars (RQS-06), By kind of work and Channels by Requests, all for one range cut to the minute.
 */
export function RequestsView({
  filter,
  onFilter,
  range,
  counts,
  breakdown,
  trend,
  error,
  phone = false,
}: {
  filter: RequestsFilter
  onFilter: (patch: Partial<RequestsFilter>) => void
  /** The range the Breakdown was asked for, epoch ms, cut to the minute. */
  range: { start: number; end: number }
  /** All, Charged and Uncharged in the range, whichever is picked. */
  counts?: Record<ChargedFilter, number>
  breakdown?: RequestBreakdownResponse
  /** The range in buckets, for the daily bars (RQS-06). */
  trend?: RequestTrendResponse
  error?: unknown
  phone?: boolean
}) {
  const { hiddenKinds, hiddenOutcomes } = filter
  const totals = breakdown && statTotals(breakdown.byKind)
  return (
    <div className="space-y-3 pb-16" data-testid="requests-tab">
      <FilterBar
        phone={phone}
        testIdPrefix="requests"
        active={Number(filter.charged !== "all")}
        search={<h2 className="text-base font-semibold">Requests</h2>}
        controls={
          <>
            <TgInlineChoice<ChargedFilter>
              aria-label="Charged or Uncharged"
              options={CHOICES.map((c) => ({
                value: c.value,
                "data-testid": `requests-charged-${c.value}`,
                label: (
                  <span>
                    {c.label}
                    {counts && (
                      <span className="ml-1 tabular-nums opacity-60">
                        {fmt(counts[c.value])}
                      </span>
                    )}
                  </span>
                ),
              }))}
              value={filter.charged}
              onChange={(charged) => onFilter({ charged })}
            />
            <span className="mx-1 h-5 w-px bg-app-ink/10" />
            <TimeBoundBar
              label="Requested"
              value={filter.bound}
              onChange={(bound) => onFilter({ bound })}
              opts={{ openEnds: true }}
            />
          </>
        }
        footer={
          <>
            <span data-testid="requests-total" className="font-semibold">
              {totals ? `${fmt(totals.total)} Requests` : "Loading Requests…"}
            </span>
            <span data-testid="requests-range" className="text-app-ink/50">
              {rangeText(range.start, range.end)} (UTC)
            </span>
          </>
        }
      />
      {error ? (
        <p role="alert" className="text-sm text-red-500">
          The Requests could not be read: {extractErrorMessage(error)}
        </p>
      ) : (
        breakdown &&
        totals && (
          <>
            <StatStrip t={totals} />
            {trend && (
              <DailyBars
                trend={trend}
                range={range}
                filter={filter}
                onDay={(start) =>
                  onFilter({
                    bound: { mode: "fixed", start, end: start + DAY_MS },
                  })
                }
              />
            )}
            <KindTable
              {...kindRows(breakdown.byKind, hiddenKinds, hiddenOutcomes)}
              hiddenOutcomes={hiddenOutcomes}
              onToggleKind={(kind) =>
                onFilter({ hiddenKinds: toggled(hiddenKinds, kind) })
              }
              chips={
                <OutcomeChips
                  hidden={hiddenOutcomes}
                  onToggle={(o) =>
                    onFilter({ hiddenOutcomes: toggled(hiddenOutcomes, o) })
                  }
                />
              }
            />
            <ChannelTable
              rows={channelRows(
                breakdown.byChannel,
                hiddenKinds,
                hiddenOutcomes,
              )}
              hiddenOutcomes={hiddenOutcomes}
            />
          </>
        )
      )}
    </div>
  )
}
