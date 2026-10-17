import { ExternalLink, Filter, Plus, X } from "lucide-react"
import type {
  DirectoryCitingPostResponse,
  DirectoryEntryResponse,
  DirectoryNeighbourResponse,
  DirectoryNeighboursResponse,
  DirectorySamplePostResponse,
  DirectoryWhyResponse,
} from "@/client"
import { ChannelAvatar } from "@/components/ChannelAvatar"
import { RelativeTime } from "@/components/RelativeTime"
import {
  type DirectoryCond,
  type DirectoryHandlesCond,
  directoryConditionLabel,
  SHARED_LABEL,
} from "@/lib/directory/directory-filter"
import type { Tagging } from "@/lib/directory/directory-tags"
import {
  telegramWebViewChannelUrl,
  telegramWebViewPostUrl,
} from "@/lib/telegram-web"
import { type BoostMode, DirectoryBoost } from "./DirectoryBoost"
import { DirectorySamples, FirstFew, PostText } from "./DirectorySamples"
import { cell, columnOf, FollowCell } from "./DirectoryTable"
import { TagBadges, TagPicker } from "./DirectoryTags"

const HEADING =
  "mb-2 mt-5 text-[11px] font-semibold uppercase tracking-wider text-app-ink/50"
const LINK =
  "text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"

const KIND_VERB: Record<string, string> = {
  forward: "forwarded",
  mention: "mentioned",
  link: "linked",
  reply: "replied to",
}

const PANEL_COLUMNS = [
  "language",
  "subscribers",
  "reach",
  "posts_per_week",
  "forward_pct",
  "last_post_at",
  "created_at",
  "photos",
  "videos",
  "files",
  "links",
  "cited_by",
  "cites",
] as const

