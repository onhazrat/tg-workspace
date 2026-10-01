import { cn } from "@/lib/utils"
import { PostCardBody, PostCardClampedBody } from "./PostCardBody"
import {
  PostCardActions,
  PostCardReactions,
  PostCardViews,
} from "./PostCardFooter"
import {
  PostCardCompactHeader,
  PostCardHeader,
  type PostCardHeaderProps,
  PostIdLink,
} from "./PostCardHeader"
import { PostCardMedia } from "./PostCardMedia"
import { PostCardPhoto } from "./PostCardPhoto"

export interface PostCardViewProps extends PostCardHeaderProps {
  /** The Compact grid's card: one-line header, smaller photo, three lines. */
  compact?: boolean
  /** Keyboard mode is on, so action tooltips name their letter. */
  keyboard?: boolean
  /** The text to show: the translation while it is showing. */
  text: string
  /** Present only when the post is in a language that needs translating. */
  translation?: { showing: boolean; busy: boolean; onToggle: () => void }
  /** Present only when embeddings are enabled. */
  onFindRelated?: () => void
}

/** Keyboard mode's ring on the card `FeedKeyboard` has selected. */
const RINGABLE =
  "scroll-mt-24 data-[kbd-selected]:ring-2 data-[kbd-selected]:ring-blue-500 data-[kbd-selected]:border-transparent"

/**
 * A Post as Telegram draws it (PTR-02): header, the photo above the text, the
 * text, media badges, and a footer with views, reactions and every action.
 * Props only; `PostCard` wires it to the workspace.
 */
export function PostCardView({
  compact = false,
  keyboard = false,
  text,
  translation,
  onFindRelated,
  ...header
}: PostCardViewProps) {
  const { post, postSearch } = header
  const title = header.channel?.displayName || post.channelName
  const thumb = post.media?.thumbApiPath
  const body = {
    text,
    // A translation has no positions of its own (ADR-022).
    linkSpans: text === post.text ? post.linkSpans : null,
    postSearch,
  }
  const actions = (
    <PostCardActions
      post={post}
      keyboard={keyboard}
      labels={!compact}
      translation={translation}
      onFindRelated={onFindRelated}
    />
  )

  if (compact) {
    return (
      <article
        data-post-key={`${post.channelName}_${post.id}`}
        className={cn(
          "flex flex-col gap-2 rounded-xl border border-app-ink/10 bg-app-card px-4 pt-3 pb-1.5 transition-colors hover:border-app-ink/20",
          RINGABLE,
        )}
      >
        <PostCardCompactHeader {...header} />
        {thumb && (
          <div className="flex justify-center">
            <PostCardPhoto thumbApiPath={thumb} caption={title} compact />
          </div>
        )}
        <PostCardClampedBody {...body} />
        {/* Pinned to the bottom, so footers line up across a grid row. */}
        <footer className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-app-ink/5 pt-1.5 text-[12px] text-app-ink/50">
          <PostIdLink post={post} />
          <PostCardViews post={post} />
          <PostCardReactions post={post} max={2} />
          <PostCardMedia post={post} />
          {actions}
        </footer>
      </article>
    )
  }

  return (
    <article
      data-post-key={`${post.channelName}_${post.id}`}
      className={cn(
        "overflow-hidden rounded-2xl border border-app-ink/10 bg-app-card shadow-sm transition-colors hover:border-app-ink/20",
        RINGABLE,
      )}
    >
      <PostCardHeader {...header} />
      {/* Above the text, as Telegram draws it. */}
      {thumb && (
        <div className="mt-3 flex justify-center px-5">
          <PostCardPhoto thumbApiPath={thumb} caption={title} />
        </div>
      )}
      <div className="flex flex-col gap-3 px-5 pt-3 pb-2">
        <PostCardBody {...body} />
        <PostCardMedia post={post} />
      </div>
      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-app-ink/5 px-5 py-1.5 text-[12px] text-app-ink/50">
        <PostCardViews post={post} />
        <PostCardReactions post={post} />
        {actions}
      </footer>
    </article>
  )
}
