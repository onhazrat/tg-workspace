// PROTOTYPE (request-stats): one Channel's individual Requests over the 7 days each Request
// is kept, in the app's Sheet. The record's fields are the plan's decision 1; the values are
// expanded from the Channel's real syncs (or the Directory's real probe verdicts). Never merge.
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { request } from "@/api/base"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  fmt,
  KIND_BY_SOURCE,
  KIND_LABEL,
  type Kind,
  noise,
  type Outcome,
  REQUEST_DAYS,
} from "./data"
import { KIND_COLOR, OUTCOME_COLOR, OUTCOME_ICON, Swatch } from "./shared"

type Answer = "answered" | "turned away" | "soft block" | "transport fault"

interface RequestRecord {
  at: number
  kind: Kind
  lane: string
  answer: Answer
  attempt: number
  latencyMs: number
  /** Whether the page changed anything: a new Post or a moved counter. */
  changed: boolean
  /** Only on a page of Posts; a probe's metadata page has none. */
  newPosts?: number
  repeated?: number
  outcome: Outcome
}

/** Posts on one page of Telegram's web view. */
const PAGE = 20

/**
 * A sync expands into its pages: one Request per page, the last page of a catch-up carrying
 * the overlap with Posts already stored as repeats. A failed sync is the attempt and its two
 * retries. Real: when, which kind, failed or not, how many new Posts. Invented: the Lane,
 * the latency, and which empty pages still moved a counter (a quarter of them).
 */
function expandSyncs(
  channel: string,
  syncs: [number, string, number, string, string][],
): RequestRecord[] {
  const out: RequestRecord[] = []
  for (const [ts, status, posts, source, error] of syncs) {
    const kind = KIND_BY_SOURCE[source] ?? "bulk"
    const lane = `Lane ${1 + Math.floor(noise(`${channel}${ts}`) * 4)}`
    const latency = (i: number) => Math.round(250 + noise(`${ts}~${i}`) * 1200)
    if (status === "failed") {
      const answer: Answer = /429|flood|too many/i.test(error)
        ? "turned away"
        : "transport fault"
      for (let attempt = 1; attempt <= 3; attempt++)
        out.push({
          at: ts + (attempt - 1) * 4000,
          kind,
          lane,
          answer,
          attempt,
          latencyMs: latency(attempt),
          changed: false,
          outcome: "wasted",
        })
      continue
    }
    const pages = 1 + Math.floor(posts / PAGE)
    let left = posts
    for (let i = 0; i < pages; i++) {
      const fresh = Math.min(PAGE, left)
      left -= fresh
      const repeated = i === pages - 1 ? PAGE - fresh : 0
      const changed = fresh > 0 || noise(`${ts}!${i}`) < 0.25
      out.push({
        at: ts + i * 900,
        kind,
        lane,
        answer: "answered",
        attempt: 1,
        latencyMs: latency(i),
        changed,
        newPosts: fresh,
        repeated,
        outcome: changed ? "useful" : "idle",
      })
    }
  }
  return out.sort((a, b) => b.at - a.at)
}

/** A probe reads a metadata page: no Posts, and a handle that is gone is a Wasted Request. */
function expandProbes(
  probes: [number, string, string, string][],
): (RequestRecord & { handle: string })[] {
  return probes.map(([at, status, handle]) => ({
    at,
    handle,
    kind: "probe",
    lane: `Lane ${1 + Math.floor(noise(handle) * 4)}`,
    answer: "answered",
    attempt: 1,
    latencyMs: Math.round(250 + noise(`${handle}~`) * 1200),
    changed: status === "ok",
    outcome: status === "ok" ? "useful" : "wasted",
  }))
}

const th =
  "px-2 py-1.5 text-left font-normal text-[10px] uppercase tracking-wider text-app-ink/50"
const td = "px-2 py-1 tabular-nums"
// UTC, like the rest of the tab and its range.
const when = (ms: number) =>
  new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(ms)

