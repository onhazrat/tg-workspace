import { ArrowDown, ArrowUp, Check, Plus } from "lucide-react"
import type React from "react"
import type { DirectoryRowResponse } from "@/client"
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

export const PAGE_SIZE = 100

type Row = DirectoryRowResponse

export type DirectoryColumn = {
  key: "language" | "mine" | MeasureKey
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
 * actions always show. DIR-05 adds Cited by and Cites.
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
  measureColumn("found_days"),
]

const count = (n: number | null) => (n === null ? "" : formatCount(n))

/** What one column shows for a row. */
function cell(key: DirectoryColumn["key"], r: Row): React.ReactNode {
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
  const selectable = rows.map((r) => ({
    name: r.handle,
    isFollowed: r.followed,
  }))
  const state = headerCheckboxState(selectable, ticks)
  return (
    <input
      type="checkbox"
      aria-label="Tick every unfollowed channel on this page"
      checked={state === "checked"}
      ref={(el) => {
        if (el) el.indeterminate = state === "indeterminate"
      }}
      onChange={() => onTicks(toggleSelectAllUnfollowed(selectable, ticks))}
      className="accent-blue-600"
    />
  )
}

function FollowCell({
  row,
  busy,
  onFollow,
}: {
  row: Row
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
          className="block truncate font-mono text-[10px] text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
        >
          @{row.handle}
        </a>
      </div>
    </div>
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
 * screen only the Channel, the sorted measure and Follow stay.
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
  onSort,
  onPage,
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
  onSort: (key: DirectoryColumn["key"]) => void
  onPage: (page: number) => void
}) {
  const sortedColumn = sort === "mine_last_days" ? "mine" : sort
  const columns = COLUMNS.filter((c) => !hidden.includes(c.key))
  const narrow = (key: string) =>
    key === sortedColumn ? "" : "hidden md:table-cell"
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
              <th
                key={c.key}
                title={c.description}
                aria-sort={
                  sortedColumn === c.key
                    ? descending
                      ? "descending"
                      : "ascending"
                    : undefined
                }
                className={`px-2 py-2 ${c.key === "language" ? "" : "text-right"} ${narrow(c.key)}`}
              >
                {c.key === "language" ? (
                  c.label
                ) : (
                  <button
                    type="button"
                    onClick={() => onSort(c.key)}
                    className={`inline-flex items-center gap-0.5 whitespace-nowrap hover:text-app-ink ${sortedColumn === c.key ? "text-app-ink" : ""}`}
                  >
                    {c.label}
                    {sortedColumn === c.key &&
                      (descending ? (
                        <ArrowDown size={10} />
                      ) : (
                        <ArrowUp size={10} />
                      ))}
                  </button>
                )}
              </th>
            ))}
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.handle}
              className={`border-t border-app-ink/5 ${ticks.has(r.handle) ? "bg-blue-500/5" : "hover:bg-app-ink/5"}`}
            >
              <td className="pl-3">
                <input
                  type="checkbox"
                  aria-label={
                    r.followed
                      ? `@${r.handle} already followed`
                      : `Tick @${r.handle}`
                  }
                  checked={r.followed || ticks.has(r.handle)}
                  disabled={r.followed}
                  onChange={() =>
                    onTicks(
                      toggleUnfollowedSelection(r.handle, r.followed, ticks),
                    )
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
                <FollowCell
                  row={r}
                  busy={following.has(r.handle)}
                  onFollow={onFollow}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {total > 0 && <Pages page={page} total={total} onPage={onPage} />}
    </div>
  )
}
