// PROTOTYPE (request-stats) variant A: ranked tables. Never merge.
import { Fragment, useState } from "react"
import type { SortDirection } from "@/components/filter-tree/SortPicker"
import { addFunnel, funnelledValues, removeFunnel } from "@/lib/filter-tree"
import {
  applyRowFilter,
  ChannelBar,
  emptyRowFilter,
  type Measure,
  measureLabel,
  measureOf,
  type RowFilter,
} from "./channel-bar"
import {
  type ChannelRow,
  channelRows,
  fmt,
  groupBy,
  KINDS,
  type Kind,
  OUTCOMES,
  type Outcome,
  pct,
  type Tally,
} from "./data"
import { RequestsPanel } from "./requests-panel"
import {
  KIND_COLOR,
  OUTCOME_COLOR,
  OUTCOME_ICON,
  OutcomeBar,
  OutcomeToggles,
  Swatch,
  toggleIn,
  type VariantProps,
} from "./shared"

type SortKey =
  | "total"
  | "wasted"
  | "idle"
  | "idleShare"
  | "wasteShare"
  | "postsPerReq"
/** `outcome` names the outcome a column is about: hiding that outcome hides the column. */
const SORTS: { key: SortKey; label: string; outcome?: Outcome }[] = [
  { key: "total", label: "Requests" },
  { key: "idle", label: "Idle", outcome: "idle" },
  { key: "wasted", label: "Wasted", outcome: "wasted" },
  { key: "idleShare", label: "Idle %", outcome: "idle" },
  { key: "wasteShare", label: "Wasted %", outcome: "wasted" },
  { key: "postsPerReq", label: "New Posts / Req" },
]

/** New Posts a Request brought: one decimal under 10. */
const yieldText = (v: number) =>
  v === 0 ? "0" : v < 10 ? v.toFixed(1) : fmt(v)
/** The sort value: the aggregate rows fetch no Posts at all, so they go last either way. */
const sortValue = (r: ChannelRow, sort: Measure, sign: number) =>
  sort === "postsPerReq" && r.aggregate
    ? sign * Number.POSITIVE_INFINITY
    : (measureOf(r, sort) ?? 0)

const th =
  "px-3 py-2 text-left font-normal text-[11px] uppercase tracking-wider text-app-ink/50"
const td = "px-3 py-1.5 tabular-nums"

const toggle = toggleIn

