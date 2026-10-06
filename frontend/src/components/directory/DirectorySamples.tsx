import { ExternalLink, Eye } from "lucide-react"
import { useState } from "react"
import type { DirectorySamplePostResponse } from "@/client"
import { RelativeTime } from "@/components/RelativeTime"
import {
  hiddenLinks,
  isLongPost,
  isMediaOnly,
} from "@/lib/directory/directory-panel"
import { formatCount } from "@/lib/format-count"
import { linkHref, renderPostText } from "@/lib/posts/render-post-text"
import { telegramWebViewPostUrl } from "@/lib/telegram-web"
import { getRelativeTime } from "@/lib/utils"

/** Posts shown before "Show N more". */
const FIRST_POSTS = 3

const plural = (n: number) => `${n} more post${n === 1 ? "" : "s"}`

/** One Post's words, clamped to six lines with "Read more" when long. */
export function PostText({ postId, text }: { postId: number; text: string }) {
  const [open, setOpen] = useState(false)
  const long = isLongPost(text)
  return (
    <>
      <p
        dir="auto"
        data-testid={`directory-sample-text-${postId}`}
        className={`whitespace-pre-line ${long && !open ? "line-clamp-6" : ""}`}
      >
        {renderPostText(text, "")}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="mt-0.5 text-[11px] font-semibold text-app-ink/60 hover:text-app-ink"
        >
          {open ? "Less" : "Read more"}
        </button>
      )}
    </>
  )
}

/** The Links the text hides behind other words, as chips. */
function HiddenLinks({ post }: { post: DirectorySamplePostResponse }) {
  const links = hiddenLinks(post.text, post.links)
  if (!links.length) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {links.map((link) => (
        <a
          key={link.url}
          href={linkHref(link.url) ?? link.url}
          target="_blank"
          rel="noopener noreferrer"
          title={link.url}
          data-testid="directory-sample-hidden-link"
          className="max-w-full truncate rounded bg-app-ink/10 px-1.5 py-0.5 font-mono text-[10px] text-blue-600 hover:underline dark:text-blue-400"
        >
          {link.url.replace(/^https?:\/\//, "")}
        </a>
      ))}
    </div>
  )
}

function Sample({
  handle,
  post,
}: {
  handle: string
  post: DirectorySamplePostResponse
}) {
  const mediaOnly = isMediaOnly(post.text)
  return (
    <li
      data-testid={`directory-sample-${post.postId}`}
      className="rounded-md border border-app-ink/10 bg-app-ink/5 p-2 text-xs leading-relaxed text-app-ink/80"
    >
      {mediaOnly ? (
        <span className="italic text-app-ink/40">Media only, no text</span>
      ) : (
        <PostText postId={post.postId} text={post.text} />
      )}
      <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-app-ink/40">
        <RelativeTime timestamp={post.timestamp} />
        {/* `null` is not measured: Telegram stops showing the counter on
         * older Posts. The count was taken when the probe captured it. */}
        {post.views != null && (
          <span
            title={`${post.views.toLocaleString("en-US")} views, counted ${getRelativeTime(post.capturedAt)}`}
            className="inline-flex items-center gap-0.5"
          >
            <Eye size={10} /> <span>{formatCount(post.views)}</span>
          </span>
        )}
        {post.hasMedia && !mediaOnly && <span>has media</span>}
        <a
          href={telegramWebViewPostUrl(handle, post.postId)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open the Post on Telegram"
          className="ml-auto text-app-ink/40 hover:text-app-ink"
        >
          <ExternalLink size={12} />
        </a>
      </div>
      <HiddenLinks post={post} />
    </li>
  )
}

/**
 * A Channel's stored sample Posts, newest first (DIR-03): the newest three
 * until "Show N more", each long one clamped until "Read more". The expansion
 * belongs to the handle, so another Channel opens collapsed.
 */
export function DirectorySamples({
  handle,
  posts,
}: {
  handle: string
  posts: DirectorySamplePostResponse[]
}) {
  const [expandedFor, setExpandedFor] = useState<string | null>(null)
  if (!posts.length)
    return <p className="text-xs text-app-ink/40">No sample posts stored.</p>
  const expanded = expandedFor === handle
  const visible = expanded ? posts : posts.slice(0, FIRST_POSTS)
  return (
    <>
      <ul className="space-y-2">
        {visible.map((post) => (
          <Sample
            key={`${handle}/${post.postId}`}
            handle={handle}
            post={post}
          />
        ))}
      </ul>
      {posts.length > FIRST_POSTS && (
        <button
          type="button"
          onClick={() => setExpandedFor(expanded ? null : handle)}
          className="mt-2 w-full rounded-md border border-app-ink/15 py-1.5 text-xs text-app-ink/70 hover:bg-app-ink/5"
        >
          {expanded
            ? "Show fewer"
            : `Show ${plural(posts.length - FIRST_POSTS)}`}
        </button>
      )}
    </>
  )
}
