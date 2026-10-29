import { useState } from "react"
import { useTagHandles } from "@/hooks/useTags"
import { recordTagUse } from "@/hooks/useTagUses"
import { funnelledValues } from "@/lib/filter-tree"
import {
  type ChannelRow,
  type ChannelSort,
  channelColumns,
  FIRST_CHANNELS,
  fmt,
  listChannels,
  type Measure,
  MORE_CHANNELS,
  type Outcome,
  pct,
  type SortDirection,
  toggled,
} from "@/lib/requests/breakdown"
import { type ChannelFilter, keepRow } from "@/lib/requests/channel-filter"
import { newTagValues } from "@/lib/tags/tag-use"
import { ChannelBar } from "./ChannelBar"
import { td, th } from "./KindTable"
import { kindColor, OutcomeBar, Swatch } from "./parts"

/**
 * Channels by Requests (RQS-03, RQS-04): search and filters, sortable
 * columns, the first 25 and then 50 more. Directory probes and Handle checks
 * rank as rows of their own, and the bars scale to the busiest real Channel,
 * so an aggregate row runs full width rather than flattening every Channel.
 * A hidden outcome's columns go. Every row has a pick box: a row left out
 * leaves the whole tab but stays listed here, faded, to be picked again.
 * A row click opens its own Requests (RQS-10).
 */
export function ChannelTable({
  rows,
  hiddenOutcomes,
  hiddenKinds,
  filter,
  onFilter,
  leftOut,
  onLeftOut,
  onOpen,
}: {
  rows: ChannelRow[]
  hiddenOutcomes: ReadonlySet<Outcome>
  hiddenKinds: ReadonlySet<string>
  filter: ChannelFilter
  onFilter: (filter: ChannelFilter) => void
  /** The rows left out, by `ChannelRow.id`. */
  leftOut: ReadonlySet<string>
  onLeftOut: (leftOut: Set<string>) => void
  onOpen: (row: ChannelRow) => void
}) {
  const [search, setSearch] = useState("")
  const [chosenSort, setSort] = useState<ChannelSort>("total")
  const [chosenDirection, setDirection] = useState<SortDirection>("desc")
  const [shown, setShown] = useState(FIRST_CHANNELS)
  const columns = channelColumns(hiddenOutcomes)
  // Sorting by a hidden outcome's measure falls back to the busiest first,
  // and comes back when the outcome is shown again.
  const kept = !hiddenSort(chosenSort, hiddenOutcomes)
  const sort = kept ? chosenSort : "total"
  const direction = kept ? chosenDirection : "desc"
  const tagHandles = useTagHandles(funnelledValues(filter, "tag"))
  const listed = listChannels(
    rows,
    search,
    sort,
    direction,
    keepRow(filter, hiddenKinds, hiddenOutcomes, tagHandles),
  )
  /** Every filter change, from any control, records the Tags it adds. */
  const filterAndRecord = (next: ChannelFilter) => {
    recordTagUse("requests", ...newTagValues(filter, next))
    onFilter(next)
  }
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
  const restart =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v)
      setShown(FIRST_CHANNELS)
    }

  return (
    <section
      aria-labelledby="requests-by-channel"
      className="rounded-md border border-app-ink/10 bg-app-card"
    >
      <h3
        id="requests-by-channel"
        className="px-3 pt-2.5 text-sm font-semibold"
      >
        Channels by Requests
      </h3>
      <ChannelBar
        rows={rows}
        shown={listed.length}
        search={search}
        onSearch={restart(setSearch)}
        filter={filter}
        onFilter={restart(filterAndRecord)}
        sort={sort}
        onSort={(key) => {
          setSort(key)
          setDirection(key === "channel" ? "asc" : "desc")
        }}
        direction={direction}
        onToggleDirection={() =>
          setDirection(direction === "desc" ? "asc" : "desc")
        }
        hiddenKinds={hiddenKinds}
        hiddenOutcomes={hiddenOutcomes}
        leftOut={leftOut}
        onLeftOut={onLeftOut}
      />
      <table className="mt-1 w-full table-fixed text-[12px]">
        <thead>
          <tr>
            <th className={`${th} w-8`}>
              <PickEvery
                listed={listed}
                leftOut={leftOut}
                onLeftOut={onLeftOut}
              />
            </th>
            <th className={`${th} w-10 max-sm:hidden`}>#</th>
            <th className={`${th} w-1/4`}>{header("channel", "Channel")}</th>
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
                className={`${th} text-right ${narrowHidden(c.key)}`}
              >
                {header(c.key, c.label)}
              </th>
            ))}
            <th className={`${th} w-1/6 max-sm:hidden`}>
              <span className="sr-only">Outcomes</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {listed.slice(0, shown).map((r, i) => (
            <ChannelTr
              key={r.id}
              r={r}
              rank={i + 1}
              max={max}
              columns={columns.map((c) => c.key)}
              picked={!leftOut.has(r.id)}
              onPick={() => onLeftOut(toggled(leftOut, r.id))}
              onOpen={() => onOpen(r)}
            />
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

/** Whether `sort` reads an outcome that is hidden. */
const hiddenSort = (sort: ChannelSort, hidden: ReadonlySet<Outcome>) =>
  (hidden.has("idle") && (sort === "idle" || sort === "idleShare")) ||
  (hidden.has("wasted") && (sort === "wasted" || sort === "wasteShare"))

/** The shares and the yield give way at phone width. */
const narrowHidden = (key: Measure) =>
  key.endsWith("Share") || key === "postsPerReq" ? "max-sm:hidden" : ""

/** The header's box: every listed row picked, or none; mixed shows as such. */
function PickEvery({
  listed,
  leftOut,
  onLeftOut,
}: {
  listed: ChannelRow[]
  leftOut: ReadonlySet<string>
  onLeftOut: (leftOut: Set<string>) => void
}) {
  const out = listed.filter((r) => leftOut.has(r.id)).length
  return (
    <input
      type="checkbox"
      aria-label="Pick every listed row"
      title="Pick or leave out every row listed"
      checked={listed.length > 0 && out === 0}
      ref={(el) => {
        if (el) el.indeterminate = out > 0 && out < listed.length
      }}
      onChange={(e) => {
        const next = new Set(leftOut)
        for (const r of listed)
          if (e.target.checked) next.delete(r.id)
          else next.add(r.id)
        onLeftOut(next)
      }}
    />
  )
}

function ChannelTr({
  r,
  rank,
  max,
  columns,
  picked,
  onPick,
  onOpen,
}: {
  r: ChannelRow
  rank: number
  max: number
  columns: Measure[]
  picked: boolean
  onPick: () => void
  onOpen: () => void
}) {
  return (
    <tr
      data-testid="requests-channel-row"
      data-picked={picked}
      onClick={onOpen}
      title="Open this row's Requests"
      className={`cursor-pointer border-t border-app-ink/5 hover:bg-app-ink/5 ${r.aggregate ? "bg-app-ink/[0.04]" : ""} ${picked ? "" : "opacity-40"}`}
    >
      <td className="pl-3 max-sm:pl-1.5">
        <input
          type="checkbox"
          aria-label={`Pick ${r.label}`}
          checked={picked}
          onClick={(e) => e.stopPropagation()}
          onChange={onPick}
        />
      </td>
      <td className={`${td} text-app-ink/40 max-sm:hidden`}>{rank}</td>
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
        <ChannelCell key={c} column={c} row={r} />
      ))}
      <td className="px-3 py-1.5 max-sm:hidden">
        <OutcomeBar t={r} max={max} />
      </td>
    </tr>
  )
}

