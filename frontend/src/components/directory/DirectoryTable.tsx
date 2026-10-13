import {
  ArrowDown,
  ArrowUp,
  Check,
  EyeOff,
  Plus,
  Tag,
  Undo2,
} from "lucide-react"
import type React from "react"
import type { DirectoryRowResponse, TagResponse } from "@/client"
import { ChannelAvatar } from "@/components/ChannelAvatar"
import { RelativeTime } from "@/components/RelativeTime"
import { TgButton } from "@/components/ui/tg-button"
import { type MeasureKey, measureOf } from "@/lib/directory/directory-filter"
import type { DirectorySort } from "@/lib/directory/directory-view"
import { formatCount } from "@/lib/format-count"
import {
  headerCheckboxState,
  toggleSelectAllUnfollowed,
  toggleUnfollowedSelection,
} from "@/lib/posts/discover-selection"
import { telegramWebViewChannelUrl } from "@/lib/telegram-web"
import { DIRECTORY_SHORTCUTS } from "./DirectoryKeyboard"
import { DirectoryMatchRow } from "./DirectoryMatches"
import { TagBadges, TagPicker } from "./DirectoryTags"

export const PAGE_SIZE = 100

type Row = DirectoryRowResponse

/** The Account's Tags and how one Channel's change (DFP-04). */
export type RowTagging = {
  tags: TagResponse[]
  onTag: (handle: string, name: string, on: boolean) => void
}

