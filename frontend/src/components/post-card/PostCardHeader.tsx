import { CornerUpLeft, Hash, PlusCircle, Repeat2 } from "lucide-react"
import {
  telegramWebViewChannelUrl,
  telegramWebViewPostUrl,
} from "@/lib/telegram-web"
import { cn, highlightText } from "@/lib/utils"
import type { Channel, Post } from "@/types"
import { ChannelAvatar } from "../ChannelAvatar"
import { RelativeTime } from "../RelativeTime"
import { postTime } from "./post-card-model"

/** What the header needs to know beyond the Post itself. */
export interface PostCardHeaderProps {
  post: Post
  /** The followed channel this post belongs to, when it is one. */
  channel: Channel | undefined
  /** Whether the channel the post was forwarded from is already followed. */
  followsForwardSource: boolean
  onAddChannel: (name: string) => void
  /** Open the Channel spotlight on a Channel; absent outside the Posts feed. */
  onShowChannel?: (name: string) => void
  /** This Post's own Channel is the one in the spotlight. */
  spotlit?: boolean
  postSearch: string
}

/** Avatar, name and handle, then the time, post id, reply and forward. */
export function PostCardHeader(props: PostCardHeaderProps) {
  const { post } = props
  const refs = post.replyToPostId != null || !!post.forwardedFrom
  return (
    <header className="flex items-start gap-3 px-5 pt-4">
      <CardAvatar post={post} channel={props.channel} size="w-9 h-9" />
      <div className="min-w-0 flex-1">
        <ChannelName {...props} />
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-app-ink/50">
          <RelativeTime timestamp={postTime(post)} />
          <span>·</span>
          <PostIdLink post={post} />
          {refs && <span>·</span>}
          <ReplyRef post={post} />
          <ForwardRef {...props} />
        </div>
      </div>
    </header>
  )
}

/** One line for a compact card: small avatar, name, time; the refs under it. */
export function PostCardCompactHeader(props: PostCardHeaderProps) {
  const { post } = props
  return (
    <>
      <header className="flex min-w-0 items-center gap-2 text-[12px] text-app-ink/50">
        <CardAvatar post={post} channel={props.channel} size="w-6 h-6" />
        <ChannelName {...props} />
        <span>·</span>
        <RelativeTime timestamp={postTime(post)} className="shrink-0" />
      </header>
      {(post.forwardedFrom || post.replyToPostId != null) && (
        <div className="flex flex-wrap gap-x-3 text-[12px] text-app-ink/50">
          <ForwardRef {...props} />
          <ReplyRef post={post} />
        </div>
      )}
    </>
  )
}

function CardAvatar({
  post,
  channel,
  size,
}: {
  post: Post
  channel: Channel | undefined
  size: string
}) {
  return channel ? (
    <ChannelAvatar
      channel={channel}
      className={cn(size, "border border-app-ink/10 shrink-0")}
      textClassName="text-[12px]"
    />
  ) : (
    <div
      className={cn(
        size,
        "rounded-full bg-app-ink/10 flex items-center justify-center text-[12px] font-bold uppercase text-app-ink/70 shrink-0",
      )}
    >
      {post.channelName.charAt(0)}
    </div>
  )
}

/**
 * The Channel's name opens its spotlight (PTR-04), plain text when there is
 * none to open; the handle links to Telegram.
 */
function ChannelName({
  post,
  channel,
  postSearch,
  onShowChannel,
  spotlit,
}: PostCardHeaderProps) {
  const title = channel?.displayName || post.channelName
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5">
      {onShowChannel && !spotlit ? (
        <button
          type="button"
          onClick={() => onShowChannel(post.channelName)}
          title={`Show only posts from ${title}`}
          className="truncate text-left text-[14px] font-semibold underline-offset-2 hover:underline"
        >
          {highlightText(title, postSearch)}
        </button>
      ) : (
        <span className="truncate text-[14px] font-semibold">
          {highlightText(title, postSearch)}
        </span>
      )}
      <a
        href={telegramWebViewChannelUrl(post.channelName)}
        target="_blank"
        rel="noopener noreferrer"
        data-testid={`post-channel-link-${post.channelName}`}
        title="Open channel in Telegram"
        className="truncate text-[12px] text-app-ink/50 hover:text-app-ink hover:underline"
      >
        @{highlightText(post.channelName, postSearch)}
      </a>
    </span>
  )
}

export function PostIdLink({ post }: { post: Post }) {
  return (
    <a
      href={telegramWebViewPostUrl(post.channelName, post.id)}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={`post-id-link-${post.channelName}-${post.id}`}
      className="inline-flex items-center gap-0.5 font-mono hover:text-app-ink/80 hover:underline"
    >
      <Hash size={10} />
      {post.id}
    </a>
  )
}

/** "Reply to #7 · the start of what it answers", linking to that Post. */
function ReplyRef({ post }: { post: Post }) {
  if (post.replyToPostId == null) return null
  return (
    <a
      data-testid={`post-reply-badge-${post.channelName}-${post.id}`}
      href={
        post.replyTo?.url ??
        telegramWebViewPostUrl(post.channelName, post.replyToPostId)
      }
      target="_blank"
      rel="noopener noreferrer"
      title={post.replyTo?.text ?? undefined}
      className="inline-flex min-w-0 items-center gap-1 hover:text-app-ink/80 hover:underline"
    >
      <CornerUpLeft size={11} className="shrink-0" />
      <span className="truncate">
        Reply to #{post.replyToPostId}
        {post.replyTo?.text && (
          <span className="text-app-ink/40"> · {post.replyTo.text}</span>
        )}
      </span>
    </a>
  )
}

/**
 * The forward's source: its spotlight when followed (PTR-04), an offer to add
 * it when not.
 */
function ForwardRef({
  post,
  followsForwardSource,
  onAddChannel,
  onShowChannel,
}: PostCardHeaderProps) {
  if (!post.forwardedFrom) return null
  const source = post.forwardedFrom
  const name = post.forwardedFromName || source
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <Repeat2 size={12} className="shrink-0" />
      Forwarded from
      {followsForwardSource ? (
        onShowChannel ? (
          <button
            type="button"
            onClick={() => onShowChannel(source)}
            title={`Show only posts from ${name}`}
            className="truncate font-medium underline-offset-2 hover:text-app-ink/80 hover:underline"
          >
            {name}
          </button>
        ) : (
          <span className="truncate font-medium">{name}</span>
        )
      ) : (
        <button
          type="button"
          onClick={() => onAddChannel(source)}
          title={`Add @${source} to workspace`}
          className="inline-flex min-w-0 items-center gap-1 rounded px-1 font-medium text-blue-500 hover:bg-blue-500/10"
        >
          <span className="truncate">{name}</span>
          <PlusCircle size={11} />
        </button>
      )}
    </span>
  )
}