export function RequestsPanel({
  channel,
  aggregate,
  accountOf,
  range,
  onClose,
}: {
  /** A Channel's name, or an aggregate row's label. */
  channel: string | null
  aggregate: boolean
  /** Who a kind of work on this Channel is charged to, from the page's own facts. */
  accountOf: (kind: Kind) => string | undefined
  /** The tab's range, [start, end): only the Requests inside it are listed. */
  range: { start: number; end: number }
  onClose: () => void
}) {
  const [shown, setShown] = useState(200)
  const { data, isPending } = useQuery({
    queryKey: ["proto", "requests", channel],
    queryFn: () =>
      request<{
        syncs?: [number, string, number, string, string][]
        probes?: [number, string, string, string][]
      }>(
        `/proto/request-stats/requests?channel=${encodeURIComponent(channel ?? "")}`,
      ),
    enabled: channel !== null && (!aggregate || channel === "Directory probes"),
  })
  const records: (RequestRecord & { handle?: string })[] = (
    !data
      ? []
      : data.probes
        ? expandProbes(data.probes)
        : expandSyncs(channel ?? "", data.syncs ?? [])
  ).filter((r) => r.at >= range.start && r.at < range.end)
  const count = (o: Outcome) => records.filter((r) => r.outcome === o).length
  const posts = !aggregate || channel !== "Directory probes"
  return (
    <Sheet open={channel !== null} onOpenChange={(open) => !open && onClose()}>
      {/* req-proto: the Sheet portals out of the tab, and its colours live on that class. */}
      <SheetContent
        side="right"
        className="req-proto w-full gap-0 overflow-y-auto sm:max-w-3xl"
      >
        <SheetHeader>
          <SheetTitle>
            {aggregate ? channel : `@${channel}`} · each Request
          </SheetTitle>
          <SheetDescription>
            {when(
              Math.max(range.start, Date.now() - REQUEST_DAYS * 86_400_000),
            )}{" "}
            to {when(Math.min(range.end, Date.now()))} UTC: the tab's range,
            within the last {REQUEST_DAYS} days each Request is kept. Older
            Requests survive only in the hourly and daily totals.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-4 pb-6 text-[12px]">
          {channel === "Handle checks" ? (
            <p className="text-app-ink/60">
              Handle checks are counted nowhere today, so the prototype has no
              records to show for them.
            </p>
          ) : isPending ? (
            <p className="text-app-ink/50">Loading…</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-3 text-[11px] text-app-ink/70">
                <span className="font-semibold text-app-ink">
                  {data?.probes
                    ? `The latest ${fmt(records.length)} probes`
                    : `${fmt(records.length)} Requests`}
                </span>
                {(["useful", "idle", "wasted"] as const).map((o) => {
                  const Icon = OUTCOME_ICON[o]
                  return (
                    <span key={o} className="flex items-center gap-1">
                      <span style={{ color: OUTCOME_COLOR[o] }}>
                        <Icon size={12} />
                      </span>
                      {fmt(count(o))} {o}
                    </span>
                  )
                })}
              </div>
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={th}>When</th>
                    <th className={th}>Kind</th>
                    {!aggregate && <th className={th}>Account</th>}
                    {!posts && <th className={th}>Handle</th>}
                    <th className={th}>Lane</th>
                    <th className={th}>Answer</th>
                    <th className={`${th} text-right`}>Try</th>
                    <th className={`${th} text-right`}>ms</th>
                    {posts && <th className={`${th} text-right`}>New</th>}
                    {posts && <th className={`${th} text-right`}>Repeats</th>}
                    <th className={th}>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {records.slice(0, shown).map((r, i) => {
                    const Icon = OUTCOME_ICON[r.outcome]
                    return (
                      // biome-ignore lint/suspicious/noArrayIndexKey: one sync's pages share a second
                      <tr key={i} className="border-t border-app-ink/5">
                        <td
                          className={`${td} whitespace-nowrap text-app-ink/70`}
                        >
                          {when(r.at)}
                        </td>
                        <td className={td}>
                          <span className="flex items-center gap-1.5 whitespace-nowrap">
                            <Swatch color={KIND_COLOR[r.kind]} />
                            {KIND_LABEL[r.kind]}
                          </span>
                        </td>
                        {!aggregate && (
                          <td
                            className={`${td} max-w-32 truncate text-app-ink/60`}
                          >
                            {accountOf(r.kind) ?? "—"}
                          </td>
                        )}
                        {!posts && (
                          <td className={`${td} font-medium`}>@{r.handle}</td>
                        )}
                        <td
                          className={`${td} whitespace-nowrap text-app-ink/60`}
                        >
                          {r.lane}
                        </td>
                        <td
                          className={td}
                          style={{
                            color:
                              r.answer === "answered"
                                ? undefined
                                : OUTCOME_COLOR.wasted,
                          }}
                        >
                          {r.answer}
                        </td>
                        <td className={`${td} text-right`}>{r.attempt}</td>
                        <td className={`${td} text-right text-app-ink/60`}>
                          {fmt(r.latencyMs)}
                        </td>
                        {posts && (
                          <td className={`${td} text-right`}>
                            {r.newPosts ?? "—"}
                          </td>
                        )}
                        {posts && (
                          <td className={`${td} text-right text-app-ink/60`}>
                            {r.repeated ?? "—"}
                          </td>
                        )}
                        <td className={td}>
                          <span
                            className="flex items-center gap-1"
                            style={{ color: OUTCOME_COLOR[r.outcome] }}
                          >
                            <Icon size={12} />
                            <span className="text-app-ink/70">{r.outcome}</span>
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {records.length > shown && (
                <button
                  type="button"
                  className="w-full rounded border border-app-ink/10 py-1.5 text-app-ink/60 hover:bg-app-ink/5"
                  onClick={() => setShown(shown + 200)}
                >
                  Show 200 more
                </button>
              )}
              <p className="text-[11px] text-app-ink/40">
                Expanded from the real {posts ? "syncs" : "probe verdicts"}: one
                Request per page, and the last page of a catch-up carries the
                overlap as repeats. The Lane, the latency and which empty pages
                still moved a counter are invented.
              </p>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