/** New Posts a Request brought: one decimal under 10. */
const yieldText = (v: number) =>
  v === 0 ? "0" : v < 10 ? v.toFixed(1) : fmt(Math.round(v))

function ChannelCell({ column, row }: { column: Measure; row: ChannelRow }) {
  if (column === "postsPerReq") return <YieldCell row={row} />
  if (column === "total")
    return (
      <td className={`${td} text-right font-semibold`}>{fmt(row.total)}</td>
    )
  if (column === "idleShare" || column === "wasteShare") {
    const part = column === "idleShare" ? row.idle : row.wasted
    return (
      <td className={`${td} text-right text-app-ink/60 max-sm:hidden`}>
        {pct(row.total ? part / row.total : 0)}
      </td>
    )
  }
  return <td className={`${td} text-right`}>{fmt(row[column] as number)}</td>
}

/** New Posts per Request: 20 is a full page, 0 nothing new; a dash where none. */
function YieldCell({ row }: { row: ChannelRow }) {
  const none = row.aggregate || !row.total
  return (
    <td
      className={`${td} text-right text-app-ink/70 max-sm:hidden`}
      title={
        none
          ? undefined
          : `${pct(row.posts / (row.total * 20))} of a 20-Post page per Request`
      }
    >
      {none ? "–" : yieldText(row.posts / row.total)}
    </td>
  )
}