/** A row's Tag picker; `t` presses it in keyboard mode. */
export function RowTagButton({
  row,
  tagging,
}: {
  row: Pick<Row, "handle" | "tags">
  tagging: RowTagging
}) {
  return (
    <span onClick={(e) => e.stopPropagation()}>
      <TagPicker
        tags={tagging.tags}
        current={row.tags}
        align="end"
        onPick={(name) => tagging.onTag(row.handle, name, true)}
        onUnpick={(name) => tagging.onTag(row.handle, name, false)}
        trigger={
          <TgButton
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Tag @${row.handle}`}
            data-shortcut={DIRECTORY_SHORTCUTS.tag}
            className="h-7 rounded-full px-2 text-app-ink/50"
          >
            <Tag size={11} />
          </TgButton>
        }
      />
    </span>
  )
}

type SharedKey = "shared_parents" | "shared_children"

export type DirectoryColumn = {
  key: "language" | "mine" | MeasureKey | SharedKey
  label: string
  description: string
}

const measureColumn = (key: MeasureKey): DirectoryColumn => ({
  key,
  label: measureOf(key).short,
  description: measureOf(key).description,
})

/**
 * The columns a Columns menu can hide, in table order; the Channel and the
 * actions always show.
 */
export const COLUMNS: DirectoryColumn[] = [
  {
    key: "language",
    label: "Lang",
    description: "The Language the Directory read from its Posts",
  },
  measureColumn("subscribers"),
  measureColumn("reach"),
  measureColumn("posts_per_week"),
  measureColumn("forward_pct"),
  measureColumn("last_post_days"),
  {
    key: "mine",
    label: "Yours",
    description: "How many of your channels cite it, and when one last did",
  },
  measureColumn("cited_by"),
  measureColumn("cites"),
  measureColumn("found_days"),
]

/**
 * Shared parents and Shared children (DIR-07): shown only while their
 * Condition is on, which is when the rows carry a count, so the Columns menu
 * does not list them.
 */
const SHARED_COLUMNS: DirectoryColumn[] = [
  {
    key: "shared_parents",
    label: "Parents",
    description:
      "Shared parents: how many channels citing your Seeds also cite it. Sorts by that count weighed against how many cite it overall.",
  },
  {
    key: "shared_children",
    label: "Children",
    description:
      "Shared children: how many channels your Seeds cite it cites too. Sorts by that count weighed against how many it cites overall.",
  },
]

const sharedCount = (key: SharedKey, r: Row) =>
  key === "shared_parents" ? r.sharedParents : r.sharedChildren

const count = (n: number | null) => (n === null ? "" : formatCount(n))

/** What one column shows for a row. */
export function cell(key: DirectoryColumn["key"], r: Row): React.ReactNode {
  switch (key) {
    case "language":
      return r.language ?? ""
    case "reach":
      return (
        <>
          {count(r.reach)}
          {r.reachEstimated && <span title="Estimated Reach">~</span>}
        </>
      )
    case "posts_per_week":
      return r.postsPerWeek === null
        ? ""
        : r.postsPerWeek.toFixed(r.postsPerWeek < 10 ? 1 : 0)
    case "forward_pct":
      return r.forwardShare === null
        ? ""
        : `${Math.round(r.forwardShare * 100)}%`
    case "last_post_days":
      return r.lastPostAt === null ? (
        ""
      ) : (
        <RelativeTime timestamp={r.lastPostAt} />
      )
    case "found_days":
      return <RelativeTime timestamp={r.foundAt} />
    case "cited_by":
      return count(r.citedBy)
    case "shared_parents":
    case "shared_children":
      return count(sharedCount(key, r))
    case "mine":
      return r.mine ? (
        <>
          <b>{r.mine}</b>
          {r.mineLastAt !== null && (
            <span className="text-app-ink/40">
              {" · "}
              <RelativeTime timestamp={r.mineLastAt} />
            </span>
          )}
        </>
      ) : (
        ""
      )
    default:
      return count(r[key])
  }
}

function HeaderTick({
  rows,
  ticks,
  onTicks,
}: {
  rows: Row[]
  ticks: ReadonlySet<string>
  onTicks: (next: Set<string>) => void
}) {
  // Every row ticks, followed or not, so a follow can be a Seed (DFP-01).
  const selectable = rows.map((r) => ({ name: r.handle, isFollowed: false }))
  const state = headerCheckboxState(selectable, ticks)
  return (
    <input
      type="checkbox"
      aria-label="Tick every channel on this page"
      checked={state === "checked"}
      ref={(el) => {
        if (el) el.indeterminate = state === "indeterminate"
      }}
      onChange={() => onTicks(toggleSelectAllUnfollowed(selectable, ticks))}
      className="accent-blue-600"
    />
  )
}

/** Following, or a Follow button; the panel shows the same one. */
function FollowButton({
  row,
  busy,
  onFollow,
}: {
  row: Pick<Row, "handle" | "followed">
  busy: boolean
  onFollow: (handle: string) => void
}) {
  if (row.followed) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-app-ink/50">
        <Check size={11} /> Following
      </span>
    )
  }
  return (
    <TgButton
      type="button"
      variant="secondary"
      size="sm"
      aria-label={`Follow @${row.handle}`}
      data-shortcut={DIRECTORY_SHORTCUTS.follow}
      loading={busy}
      onClick={(e) => {
        e.stopPropagation()
        onFollow(row.handle)
      }}
      className="h-7 rounded-full px-2.5"
    >
      <Plus size={11} /> Follow
    </TgButton>
  )
}

/**
 * Follow and Dismiss for one Channel (DIR-06). A dismissed Channel withholds
 * Follow until the Dismissal is taken back, as Discover does.
 */
export function FollowCell({
  row,
  busy,
  onFollow,
  onDismiss,
}: {
  row: Pick<Row, "handle" | "followed" | "dismissed">
  busy: boolean
  onFollow: (handle: string) => void
  /** `true` dismisses, `false` takes the Dismissal back. */
  onDismiss: (handle: string, dismissed: boolean) => void
}) {
  const verb = row.dismissed ? "Take back" : "Dismiss"
  return (
    <span className="inline-flex items-center gap-1">
      {!row.dismissed && (
        <FollowButton row={row} busy={busy} onFollow={onFollow} />
      )}
      <TgButton
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`${verb} @${row.handle}`}
        data-shortcut={DIRECTORY_SHORTCUTS.dismiss}
        title={
          row.dismissed
            ? "Take the Dismissal back, here and in Discover"
            : "Hide this channel here and in Discover"
        }
        onClick={(e) => {
          e.stopPropagation()
          onDismiss(row.handle, !row.dismissed)
        }}
        className="h-7 rounded-full px-2 text-app-ink/50"
      >
        {row.dismissed ? <Undo2 size={11} /> : <EyeOff size={11} />}
        {row.dismissed ? "Take back" : null}
      </TgButton>
    </span>
  )
}

function ChannelCell({ row }: { row: Row }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <ChannelAvatar
        channel={{
          id: row.handle,
          name: row.handle,
          displayName: row.displayName ?? undefined,
          photoUrl: row.photoUrl ?? undefined,
        }}
        className="h-7 w-7 shrink-0"
        textClassName="text-xs"
      />
      <div className="min-w-0">
        <div dir="auto" className="truncate font-semibold">
          {row.displayName || row.handle}
        </div>
        {/* A link of its own, so DIR-03's row click never takes it. */}
        <a
          href={telegramWebViewChannelUrl(row.handle)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          data-testid={`directory-channel-link-${row.handle}`}
          data-shortcut={DIRECTORY_SHORTCUTS.open}
          className="block truncate font-mono text-[10px] text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
        >
          @{row.handle}
        </a>
        <TagBadges tags={row.tags} />
      </div>
    </div>
  )
}

/** A column's header: a button that sorts by it, except Language. */
function ColumnHeader({
  column,
  sorted,
  descending,
  onSort,
  className,
}: {
  column: DirectoryColumn
  sorted: boolean
  descending: boolean
  onSort: (key: DirectorySort) => void
  className: string
}) {
  const { key } = column
  return (
    <th
      title={column.description}
      aria-sort={sorted ? (descending ? "descending" : "ascending") : undefined}
      className={`px-2 py-2 ${key === "language" ? "" : "text-right"} ${className}`}
    >
      {key === "language" ? (
        column.label
      ) : (
        <button
          type="button"
          onClick={() => onSort(key)}
          className={`inline-flex items-center gap-0.5 whitespace-nowrap hover:text-app-ink ${sorted ? "text-app-ink" : ""}`}
        >
          {column.label}
          {sorted &&
            (descending ? <ArrowDown size={10} /> : <ArrowUp size={10} />)}
        </button>
      )}
    </th>
  )
}

function Pages({
  page,
  total,
  onPage,
}: {
  page: number
  total: number
  onPage: (page: number) => void
}) {
  const first = page * PAGE_SIZE
  const button =
    "rounded-md border border-app-ink/15 px-2 py-1 disabled:opacity-30"
  return (
    <div className="flex items-center justify-center gap-3 py-3 text-xs">
      <button
        type="button"
        aria-label="Previous page"
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
        className={button}
      >
        Previous
      </button>
      <span className="font-mono text-[11px] text-app-ink/50">
        {(first + 1).toLocaleString()}–
        {Math.min(first + PAGE_SIZE, total).toLocaleString()} of{" "}
        {total.toLocaleString()}
      </span>
      <button
        type="button"
        aria-label="Next page"
        disabled={first + PAGE_SIZE >= total}
        onClick={() => onPage(page + 1)}
        className={button}
      >
        Next
      </button>
    </div>
  )
}

/**
 * The Directory list (DIR-02): one page of 100 rows, a column per measure the
 * Columns menu has not hidden, ticks for a bulk Follow with the followed rows
 * locked as in Discover, a header that sorts, and the pages. On a narrow
 * screen only the Channel, the sorted measure (Subscribers when the sort
 * shows no column) and Follow stay.
 */
export function DirectoryTable({
  rows,
  total,
  page,
  sort,
  descending,
  hidden,
  ticks,
  onTicks,
  following,
  onFollow,
  onDismiss,
  onSort,
  onPage,
  onOpen,
  ring,
  cards = false,
  tagging,
}: {
  rows: Row[]
  total: number
  page: number
  sort: DirectorySort
  descending: boolean
  hidden: readonly string[]
  ticks: ReadonlySet<string>
  onTicks: (next: Set<string>) => void
  /** Handles whose follow job is running. */
  following: ReadonlySet<string>
  onFollow: (handle: string) => void
  /** `true` dismisses, `false` takes the Dismissal back (DIR-06). */
  onDismiss: (handle: string, dismissed: boolean) => void
  onSort: (key: DirectorySort) => void
  onPage: (page: number) => void
  /** A click anywhere on the row but its links and controls opens the panel. */
  onOpen: (handle: string) => void
  /** The keyboard highlight's handle (DFP-01). */
  ring?: string | null
  /** Below `md`, two-line cards instead of the table (DFP-02). */
  cards?: boolean
  /** Each row's Tag picker (DFP-04); none while the Tags have not loaded. */
  tagging?: RowTagging
}) {
  const sortedColumn = sort === "mine_last_days" ? "mine" : sort
  const columns = [
    ...COLUMNS.filter((c) => !hidden.includes(c.key)),
    ...SHARED_COLUMNS.filter((c) =>
      rows.some((r) => sharedCount(c.key as SharedKey, r) != null),
    ),
  ]
  // Under a sort no shown column reads (Relevance, or a hidden column),
  // Subscribers stays, so a narrow row still carries a measure.
  const kept = columns.some((c) => c.key === sortedColumn)
    ? sortedColumn
    : "subscribers"
  const narrow = (key: string) => (key === kept ? "" : "hidden md:table-cell")
  const pages = total > 0 && <Pages page={page} total={total} onPage={onPage} />
  if (cards) {
    return (
      <div className="rounded-xl border border-app-ink/10 bg-app-card">
        <DirectoryCards
          rows={rows}
          columns={CARD_MEASURES.flatMap((key) =>
            columns.filter((c) => c.key === (key ?? kept)),
          ).filter((c, i, all) => all.indexOf(c) === i)}
          ticks={ticks}
          onTicks={onTicks}
          following={following}
          onFollow={onFollow}
          onDismiss={onDismiss}
          onOpen={onOpen}
          tagging={tagging}
        />
        {pages}
      </div>
    )
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-app-ink/10 bg-app-card">
      <table className="w-full text-xs">
        <thead className="text-left text-[11px] text-app-ink/60">
          <tr>
            <th className="w-8 pl-3">
              <HeaderTick rows={rows} ticks={ticks} onTicks={onTicks} />
            </th>
            <th className="px-2 py-2">Channel</th>
            {columns.map((c) => (
              <ColumnHeader
                key={c.key}
                column={c}
                sorted={sortedColumn === c.key}
                descending={descending}
                onSort={onSort}
                className={narrow(c.key)}
              />
            ))}
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => [
            <tr
              key={r.handle}
              data-testid={`directory-row-${r.handle}`}
              data-directory-handle={r.handle}
              data-kbd-selected={ring === r.handle || undefined}
              onClick={() => onOpen(r.handle)}
              className={`cursor-pointer border-t border-app-ink/5 ${ticks.has(r.handle) ? "bg-blue-500/5" : "hover:bg-app-ink/5"} ${r.dismissed ? "opacity-50" : ""} data-[kbd-selected]:outline data-[kbd-selected]:outline-2 data-[kbd-selected]:-outline-offset-2 data-[kbd-selected]:outline-blue-500`}
            >
              <td className="pl-3" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  aria-label={`Tick @${r.handle}`}
                  data-shortcut={DIRECTORY_SHORTCUTS.tick}
                  checked={ticks.has(r.handle)}
                  onChange={() =>
                    onTicks(toggleUnfollowedSelection(r.handle, false, ticks))
                  }
                  className="accent-blue-600"
                />
              </td>
              <td className="max-w-72 px-2 py-1.5">
                <ChannelCell row={r} />
              </td>
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`whitespace-nowrap px-2 font-mono text-app-ink/70 ${c.key === "language" ? "" : "text-right tabular-nums"} ${narrow(c.key)}`}
                >
                  {cell(c.key, r)}
                </td>
              ))}
              <td className="whitespace-nowrap px-2 text-right">
                {tagging && <RowTagButton row={r} tagging={tagging} />}
                <FollowCell
                  row={r}
                  busy={following.has(r.handle)}
                  onFollow={onFollow}
                  onDismiss={onDismiss}
                />
              </td>
            </tr>,
            r.match && (
              <DirectoryMatchRow
                key={`${r.handle}-match`}
                handle={r.handle}
                match={r.match}
                colSpan={columns.length + 3}
                onOpen={onOpen}
              />
            ),
          ])}
        </tbody>
      </table>
      {pages}
    </div>
  )
}

/**
 * What a card shows, in order: the sorted measure (`null`), then Subscribers,
 * Reach, Posts per week and Language, and the Shared counts while a Shared
 * Condition is on. A hidden column stays hidden here too.
 */
const CARD_MEASURES: (DirectoryColumn["key"] | null)[] = [
  null,
  "subscribers",
  "reach",
  "posts_per_week",
  "language",
  "shared_parents",
  "shared_children",
]

/**
 * The rows as two-line cards with a large tick (DFP-02). A tap anywhere but
 * the tick, the links and the actions opens the panel, as a table row does.
 */
function DirectoryCards({
  rows,
  columns,
  ticks,
  onTicks,
  following,
  onFollow,
  onDismiss,
  onOpen,
  tagging,
}: {
  rows: Row[]
  columns: DirectoryColumn[]
  ticks: ReadonlySet<string>
  onTicks: (next: Set<string>) => void
  following: ReadonlySet<string>
  onFollow: (handle: string) => void
  onDismiss: (handle: string, dismissed: boolean) => void
  onOpen: (handle: string) => void
  tagging?: RowTagging
}) {
  return (
    <ul className="divide-y divide-app-ink/5">
      {rows.map((r) => (
        <li
          key={r.handle}
          data-testid={`directory-card-${r.handle}`}
          onClick={() => onOpen(r.handle)}
          className={`flex cursor-pointer items-start gap-2 px-2 py-3 ${ticks.has(r.handle) ? "bg-blue-500/5" : ""} ${r.dismissed ? "opacity-50" : ""}`}
        >
          <label
            className="-my-1 flex h-9 w-9 shrink-0 items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              aria-label={`Tick @${r.handle}`}
              checked={ticks.has(r.handle)}
              onChange={() =>
                onTicks(toggleUnfollowedSelection(r.handle, false, ticks))
              }
              className="h-5 w-5 accent-blue-600"
            />
          </label>
          <div className="min-w-0 flex-1 text-xs">
            <ChannelCell row={r} />
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-app-ink/60">
              {columns.map((c) => {
                const value = cell(c.key, r)
                return value ? (
                  <span key={c.key} data-measure className="whitespace-nowrap">
                    <span className="text-app-ink/40">{c.label}</span>{" "}
                    <span className="font-mono">{value}</span>
                  </span>
                ) : null
              })}
            </div>
          </div>
          <div className="flex shrink-0 items-center">
            {tagging && <RowTagButton row={r} tagging={tagging} />}
            <FollowCell
              row={r}
              busy={following.has(r.handle)}
              onFollow={onFollow}
              onDismiss={onDismiss}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
