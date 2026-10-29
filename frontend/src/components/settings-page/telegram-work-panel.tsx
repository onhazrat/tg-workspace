/**
 * Telegram work (RKD-02, ADR-040): one row per switchable Request kind with
 * its last 24 hours' Requests, their share and its queued messages beside the
 * On/Off pill, so an Operator sees what disabling a kind would stop before
 * doing it. Disabling asks first and states that impact; enabling applies at
 * once. The switches are the seven `jobs.deployment.<kind>RequestsEnabled`
 * Settings, shown here instead of as rows.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import {
  jobsListSyncLanes,
  type RequestKindSwitch,
  requestsReadRequestBreakdown,
  type SyncLaneEntry,
  settingsUpdateSetting,
} from "@/client"
import { BarToggle } from "@/components/channel-grid/ChannelBarControls"
import { kindColor, Swatch } from "@/components/requests/parts"
import { TgConfirmDialog } from "@/components/ui/tg-confirm-dialog"
import { queryKeys } from "@/hooks/queryKeys"
import { refreshRequestKinds, useRequestKinds } from "@/hooks/useRequestKinds"
import { fmt, pct, sinceLabel } from "@/lib/requests/breakdown"
import { DAY_MS } from "@/lib/scope/window"
import { extractErrorMessage } from "@/utils"

/** What a person meets once the kind is off: the spec's entry-point table. */
const WHEN_OFF: Record<string, string> = {
  auto: "Channels stop updating on their own: the scheduler enqueues no auto sync.",
  bulk: "Sync all and Reset and sync are greyed out; a bulk follow still follows, unsynced.",
  single: "The Sync button on a Channel is greyed out.",
  follow: "A bulk follow is refused before it checks a handle.",
  probe:
    "The Directory stops growing and refreshing: the probe sweep enqueues nothing.",
  handle: "Adding a Channel by handle is refused.",
  botApi: "Publish is greyed out; an auto-publish files a failed log.",
}

/** Messages queued now, summed per kind over the lanes its switch names. */
export function queuedByKind(
  switches: readonly RequestKindSwitch[],
  lanes: readonly SyncLaneEntry[],
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of switches) {
    const held = lanes.filter((lane) => s.lanes.includes(lane.lane))
    if (held.length) out[s.kind] = held.reduce((n, l) => n + l.queued, 0)
  }
  return out
}

/** The confirm's words: what the last day was, what stops, what waits. */
export function disableImpact(
  s: RequestKindSwitch,
  requests: number,
  queued: number | undefined,
): string {
  const held = queued
    ? ` ${fmt(queued)} queued messages will wait until you enable it again.`
    : ""
  return `${fmt(requests)} Requests in the last 24 hours were ${s.label}. ${WHEN_OFF[s.kind] ?? ""}${held} Anyone who asks for it reads: "${s.refusal}".`
}

export function TelegramWorkTable({
  switches,
  lastDay,
  queued,
  onSet,
}: {
  switches: readonly RequestKindSwitch[]
  lastDay: Record<string, number>
  queued: Record<string, number>
  onSet: (s: RequestKindSwitch, enabled: boolean) => void
}) {
  const [asking, setAsking] = useState<RequestKindSwitch | null>(null)
  const total = switches.reduce((n, s) => n + (lastDay[s.kind] ?? 0), 0)
  const th =
    "px-2 py-1.5 font-normal text-[11px] uppercase tracking-wider text-app-ink/50"
  return (
    <>
      <table className="w-full text-[12px]" data-testid="telegram-work">
        <thead>
          <tr>
            <th className={`${th} text-left`}>Kind</th>
            <th className={`${th} text-right`}>Last 24h</th>
            <th className={`${th} text-right max-sm:hidden`}>Share</th>
            <th className={`${th} text-right`}>Queued</th>
            <th className={`${th} text-right`}>Enabled</th>
          </tr>
        </thead>
        <tbody>
          {switches.map((s) => {
            const n = lastDay[s.kind] ?? 0
            return (
              <tr key={s.kind} className="border-t border-app-ink/5">
                <td className="px-2 py-1.5">
                  <span className="flex items-center gap-2">
                    <Swatch color={kindColor(s.kind)} />
                    {s.label}
                  </span>
                  {!s.enabled && (
                    <span className="block text-[10px] text-amber-600">
                      off
                      {s.disabledSince &&
                        ` since ${sinceLabel(s.disabledSince)}`}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {fmt(n)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-app-ink/60 max-sm:hidden">
                  {total ? pct(n / total) : "–"}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {s.kind in queued ? fmt(queued[s.kind]) : "–"}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <BarToggle
                    on={s.enabled}
                    label={s.enabled ? "On" : "Off"}
                    title={`${s.label} enabled`}
                    testId={`telegram-work-${s.kind}`}
                    onClick={() => (s.enabled ? setAsking(s) : onSet(s, true))}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <TgConfirmDialog
        open={asking !== null}
        onOpenChange={(open) => !open && setAsking(null)}
        title={asking ? `Disable ${asking.label}?` : ""}
        description={
          asking
            ? disableImpact(
                asking,
                lastDay[asking.kind] ?? 0,
                queued[asking.kind],
              )
            : ""
        }
        variant="dangerSoft"
        confirmLabel="Disable"
        confirmTestId="telegram-work-confirm"
        onConfirm={() => {
          if (asking) onSet(asking, false)
          setAsking(null)
        }}
      />
    </>
  )
}

/** Requests per kind over the last 24 hours, from the Requests Breakdown. */
function useLastDay(): Record<string, number> {
  const [range] = useState(() => {
    const end = Date.now()
    return {
      start: new Date(end - DAY_MS).toISOString(),
      end: new Date(end).toISOString(),
    }
  })
  const breakdown = useQuery({
    queryKey: queryKeys.requestBreakdown(range),
    queryFn: () => requestsReadRequestBreakdown({ query: range }),
  })
  return Object.fromEntries(
    (breakdown.data?.byKind ?? []).map((row) => [row.kind, row.requests]),
  )
}

export function TelegramWork() {
  const client = useQueryClient()
  const switches = useRequestKinds()
  const lastDay = useLastDay()
  const lanes = useQuery({
    queryKey: queryKeys.syncLanes,
    queryFn: () => jobsListSyncLanes(),
    refetchInterval: 15_000,
  })
  const set = async (s: RequestKindSwitch, enabled: boolean) => {
    try {
      await settingsUpdateSetting({
        path: { setting_id: s.settingId },
        body: { value: enabled },
      })
      await refreshRequestKinds()
      void client.invalidateQueries({ queryKey: queryKeys.settingsRegistry })
    } catch (err) {
      toast.error(extractErrorMessage(err))
    }
  }
  return (
    <TelegramWorkTable
      switches={switches}
      lastDay={lastDay}
      queued={queuedByKind(switches, lanes.data?.lanes ?? [])}
      onSet={(s, enabled) => void set(s, enabled)}
    />
  )
}
