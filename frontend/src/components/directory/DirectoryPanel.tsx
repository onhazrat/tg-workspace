import { ExternalLink, X } from "lucide-react"
import type {
  DirectoryCitingPostResponse,
  DirectoryEntryResponse,
  DirectorySamplePostResponse,
  DirectoryWhyResponse,
} from "@/client"
import { ChannelAvatar } from "@/components/ChannelAvatar"
import { RelativeTime } from "@/components/RelativeTime"
import { MEASURES } from "@/lib/directory/directory-filter"
import {
  telegramWebViewChannelUrl,
  telegramWebViewPostUrl,
} from "@/lib/telegram-web"
import { DirectorySamples, PostText } from "./DirectorySamples"
import { cell, FollowCell } from "./DirectoryTable"

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

/** Every measure of the entry, as the table formats it; a dash for none. */
function Counters({ entry }: { entry: DirectoryEntryResponse }) {
  const row = { ...entry, mine: 0, mineLastAt: null, match: null }
  const stats = [
    { key: "language" as const, label: "Lang" },
    ...MEASURES.map((m) => ({ key: m.key, label: m.short })),
  ]
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
  why,
  windowDays,
}: {
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
          <ul className="mt-2 space-y-2">
            {why.posts.map((post) => (
              <CitingPost key={`${post.channel}/${post.postId}`} post={post} />
            ))}
          </ul>
          {why.total > why.posts.length && (
            <p className="mt-1 text-[10px] text-app-ink/40">
              and {why.total - why.posts.length} more
            </p>
          )}
        </>
      )}
    </section>
  )
}

function Header({
  entry,
  following,
  onFollow,
}: {
  entry: DirectoryEntryResponse
  following: boolean
  onFollow: () => void
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
        <FollowCell row={entry} busy={following} onFollow={onFollow} />
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
  onClose,
}: {
  handle: string
  entry: DirectoryEntryResponse | null | undefined
  posts: DirectorySamplePostResponse[] | undefined
  why: DirectoryWhyResponse | undefined
  /** The "Cited by your channels" Condition's window, if one is set. */
  windowDays: number | null
  following: boolean
  onFollow: () => void
  onClose: () => void
}) {
  return (
    <aside
      data-testid="directory-panel"
      aria-label={`@${handle}`}
      className="fixed inset-0 z-40 overflow-y-auto bg-app-bg p-5 shadow-2xl md:left-auto md:w-[440px] md:border-l md:border-app-ink/15"
    >
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
          <Header entry={entry} following={following} onFollow={onFollow} />
          <WhyHere why={why} windowDays={windowDays} />
          <h4 className={HEADING}>Recent posts</h4>
          {posts ? (
            <DirectorySamples handle={handle} posts={posts} />
          ) : (
            <p className="text-xs text-app-ink/40">Loading recent posts…</p>
          )}
        </>
      )}
    </aside>
  )
}
