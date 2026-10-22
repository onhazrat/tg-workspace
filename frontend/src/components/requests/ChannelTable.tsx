import { useState } from "react"
import {
  type ChannelRow,
  type ChannelSort,
  channelColumns,
  FIRST_CHANNELS,
  fmt,
  listChannels,
  MORE_CHANNELS,
  type Outcome,
  pct,
  type SortDirection,
} from "@/lib/requests/breakdown"
import { td, th } from "./KindTable"
import { kindColor, OutcomeBar, Swatch } from "./parts"

/**
 * Channels by Requests (RQS-03): search, sortable columns, the first 25 and
 * then 50 more. Directory probes and Handle checks rank as rows of their own,
 * and the bars scale to the busiest real Channel, so an aggregate row runs
 * full width rather than flattening every Channel. A hidden outcome's
 * columns go.
 */
export function ChannelTable({
  rows,
  hiddenOutcomes,
}: {
  rows: ChannelRow[]
  hiddenOutcomes: ReadonlySet<Outcome>
}) {
  const [search, setSearch] = useState("")
  const [chosenSort, setSort] = useState<ChannelSort>("total")
  const [chosenDirection, setDirection] = useState<SortDirection>("desc")
  const [shown, setShown] = useState(FIRST_CHANNELS)
  const columns = channelColumns(hiddenOutcomes)
  // Sorting by a hidden outcome's column falls back to the busiest first, and
  // comes back when the outcome is shown again.
  const kept =
    chosenSort === "channel" || columns.some((c) => c.key === chosenSort)
  const sort = kept ? chosenSort : "total"
  const direction = kept ? chosenDirection : "desc"
  const listed = listChannels(rows, search, sort, direction)
  const max = Math.max(
    0,
    ...listed.filter((r) => !r.aggregate).map((r) => r.total),
  )
  const sortBy = (key: ChannelSort) => {
    setSort(key)
    if (key === sort) setDirection(direction === "desc" ? "asc" : "desc")
    else setDirection(key === "channel" ? "asc" : "desc")
  }
  const header = (key: ChannelSort, label: string) => (
    <button
      type="button"
      onClick={() => sortBy(key)}
      className={`uppercase ${sort === key ? "font-semibold text-app-ink" : "hover:text-app-ink"}`}
    >
      {label}
      {sort === key && (direction === "desc" ? " ↓" : " ↑")}
    </button>
  )

  return (
    <section
      aria-labelledby="requests-by-channel"
      className="rounded-md border border-app-ink/10 bg-app-card"
    >
      <div className="flex flex-wrap items-center gap-2 px-3 pt-2.5">
        <h3 id="requests-by-channel" className="text-sm font-semibold">
          Channels by Requests
        </h3>
        <input
          type="search"
          aria-label="Search Channels"
          placeholder="Search Channels"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setShown(FIRST_CHANNELS)
          }}
          className="ml-auto h-7 w-48 max-w-full rounded border border-app-ink/15 bg-transparent px-2 text-[12px]"
        />
      </div>
      <table className="w-full table-fixed text-[12px]">
        <thead>
          <tr>
            <th className={`${th} w-10`}>#</th>
            <th className={`${th} w-1/3`}>{header("channel", "Channel")}</th>
            {columns.map((c) => (
              <th
                key={c.key}
                aria-sort={
                  sort === c.key
                    ? direction === "desc"
                      ? "descending"
                      : "ascending"
                    : undefined
                }
                className={`${th} text-right ${c.key.endsWith("Share") ? "max-sm:hidden" : ""}`}
              >
                {header(c.key, c.label)}
              </th>
            ))}
            <th className={`${th} w-1/5 max-sm:hidden`}>
              <span className="sr-only">Outcomes</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {listed.slice(0, shown).map((r, i) => (
            <tr
              key={`${r.aggregate}:${r.key}`}
              data-testid="requests-channel-row"
              className={`border-t border-app-ink/5 ${r.aggregate ? "bg-app-ink/[0.04]" : ""}`}
            >
              <td className={`${td} text-app-ink/40`}>{i + 1}</td>
              <td className="px-3 py-1.5 max-sm:px-1.5">
                <span className="flex min-w-0 items-center gap-2">
                  <Swatch color={kindColor(r.mainKind)} />
                  <span
                    className={`truncate ${r.aggregate ? "italic" : "font-medium"}`}
                  >
                    {r.label}
                  </span>
                </span>
              </td>
              {columns.map((c) => (
                <ChannelCell key={c.key} column={c.key} row={r} />
              ))}
              <td className="px-3 py-1.5 max-sm:hidden">
                <OutcomeBar t={r} max={max} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {listed.length === 0 && (
        <p className="px-3 py-4 text-center text-[12px] text-app-ink/50">
          {rows.length ? "No Channel matches." : "No Requests in this range."}
        </p>
      )}
      {listed.length > shown && (
        <button
          type="button"
          className="w-full border-t border-app-ink/5 py-2 text-[12px] text-app-ink/60 hover:bg-app-ink/5"
          onClick={() => setShown(shown + MORE_CHANNELS)}
        >
          Show {fmt(Math.min(MORE_CHANNELS, listed.length - shown))} more
        </button>
      )}
    </section>
  )
}

function ChannelCell({
  column,
  row,
}: {
  column: Exclude<ChannelSort, "channel">
  row: ChannelRow
}) {
  if (column === "total")
    return (
      <td className={`${td} text-right font-semibold`}>{fmt(row.total)}</td>
    )
  if (column === "idle" || column === "wasted")
    return <td className={`${td} text-right`}>{fmt(row[column])}</td>
  const part = column === "idleShare" ? row.idle : row.wasted
  return (
    <td className={`${td} text-right text-app-ink/60 max-sm:hidden`}>
      {pct(row.total ? part / row.total : 0)}
    </td>
  )
}