/** Every measure of the entry, as the table formats it; a dash for none. */
function Counters({ entry }: { entry: DirectoryEntryResponse }) {
  const row = {
    ...entry,
    mine: 0,
    mineLastAt: null,
    match: null,
    sharedParents: null,
    sharedChildren: null,
  }
  // What the entry read carries (`directory_reads._PANEL_COLUMNS`), the kind
  // only for a DATA_ADMIN reader, whose entry has one (DPF).
  const stats = [
    ...PANEL_COLUMNS,
    ...(entry.kind == null ? [] : (["kind"] as const)),
  ].map((key) => ({ key, label: columnOf(key).label }))
  return (
    <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2 text-xs sm:grid-cols-4">
      {stats.map(({ key, label }) => (
        <div key={key}>
          <dt className="text-[10px] uppercase tracking-wider text-app-ink/50">
            {label}
          </dt>
          <dd className="font-mono tabular-nums">
            {cell(key, row) || <span className="text-app-ink/40">—</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function CitingPost({ post }: { post: DirectoryCitingPostResponse }) {
  return (
    <li className="rounded-md border border-app-ink/10 bg-app-bg p-2 text-xs">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-app-ink/60">
        <a
          href={telegramWebViewChannelUrl(post.channel)}
          target="_blank"
          rel="noopener noreferrer"
          dir="auto"
          className={`font-semibold ${LINK}`}
        >
          {post.displayName || `@${post.channel}`}
        </a>
        <span>{post.kinds.map((k) => KIND_VERB[k] ?? k).join(" + ")} it</span>
        <RelativeTime timestamp={post.timestamp} />
        <a
          href={telegramWebViewPostUrl(post.channel, post.postId)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open the Post on Telegram"
          className="ml-auto text-app-ink/40 hover:text-app-ink"
        >
          <ExternalLink size={12} />
        </a>
      </div>
      {post.text ? (
        <PostText postId={post.postId} text={post.text} />
      ) : (
        <p className="italic text-app-ink/40">
          Its words are not stored for you.
        </p>
      )}
    </li>
  )
}

/**
 * The Posts of "your channels" that cite this Channel, counting what the sort
 * and the "Cited by your channels" Condition count.
 */
function WhyHere({
  handle,
  why,
  windowDays,
}: {
  handle: string
  why: DirectoryWhyResponse | undefined
  windowDays: number | null
}) {
  const within = windowDays ? ` in the last ${windowDays} days` : ""
  return (
    <section className="mt-5 rounded-lg border border-app-ink/10 bg-app-ink/5 p-3">
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-app-ink/50">
        Why it's here
      </h4>
      {!why ? (
        <p className="text-xs text-app-ink/40">Loading…</p>
      ) : why.total === 0 ? (
        <p className="text-xs text-app-ink/70">
          None of your channels cite it{within}.
        </p>
      ) : (
        <>
          <p className="text-xs text-app-ink/80">
            {why.total} Post{why.total === 1 ? "" : "s"} of your channels cite
            it{within}
          </p>
          <FirstFew owner={handle} items={why.posts}>
            {(visible) => (
              <ul className="mt-2 space-y-2">
                {visible.map((post) => (
                  <CitingPost
                    key={`${post.channel}/${post.postId}`}
                    post={post}
                  />
                ))}
              </ul>
            )}
          </FirstFew>
          {why.total > why.posts.length && (
            <p className="mt-1 text-[10px] text-app-ink/40">
              and {why.total - why.posts.length} more
            </p>
          )}
        </>
      )}
      {why && <SharedWhy why={why} />}
    </section>
  )
}

const SHARED_WHY = {
  parents: {
    link: "cite it and your Seeds",
    none: "nothing citing your Seeds cites it",
  },
  children: {
    link: "are cited by it and your Seeds",
    none: "it cites nothing your Seeds cite",
  },
}

/** A line per Shared relation on (DIR-07): a few of the Channels it shares. */
function SharedWhy({ why }: { why: DirectoryWhyResponse }) {
  return (["parents", "children"] as const).map((relation) => {
    const shared = why[relation]
    if (!shared) return null
    const names = shared.channels.map((c) => `@${c.handle}`).join(", ")
    const more =
      shared.total > shared.channels.length
        ? ` and ${shared.total - shared.channels.length} more`
        : ""
    return (
      <p key={relation} className="mt-2 text-xs text-app-ink/80">
        {SHARED_LABEL[relation]}:{" "}
        {shared.total
          ? `${names}${more} ${SHARED_WHY[relation].link}`
          : `none; ${SHARED_WHY[relation].none}`}
      </p>
    )
  })
}

/**
 * One side of who cites whom (DIR-05): the Channels citing it most, or those
 * it cites most, each one click from a Condition.
 */
function Neighbours({
  title,
  type,
  list,
  empty,
  onFilter,
}: {
  title: string
  /** The Condition a click adds: "cited by @x" or "cites @x". */
  type: DirectoryHandlesCond["type"]
  list: DirectoryNeighbourResponse[] | undefined
  empty: string
  onFilter: (cond: DirectoryCond) => void
}) {
  return (
    <>
      <h4 className={HEADING}>{title}</h4>
      {!list ? (
        <p className="text-xs text-app-ink/40">Loading…</p>
      ) : list.length === 0 ? (
        <p className="text-xs text-app-ink/60">{empty}</p>
      ) : (
        <ul className="space-y-1 text-xs">
          {list.map((n) => {
            const cond: DirectoryHandlesCond = {
              type,
              seeds: { kind: "handles", handles: [n.handle] },
            }
            const label = directoryConditionLabel(cond)
            return (
              <li key={n.handle} className="flex items-center gap-2">
                <a
                  href={telegramWebViewChannelUrl(n.handle)}
                  target="_blank"
                  rel="noopener noreferrer"
                  dir="auto"
                  className={`min-w-0 truncate ${LINK}`}
                >
                  {n.displayName || `@${n.handle}`}
                </a>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-app-ink/50">
                  {n.references} · {n.kinds.join(", ")}
                </span>
                <button
                  type="button"
                  aria-label={`Filter by "${label}"`}
                  title={`Add "${label}" to the filter`}
                  onClick={() => onFilter(cond)}
                  className="shrink-0 rounded p-0.5 text-app-ink/50 hover:bg-app-ink/10 hover:text-app-ink"
                >
                  <Filter size={12} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

function Header({
  entry,
  following,
  onFollow,
  onDismiss,
}: {
  entry: DirectoryEntryResponse
  following: boolean
  onFollow: () => void
  onDismiss: (dismissed: boolean) => void
}) {
  return (
    <>
      <header className="flex items-start gap-3 pr-8">
        <ChannelAvatar
          channel={{
            id: entry.handle,
            name: entry.handle,
            displayName: entry.displayName ?? undefined,
            photoUrl: entry.photoUrl ?? undefined,
          }}
          className="h-14 w-14 shrink-0"
          textClassName="text-lg"
        />
        <div className="min-w-0">
          <h3 dir="auto" className="truncate text-lg font-bold">
            {entry.displayName || entry.handle}
          </h3>
          <a
            href={telegramWebViewChannelUrl(entry.handle)}
            target="_blank"
            rel="noopener noreferrer"
            className={`font-mono text-[11px] ${LINK}`}
          >
            @{entry.handle}
          </a>
        </div>
      </header>
      {entry.bio && (
        <p
          dir="auto"
          className="mt-3 whitespace-pre-line text-sm text-app-ink/70"
        >
          {entry.bio}
        </p>
      )}
      <div className="mt-3">
        <FollowCell
          row={entry}
          busy={following}
          onFollow={onFollow}
          onDismiss={(_, dismissed) => onDismiss(dismissed)}
        />
      </div>
      <Counters entry={entry} />
    </>
  )
}

/**
 * A Directory entry's detail panel (DIR-03): its header, bio, counters and
 * Follow, "Why it's here", and its stored Posts. `entry` is `undefined` while
 * it loads and `null` when the Directory does not list the handle. Beside the
 * list on a wide screen, the whole screen on a narrow one.
 */
export function DirectoryPanel({
  handle,
  entry,
  posts,
  why,
  windowDays,
  following,
  onFollow,
  onDismiss,
  onClose,
  neighbours,
  onFilter,
  tagging,
  onBoost,
}: {
  handle: string
  entry: DirectoryEntryResponse | null | undefined
  posts: DirectorySamplePostResponse[] | undefined
  why: DirectoryWhyResponse | undefined
  /** The "Cited by your channels" Condition's window, if one is set. */
  windowDays: number | null
  following: boolean
  onFollow: () => void
  /** `true` dismisses, `false` takes the Dismissal back (DIR-06). */
  onDismiss: (dismissed: boolean) => void
  onClose: () => void
  /** Who cites it most and whom it cites most; `undefined` while loading. */
  neighbours: DirectoryNeighboursResponse | undefined
  /** Adds a Condition to the view's filter. */
  onFilter: (cond: DirectoryCond) => void
  /** The open Channel's Tags, added and removed here (DFP-04). */
  tagging?: Tagging
  /** Sets or adds to its Priority boost (DPF); shown only where the entry
   * carries one, which is for a `DATA_ADMIN` reader. */
  onBoost?: (mode: BoostMode, value: number) => void
}) {
  return (
    <>
      {/* Room under the list, so its last card scrolls above the sheet. */}
      <div aria-hidden className="h-[55vh] md:hidden" />
      <aside
        data-testid="directory-panel"
        aria-label={`@${handle}`}
        // Below md a bottom sheet over the list, which stays scrollable above
        // it so another card can switch it (DFP-02).
        className="fixed inset-0 z-40 overflow-y-auto bg-app-bg p-5 shadow-2xl max-md:top-auto max-md:h-[55vh] max-md:rounded-t-2xl max-md:border-t max-md:border-app-ink/15 max-md:pt-3 md:left-auto md:w-[440px] md:border-l md:border-app-ink/15"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-app-ink/20 md:hidden" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 rounded p-1 hover:bg-app-ink/10"
        >
          <X size={16} />
        </button>
        {entry === undefined && (
          <p className="text-xs text-app-ink/40">Loading…</p>
        )}
        {entry === null && (
          <p className="text-sm text-app-ink/60">
            The Directory holds nothing about @{handle}.
          </p>
        )}
        {entry && (
          <>
            <Header
              entry={entry}
              following={following}
              onFollow={onFollow}
              onDismiss={onDismiss}
            />
            {tagging && (
              <div
                data-testid="directory-panel-tags"
                className="mb-3 flex flex-wrap items-center gap-1.5"
              >
                <TagBadges
                  tags={entry.tags}
                  onRemove={(name) => tagging.onUntag(name, [handle])}
                />
                <TagPicker
                  tags={tagging.tags}
                  current={entry.tags}
                  onPick={(name) => tagging.onTag(name, [handle])}
                  onUnpick={(name) => tagging.onUntag(name, [handle])}
                  trigger={
                    <button
                      type="button"
                      className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-app-ink/25 px-2 text-[10px] font-semibold text-app-ink/60 hover:text-app-ink"
                    >
                      <Plus size={9} /> Tag
                    </button>
                  }
                />
              </div>
            )}
            {onBoost && entry.priorityBoost != null && (
              <div className="mb-3">
                <DirectoryBoost
                  onBoost={onBoost}
                  current={entry.priorityBoost}
                  effective={entry.effectivePriority ?? undefined}
                />
              </div>
            )}
            <WhyHere handle={handle} why={why} windowDays={windowDays} />
            <h4 className={HEADING}>Recent posts</h4>
            {posts ? (
              <DirectorySamples handle={handle} posts={posts} />
            ) : (
              <p className="text-xs text-app-ink/40">Loading recent posts…</p>
            )}
            <Neighbours
              title="Cited most by"
              type="citedby"
              list={neighbours?.citedBy}
              empty="No channel we know of cites it."
              onFilter={onFilter}
            />
            <Neighbours
              title="Cites most"
              type="cites"
              list={neighbours?.cites}
              empty="It cites no channel we know of."
              onFilter={onFilter}
            />
          </>
        )}
      </aside>
    </>
  )
}
