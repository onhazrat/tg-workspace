import { CornerUpLeft, Hash, PlusCircle } from "lucide-react"
import {
  telegramWebViewChannelUrl,
  telegramWebViewPostUrl,
} from "@/lib/telegram-web"
import { highlightText } from "@/lib/utils"
import type { Channel, Post } from "@/types"
import { ChannelAvatar } from "../ChannelAvatar"

/** Who posted it and where it came from: avatar, channel, post id, reply and forward. */
export function PostCardIdentity({
  post,
  channel,
  followsForwardSource,
  onAddChannel,
  postSearch,
}: {
  post: Post
  /** The followed channel this post belongs to, when it is one. */
  channel: Channel | undefined
  /** Whether the channel the post was forwarded from is already followed. */
  followsForwardSource: boolean
  onAddChannel: (name: string) => void
  postSearch: string
}) {
  const forwardName = post.forwardedFromName || post.forwardedFrom
  return (
    <div className="flex items-center gap-3">
      {channel ? (
        <ChannelAvatar
          channel={channel}
          className="w-8 h-8 border border-app-ink/10 shadow-sm shrink-0"
          textClassName="text-[12px]"
        />
      ) : (
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-app-ink/10 to-app-ink/5 flex items-center justify-center text-[12px] font-bold uppercase text-app-ink/70 border border-app-ink/10 shadow-sm shrink-0">
          {post.channelName.charAt(0)}
        </div>
      )}
      <div className="flex flex-col">
        <a
          href={telegramWebViewChannelUrl(post.channelName)}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={`post-channel-link-${post.channelName}`}
          className="text-[13px] font-bold uppercase tracking-tight underline-offset-2 hover:underline w-fit"
        >
          @{highlightText(post.channelName, postSearch)}
        </a>
        <div className="flex items-center gap-2">
          <a
            href={telegramWebViewPostUrl(post.channelName, post.id)}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`post-id-link-${post.channelName}-${post.id}`}
            className="text-[11px] font-mono text-app-ink/60 flex items-center gap-1 underline-offset-2 hover:underline hover:text-app-ink/80"
          >
            <Hash size={10} /> {post.id}
          </a>
          {post.replyToPostId != null && (
            <span
              data-testid={`post-reply-badge-${post.channelName}-${post.id}`}
              className="text-[11px] font-mono text-app-ink/60 flex items-center gap-1 border-l border-app-ink/10 pl-2"
              title={post.replyTo?.text ?? undefined}
            >
              <CornerUpLeft size={10} />
              <a
                href={
                  post.replyTo?.url ??
                  telegramWebViewPostUrl(post.channelName, post.replyToPostId)
                }
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="underline-offset-2 hover:underline hover:text-app-ink/80"
              >
                {post.replyToPostId}
              </a>
            </span>
          )}
          {post.forwardedFrom && (
            <span className="text-[11px] font-mono text-app-ink/60 flex items-center gap-1 border-l border-app-ink/10 pl-2">
              Forwarded from:
              {followsForwardSource ? (
                <span className="text-app-ink/60 font-medium">
                  {forwardName}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (post.forwardedFrom) onAddChannel(post.forwardedFrom)
                  }}
                  className="text-blue-500 hover:text-blue-600 hover:bg-blue-500/10 px-1.5 py-0.5 rounded transition-colors flex items-center gap-1 font-medium"
                  title={`Add @${post.forwardedFrom} to workspace`}
                >
                  {forwardName}
                  <PlusCircle size={10} />
                </button>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
