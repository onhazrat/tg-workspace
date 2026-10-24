/**
 * A Channel table row's own Requests (RQS-10): a click on the row opens them
 * in a sheet, newest first, within the tab's range and the week each Request
 * is kept. The whole tab filter narrows them as it narrows the row: Charged,
 * the Accounts, hidden kinds and outcomes, the Channels left out, all asked
 * of the server so its pages stay whole. Grouping them into retry chains is
 * out of scope (spec).
 */
import { useInfiniteQuery } from "@tanstack/react-query"
import {
  type RequestRecord,
  type RequestRecordsResponse,
  requestsReadRequestRecords,
} from "@/client"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { queryKeys } from "@/hooks/queryKeys"
import {
  type ChannelRow,
  fmt,
  kindMeta,
  OUTCOMES,
  type Outcome,
  pickedQuery,
  type RequestsFilter,
} from "@/lib/requests/breakdown"
import {
  atText,
  causeText,
  RECORDS_PAGE,
  rowQuery,
} from "@/lib/requests/records"
import { OutcomeIcon } from "./parts"

export function RequestsSheet({
  row,
  range,
  filter,
  onClose,
}: {
  /** The row opened, or null while the sheet is shut. */
  row: ChannelRow | null
  range: { start: number; end: number }
  filter: RequestsFilter
  onClose: () => void
}) {
  const query = {
    start: new Date(range.start).toISOString(),
    end: new Date(range.end).toISOString(),
    ...pickedQuery(filter),
    hiddenKinds: [...filter.hiddenKinds].sort(),
    hiddenOutcomes: [...filter.hiddenOutcomes].sort(),
    ...(row ? rowQuery(row) : {}),
  }
  const { data, hasNextPage, fetchNextPage } = useInfiniteQuery({
    queryKey: queryKeys.requestRecords(row?.id ?? "", query),
    queryFn: ({ pageParam }) =>
      requestsReadRequestRecords({
        query: { ...query, offset: pageParam, limit: RECORDS_PAGE },
      }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const listed = pages.reduce((n, p) => n + p.records.length, 0)
      return listed < last.total ? listed : undefined
    },
    enabled: row !== null,
  })
  return (
    <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto sm:max-w-3xl"
        data-testid="requests-sheet"
      >
        <SheetHeader>
          <SheetTitle>{row?.label} · each Request</SheetTitle>
          <SheetDescription>
            In the tab's range, cut to the Requests still kept: older ones live
            on only in the hourly and daily totals. Times in UTC.
          </SheetDescription>
        </SheetHeader>
        <RequestList
          aggregate={row?.aggregate ?? false}
          pages={data?.pages}
          hiddenOutcomes={filter.hiddenOutcomes}
          onMore={hasNextPage ? () => fetchNextPage() : undefined}
        />
      </SheetContent>
    </Sheet>
  )
}

const th =
  "px-2 py-1.5 text-left font-normal text-[10px] uppercase tracking-wider text-app-ink/50"
const td = "px-2 py-1 tabular-nums whitespace-nowrap"

/** Which optional columns any listed Request fills. */
function columnsOf(records: RequestRecord[], aggregate: boolean) {
  return {
    handle: aggregate && records.some((r) => r.channel),
    account: records.some((r) => r.accountId),
    posts: records.some((r) => r.newPosts !== null),
  }
}

/** The counts on top, the table, and Show more while the server holds more. */
export function RequestList({
  aggregate,
  pages,
  hiddenOutcomes = new Set(),
  onMore,
}: {
  aggregate: boolean
  pages: RequestRecordsResponse[] | undefined
  /** Outcomes the tab hides: the server left them out, so no count shows. */
  hiddenOutcomes?: ReadonlySet<Outcome>
  onMore?: () => void
}) {
  if (!pages?.length)
    return <p className="px-4 text-[12px] text-app-ink/50">Loading…</p>
  const records = pages.flatMap((p) => p.records)
  const show = columnsOf(records, aggregate)
  return (
    <div className="space-y-3 px-4 pb-6 text-[12px]">
      <Counts answer={pages[0]} hidden={hiddenOutcomes} />
      {records.length === 0 ? (
        <p className="text-app-ink/50">No Requests in this range.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={th}>Time</th>
                <th className={th}>Kind</th>
                {show.handle && <th className={th}>Handle</th>}
                {show.account && <th className={th}>Account</th>}
                <th className={th}>Lane</th>
                <th className={th}>Outcome</th>
                <th className={th}>Cause</th>
                <th className={th}>Error</th>
                <th className={`${th} text-right`}>Try</th>
                <th className={`${th} text-right`}>ms</th>
                {show.posts && <th className={`${th} text-right`}>New</th>}
                {show.posts && <th className={`${th} text-right`}>Repeated</th>}
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <RecordTr key={r.id} r={r} show={show} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {onMore && (
        <button
          type="button"
          className="w-full rounded border border-app-ink/10 py-1.5 text-app-ink/60 hover:bg-app-ink/5"
          onClick={onMore}
        >
          Show more
        </button>
      )}
    </div>
  )
}

function Counts({
  answer,
  hidden,
}: {
  answer: RequestRecordsResponse
  hidden: ReadonlySet<Outcome>
}) {
  return (
    <div
      data-testid="requests-record-counts"
      className="flex flex-wrap gap-3 text-[11px] text-app-ink/70"
    >
      <span className="font-semibold text-app-ink">
        {fmt(answer.total)} Requests
      </span>
      {OUTCOMES.filter((o) => !hidden.has(o.id)).map((o) => (
        <span key={o.id} className="flex items-center gap-1">
          <OutcomeIcon outcome={o.id} />
          {fmt(answer[o.id])} {o.id}
        </span>
      ))}
    </div>
  )
}

function RecordTr({
  r,
  show,
}: {
  r: RequestRecord
  show: ReturnType<typeof columnsOf>
}) {
  const posts = (n: number | null) => (n === null ? "–" : fmt(n))
  return (
    <tr data-testid="requests-record" className="border-t border-app-ink/5">
      <td className={`${td} text-app-ink/70`}>{atText(r.at)}</td>
      <td className={td}>{kindMeta(r.kind).label}</td>
      {show.handle && <td className={td}>{r.channel && `@${r.channel}`}</td>}
      {show.account && (
        <td className={`${td} max-w-40 truncate text-app-ink/60`}>
          {r.email ?? ""}
        </td>
      )}
      <td className={`${td} text-app-ink/60`}>{r.lane}</td>
      <td className={td}>
        <span className="flex items-center gap-1">
          <OutcomeIcon outcome={r.outcome as Outcome} />
          {r.outcome}
        </span>
      </td>
      <td className={td}>{causeText(r.cause)}</td>
      <td className={`${td} text-app-ink/60`}>{r.errorCode ?? ""}</td>
      <td className={`${td} text-right`}>{r.attempt}</td>
      <td className={`${td} text-right text-app-ink/60`}>{fmt(r.latencyMs)}</td>
      {show.posts && (
        <td className={`${td} text-right`}>{posts(r.newPosts)}</td>
      )}
      {show.posts && (
        <td className={`${td} text-right text-app-ink/60`}>
          {posts(r.repeatedPosts)}
        </td>
      )}
    </tr>
  )
}
