import { Users } from "lucide-react"
import type {
  AccountRequestTotals,
  RequestBreakdownResponse,
  RequestTrendResponse,
} from "@/client"
import { FilterBar } from "@/components/FilterBar"
import { FacetMenu } from "@/components/filter-tree/FacetMenu"
import { TimeBoundBar } from "@/components/TimeBoundEditor"
import { TgInlineChoice } from "@/components/ui/tg-inline-segments"
import {
  type AccountRow,
  accountRows,
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
import { AccountCompare } from "./AccountCompare"
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
  byAccount = [],
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
  /** Every Account's charged Requests in the range, whichever are picked. */
  byAccount?: readonly AccountRequestTotals[]
  breakdown?: RequestBreakdownResponse
  /** The range in buckets, for the daily bars (RQS-06). */
  trend?: RequestTrendResponse
  error?: unknown
  phone?: boolean
}) {
  const { hiddenKinds, hiddenOutcomes } = filter
  const totals = breakdown && statTotals(breakdown.byKind)
  const everyAccount = accountRows(byAccount, new Set(), new Set())
  // Colours follow the Account, ordered by email, never its rank or the pick.
  const every = [...everyAccount]
    .sort((a, b) => a.email.localeCompare(b.email))
    .map((a) => a.id)
  return (
    <div className="space-y-3 pb-16" data-testid="requests-tab">
      <FilterBar
        phone={phone}
        testIdPrefix="requests"
        active={Number(filter.charged !== "all") + filter.accounts.length}
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
            <AccountsFacet
              everyAccount={everyAccount}
              picked={filter.accounts}
              onPick={(accounts) => onFilter({ accounts })}
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
            {filter.accounts.length > 0 && (
              <span
                data-testid="requests-uncharged-hidden"
                className="text-app-ink/50"
              >
                Uncharged hidden, because no Account pays for it
              </span>
            )}
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
            {filter.accounts.length > 1 && (
              <AccountCompare
                rows={accountRows(
                  breakdown.byAccount,
                  hiddenKinds,
                  hiddenOutcomes,
                )}
                every={every}
                hiddenKinds={hiddenKinds}
                hiddenOutcomes={hiddenOutcomes}
              />
            )}
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

/** The Accounts facet (RQS-05): each Account's charged Requests; a funnel picks it. */
function AccountsFacet({
  everyAccount,
  picked,
  onPick,
}: {
  everyAccount: readonly AccountRow[]
  picked: readonly string[]
  onPick: (accounts: string[]) => void
}) {
  const label = (a: AccountRow) => a.email || "Deleted Account"
  return (
    <FacetMenu
      icon={<Users size={12} />}
      label="Accounts"
      noun="Account"
      testId="requests-accounts"
      countLabel="charged Requests"
      rows={everyAccount.map((a) => ({
        id: a.id,
        label: label(a),
        selected: 0,
        total: a.total,
        tick: "false" as const,
      }))}
      funnelled={[...picked]}
      labelOf={(id) => {
        const account = everyAccount.find((a) => a.id === id)
        return account ? label(account) : id
      }}
      onFunnel={(id, on) =>
        onPick(on ? [...picked, id] : picked.filter((x) => x !== id))
      }
      onClearFunnels={() => onPick([])}
    />
  )
}
