/**
 * A reply's parent, previewed from the reply link the way a Citation previews
 * its Cited Post: the whole Post when stored, Telegram's excerpt when not.
 */
import { useQuery } from "@tanstack/react-query"
import { ExternalLink, Loader2 } from "lucide-react"
import { createContext, useContext } from "react"
import { queryKeys } from "@/hooks/queryKeys"
import { getPost } from "@/lib/posts/store"
import { telegramWebViewPostUrl } from "@/lib/telegram-web"
import type { Channel, Post } from "@/types"
import { PostCardView } from "./PostCardView"
import { replyParentRef } from "./post-card-model"

/** What a parent's card needs from the workspace, and how it opens. */
export interface ReplyPreview {
  /** No hover or a narrow screen: a tap opens a bottom sheet. */
  sheet: boolean
  channel: (name: string) => Channel | undefined
  onAddChannel: (name: string) => void
}

/**
 * Provided where the reply link previews its parent; absent, the link is a
 * plain link to Telegram. A card inside the preview reads the same context,
 * so a parent that is itself a reply previews its own parent.
 */
export const ReplyPreviewContext = createContext<ReplyPreview | null>(null)

export const useReplyPreview = () => useContext(ReplyPreviewContext)

/** The parent on Telegram: the link Telegram gave, else the reply's Channel. */
export function replyParentUrl(reply: Post): string {
  return (
    reply.replyTo?.url ??
    telegramWebViewPostUrl(reply.channelName, reply.replyToPostId ?? 0)
  )
}

/** Looks the parent up; mounted only while the preview is open. */
export function ReplyParentLookup({
  reply,
  workspace,
}: {
  reply: Post
  workspace: ReplyPreview
}) {
  const ref = replyParentRef(reply)
  const { data, isPending } = useQuery({
    queryKey: queryKeys.replyParent(ref?.channelName ?? "", ref?.postId ?? 0),
    queryFn: async () =>
      ref ? ((await getPost(ref.channelName, ref.postId)) ?? null) : null,
    enabled: ref != null,
    staleTime: 60_000,
  })
  return (
    <ReplyParentCard
      reply={reply}
      parent={data ?? null}
      loading={ref != null && isPending}
      workspace={workspace}
    />
  )
}

/** The parent as a post card, or its excerpt, or why there is neither. */
export function ReplyParentCard({
  reply,
  parent,
  loading,
  workspace,
}: {
  reply: Post
  parent: Post | null
  loading: boolean
  workspace: ReplyPreview
}) {
  const excerpt = reply.replyTo?.text
  return (
    <div data-testid="reply-parent-card" className="flex flex-col gap-2">
      {parent ? (
        <PostCardView
          post={parent}
          text={parent.text}
          postSearch=""
          channel={workspace.channel(parent.channelName)}
          followsForwardSource={!!workspace.channel(parent.forwardedFrom ?? "")}
          onAddChannel={workspace.onAddChannel}
          wholeText
        />
      ) : loading ? (
        <div className="flex justify-center py-6">
          <Loader2
            className="size-4 animate-spin opacity-50"
            aria-label="Loading post"
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-3 py-4 text-sm text-app-ink/60">
          {excerpt ? (
            <>
              <p className="text-[11px] text-app-ink/50">
                Telegram's excerpt; the full post is not stored.
              </p>
              <p className="whitespace-pre-wrap break-words text-app-ink">
                {excerpt}
              </p>
            </>
          ) : (
            <p className="text-center">Post not found: it is not stored.</p>
          )}
          <a
            href={replyParentUrl(reply)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 self-center text-blue-500 hover:underline"
          >
            Open in Telegram <ExternalLink size={12} />
          </a>
        </div>
      )}
    </div>
  )
}
