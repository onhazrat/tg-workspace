import { cn } from "@/lib/utils"
import { SHORTCUTS } from "./FeedKeyboard"
import { PostCardBody, PostCardClampedBody } from "./PostCardBody"
import {
  PostCardActions,
  PostCardReactions,
  PostCardViews,
  type PostTranslationControl,
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
  translation?: PostTranslationControl
  /** Present only when embeddings are enabled. */
  onFindRelated?: () => void
  /**
   * Tick or untick the Post (PTR-05); the checkbox shows when the read said
   * whether the Post is selected. `shift` asks for the run since the last
   * click.
   */
  onToggleSelected?: (shift: boolean) => void
}

/** Ticked when an Action covers the Post; x fires it from the keyboard. */
export function SelectBox({
  selected,
  onToggle,
}: {
  selected: boolean
  onToggle: (shift: boolean) => void
}) {
  return (
    <input
      type="checkbox"
      // Controlled by the read's flag: a click records a Pick, and the patched
      // row moves the tick.
      checked={selected}
      readOnly
      aria-label={selected ? "Deselect this post" : "Select this post"}
      title="Select for Summarize and Chat (shift-click for a run)"
      data-shortcut={SHORTCUTS.select}
      onClick={(e) => onToggle(e.shiftKey)}
      className="mt-1 size-4 shrink-0 cursor-pointer accent-blue-600"
    />
  )
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
  onToggleSelected,
  ...rest
}: PostCardViewProps) {
  const { selected } = rest.post
  const header = {
    ...rest,
    trailing: selected !== undefined && onToggleSelected && (
      <SelectBox selected={selected} onToggle={onToggleSelected} />
    ),
  }
  const { post, postSearch } = header
  // A deselected Post stays in the feed, dimmed: the selection marks Posts
  // and never hides them.
  const dimmed = selected === false && "opacity-50"
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
      onShowChannel={
        header.onShowChannel && !header.spotlit
          ? () => header.onShowChannel?.(post.channelName)
          : undefined
      }
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
          dimmed,
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
        dimmed,
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