export function VariantA({
  channelFacts,
  accounts = [],
  filter,
  allChannelFacts,
  channelsOff,
  onChannelsOff,
  hiddenOutcomes,
  onHiddenOutcomes: setHiddenOutcomes,
  hiddenKinds,
  onHiddenKinds: setHiddenKinds,
}: VariantProps) {
  const [opened, setOpened] = useState<ChannelRow | null>(null)
  // Hidden kinds and outcomes drop out of every share, bar and percentage below, so
  // what is left reads in proportion to itself.
  const outcomeFacts = channelFacts.filter(
    (x) => !hiddenOutcomes.has(x.outcome),
  )
  const visibleFacts = outcomeFacts.filter((x) => !hiddenKinds.has(x.kind))
  const byKind = groupBy(outcomeFacts, (x) => x.kind)
  const kindMax = Math.max(
    0,
    ...[...byKind.entries()]
      .filter(([k]) => !hiddenKinds.has(k))
      .map(([, t]) => t.total),
  )
  const [chosenSort, setSort] = useState<Measure | "channel">("total")
  const [direction, setDirection] = useState<SortDirection>("desc")
  const columns = SORTS.filter(
    (c) => !c.outcome || !hiddenOutcomes.has(c.outcome),
  )
  // Sorting by a hidden outcome falls back to Requests, and comes back when it is shown again.
  const sort =
    chosenSort === "channel" ||
    chosenSort === "posts" ||
    columns.some((c) => c.key === chosenSort)
      ? chosenSort
      : "total"
  const without = [
    ...KINDS.filter((k) => hiddenKinds.has(k.id)).map((k) => k.label),
    ...OUTCOMES.filter((o) => hiddenOutcomes.has(o.id)).map((o) => o.label),
  ]
  const [shown, setShown] = useState(25)
  const [search, setSearch] = useState("")
  const [rowFilter, setRowFilter] = useState<RowFilter>(emptyRowFilter)
  const funnelled = funnelledValues(rowFilter, "kind")
  // Rows tally only the shown outcomes, but keep each sync's real counts. Every Channel is
  // listed, picked or not, so one left out can be picked again.
  const ranked = channelRows(
    allChannelFacts.filter((x) => !hiddenKinds.has(x.kind)),
    hiddenOutcomes,
  )
  const sign = direction === "desc" ? -1 : 1
  const rows = applyRowFilter(
    ranked,
    search,
    rowFilter,
    hiddenOutcomes,
    hiddenKinds,
  ).sort((a, b) =>
    sort === "channel"
      ? sign * a.channel.localeCompare(b.channel)
      : sign * (sortValue(a, sort, sign) - sortValue(b, sort, sign)) || 0,
  )
  // Against the busiest real Channel: an aggregate row is ~1,000 of them and caps at full width.
  const rowMax = Math.max(
    0,
    ...rows.filter((r) => !r.aggregate).map((r) => r.total),
  )
  const grand = visibleFacts.reduce((s, x) => s + x.requests, 0)
  const shownOutcome = (o: Outcome, part: number, whole: number) =>
    hiddenOutcomes.has(o) ? "—" : pct(part, whole)
  const funnelKind = (k: Kind) =>
    setRowFilter(
      funnelled.includes(k)
        ? removeFunnel(rowFilter, "kind", k)
        : addFunnel(rowFilter, { type: "kind", value: k }),
    )

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-app-ink/10 bg-app-card">
        <div className="flex items-center px-3 pt-2.5">
          <h3 className="text-sm font-semibold">By kind of work</h3>
          <span className="ml-auto">
            <OutcomeToggles
              hidden={hiddenOutcomes}
              onHidden={setHiddenOutcomes}
            />
          </span>
        </div>
        <table className="w-full text-[12px]">
          <thead>
            <tr>
              <th className={`${th} w-8`}>
                <span className="sr-only">Shown</span>
              </th>
              <th className={th}>Kind</th>
              <th className={`${th} text-right`}>Requests</th>
              <th className={`${th} text-right`}>Share</th>
              <th className={`${th} w-1/2`}>Useful · Idle · Wasted</th>
              <th className={`${th} text-right`}>Idle</th>
              <th className={`${th} text-right`}>Wasted</th>
            </tr>
          </thead>
          <tbody>
            {KINDS.filter((k) => byKind.has(k.id))
              .sort(
                (a, b) =>
                  (byKind.get(b.id)?.total ?? 0) -
                  (byKind.get(a.id)?.total ?? 0),
              )
              .map((k) => {
                const t = byKind.get(k.id) as Tally
                const off = hiddenKinds.has(k.id)
                return (
                  <tr
                    key={k.id}
                    className={`cursor-pointer border-t border-app-ink/5 hover:bg-app-ink/5 ${funnelled.includes(k.id) ? "bg-app-ink/10" : ""} ${off ? "opacity-40" : ""}`}
                    onClick={() => funnelKind(k.id)}
                  >
                    <td className="pl-3">
                      <input
                        type="checkbox"
                        aria-label={`Show ${k.label}`}
                        checked={!off}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() =>
                          setHiddenKinds(toggle(hiddenKinds, k.id))
                        }
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="flex items-center gap-2">
                        <Swatch color={KIND_COLOR[k.id]} />
                        {k.label}
                        {!k.charged && (
                          <span className="text-[10px] text-app-ink/40">
                            uncharged
                          </span>
                        )}
                      </span>
                    </td>
                    <td className={`${td} text-right font-semibold`}>
                      {fmt(t.total)}
                    </td>
                    <td className={`${td} text-right text-app-ink/60`}>
                      {off ? "—" : pct(t.total, grand)}
                    </td>
                    <td className="px-3 py-1.5">
                      {!off && <OutcomeBar t={t} max={kindMax} />}
                    </td>
                    <td
                      className={`${td} text-right`}
                      style={{ color: t.idle ? undefined : "var(--viz-axis)" }}
                    >
                      {shownOutcome("idle", t.idle, t.total)}
                    </td>
                    <td className={`${td} text-right`}>
                      {shownOutcome("wasted", t.wasted, t.total)}
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
        <p className="px-3 pb-2 text-[11px] text-app-ink/40">
          Tick a kind or an outcome off to see the rest in proportion. Click a
          kind to add it to the Channels filter below.
        </p>
      </section>

      <section className="rounded-md border border-app-ink/10 bg-app-card">
        <div className="flex flex-wrap items-center gap-2 px-3 pt-2.5">
          <h3 className="text-sm font-semibold">
            Channels by {sort === "channel" ? "name" : measureLabel(sort)}
            {without.length > 0 && (
              <span className="font-normal text-app-ink/60">
                {" "}
                · without {without.join(", ")}
              </span>
            )}
          </h3>
        </div>
        <ChannelBar
          rows={ranked}
          shown={rows.length}
          search={search}
          onSearch={(v) => {
            setSearch(v)
            setShown(25)
          }}
          filter={rowFilter}
          onFilter={(f) => {
            setRowFilter(f)
            setShown(25)
          }}
          sort={sort}
          onSort={setSort}
          direction={direction}
          onToggleDirection={() =>
            setDirection(direction === "desc" ? "asc" : "desc")
          }
          hiddenKinds={hiddenKinds}
          hiddenOutcomes={hiddenOutcomes}
        />
        <table className="w-full text-[12px]">
          <thead>
            <tr>
              <th className={`${th} w-8`}>
                <input
                  type="checkbox"
                  aria-label="Pick every listed Channel"
                  title="Pick or leave out every Channel listed"
                  checked={rows.every((r) => !channelsOff.has(r.channel))}
                  ref={(el) => {
                    if (el)
                      el.indeterminate =
                        rows.some((r) => channelsOff.has(r.channel)) &&
                        rows.some((r) => !channelsOff.has(r.channel))
                  }}
                  onChange={(e) => {
                    const next = new Set(channelsOff)
                    for (const r of rows)
                      e.target.checked
                        ? next.delete(r.channel)
                        : next.add(r.channel)
                    onChannelsOff(next)
                  }}
                />
              </th>
              <th className={th}>#</th>
              <th className={th}>Channel</th>
              {columns.map((s) => (
                <th key={s.key} className={`${th} text-right`}>
                  <button
                    type="button"
                    className={
                      sort === s.key
                        ? "font-semibold text-app-ink"
                        : "hover:text-app-ink"
                    }
                    onClick={() =>
                      sort === s.key
                        ? setDirection(direction === "desc" ? "asc" : "desc")
                        : (setSort(s.key), setDirection("desc"))
                    }
                  >
                    {s.label}
                    {sort === s.key ? (direction === "desc" ? " ↓" : " ↑") : ""}
                  </button>
                </th>
              ))}
              <th className={`${th} w-1/4`} />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((r, i) => (
              <ChannelTr
                key={r.channel}
                r={r}
                i={i}
                max={rowMax}
                columns={columns}
                picked={!channelsOff.has(r.channel)}
                onPick={() => onChannelsOff(toggle(channelsOff, r.channel))}
                onOpen={() => setOpened(r)}
              />
            ))}
          </tbody>
        </table>
        {rows.length > shown && (
          <button
            type="button"
            className="w-full border-t border-app-ink/5 py-2 text-[12px] text-app-ink/60 hover:bg-app-ink/5"
            onClick={() => setShown(shown + 50)}
          >
            Show 50 more
          </button>
        )}
      </section>
      <RequestsPanel
        range={filter}
        channel={opened?.channel ?? null}
        aggregate={opened?.aggregate ?? false}
        accountOf={(k) => {
          const id = allChannelFacts.find(
            (x) => x.channel === opened?.channel && x.kind === k,
          )?.account
          return accounts.find((a) => a.id === id)?.email
        }}
        onClose={() => setOpened(null)}
      />
    </div>
  )
}

const CELL: Record<SortKey, (r: ChannelRow) => React.ReactNode> = {
  total: (r) => (
    <td className={`${td} text-right font-semibold`}>{fmt(r.total)}</td>
  ),
  idle: (r) => (
    <td
      className={`${td} text-right`}
      style={{ color: r.idle ? OUTCOME_COLOR.idle : "var(--viz-axis)" }}
    >
      {fmt(r.idle)}
    </td>
  ),
  wasted: (r) => (
    <td
      className={`${td} text-right`}
      style={{
        color: r.wasted >= 1 ? OUTCOME_COLOR.wasted : "var(--viz-axis)",
      }}
    >
      {fmt(r.wasted)}
    </td>
  ),
  idleShare: (r) => (
    <td className={`${td} text-right text-app-ink/60`}>
      {pct(r.idle, r.total)}
    </td>
  ),
  wasteShare: (r) => (
    <td className={`${td} text-right text-app-ink/60`}>
      {pct(r.wasted, r.total)}
    </td>
  ),
  postsPerReq: (r) => (
    <td
      className={`${td} text-right text-app-ink/70`}
      title={
        r.aggregate || !r.total
          ? undefined
          : `${pct(r.posts, r.total * 20)} of a 20-Post page per Request`
      }
    >
      {r.aggregate || !r.total ? "—" : yieldText(r.posts / r.total)}
    </td>
  ),
}

function ChannelTr({
  r,
  i,
  max,
  columns,
  picked,
  onPick,
  onOpen,
}: {
  r: ChannelRow
  i: number
  max: number
  columns: typeof SORTS
  picked: boolean
  onPick: () => void
  onOpen: () => void
}) {
  return (
    <tr
      className={`cursor-pointer border-t border-app-ink/5 hover:bg-app-ink/5 ${r.aggregate ? "bg-app-ink/[0.04]" : ""} ${picked ? "" : "opacity-40"}`}
      onClick={onOpen}
      title="Open this row's Requests from the last 7 days"
    >
      <td className="pl-3">
        <input
          type="checkbox"
          aria-label={`Pick ${r.aggregate ? r.channel : `@${r.channel}`}`}
          checked={picked}
          onClick={(e) => e.stopPropagation()}
          onChange={onPick}
        />
      </td>
      <td className={`${td} text-app-ink/40`}>{i + 1}</td>
      <td className="px-3 py-1.5">
        <span className="flex items-center gap-2">
          <Swatch color={KIND_COLOR[r.mainKind]} />
          <span className={r.aggregate ? "italic" : "font-medium"}>
            {r.aggregate ? r.channel : `@${r.channel}`}
          </span>
        </span>
      </td>
      {columns.map((c) => (
        <Fragment key={c.key}>{CELL[c.key](r)}</Fragment>
      ))}
      <td className="px-3 py-1.5">
        <OutcomeBar t={r} max={max} />
      </td>
    </tr>
  )
}
