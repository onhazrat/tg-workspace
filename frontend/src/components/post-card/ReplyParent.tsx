/**
 * A reply's parent, previewed from the reply link the way a Citation previews
 * its Cited Post: the whole Post when stored, Telegram's excerpt when not.
 */
import { useQuery } from "@tanstack/react-query"
import { createContext, type ReactNode, useContext, useMemo } from "react"
import { queryKeys } from "@/hooks/queryKeys"
import { getPost } from "@/lib/posts/store"
import type { Post } from "@/types"
import {
  OpenInTelegram,
  PreviewedPost,
  PreviewLoading,
  type PreviewWorkspace,
  usePreviewSheet,
  usePreviewWorkspace,
} from "../PostPreview"
import { replyParentRef } from "./post-card-model"

/** The workspace a parent's card reads, and how the preview opens. */
export interface ReplyPreview extends PreviewWorkspace {
  /** No hover or a narrow screen: a tap opens a bottom sheet. */
  sheet: boolean
}

/**
 * Provided where the reply link previews its parent; absent, the link is a
 * plain link to Telegram. A card inside the preview reads the same context,
 * so a parent that is itself a reply previews its own parent.
 */
export const ReplyPreviewContext = createContext<ReplyPreview | null>(null)

export const useReplyPreview = () => useContext(ReplyPreviewContext)

/** Turns reply previews on for every card below it, with one media query. */
export function ReplyPreviewProvider({ children }: { children: ReactNode }) {
  const workspace = usePreviewWorkspace()
  const sheet = usePreviewSheet()
  const value = useMemo(() => ({ ...workspace, sheet }), [workspace, sheet])
  return <ReplyPreviewContext value={value}>{children}</ReplyPreviewContext>
}

/** Looks the parent up; mounted only while the preview is open. */
export function ReplyParentLookup({
  reply,
  href,
  workspace,
}: {
  reply: Post
  /** The parent on Telegram. */
  href: string
  workspace: PreviewWorkspace
}) {
  const ref = replyParentRef(reply)
  const { data, isPending } = useQuery({
    queryKey: queryKeys.replyParent(ref?.channelName ?? "", ref?.postId ?? 0),
    queryFn: async () =>
      ref ? ((await getPost(ref.channelName, ref.postId)) ?? null) : null,
    enabled: ref != null,
    // A failed lookup shows the excerpt now rather than after the retries.
    retry: false,
    staleTime: 60_000,
  })
  return (
    <ReplyParentCard
      reply={reply}
      parent={data ?? null}
      loading={ref != null && isPending}
      href={href}
      workspace={workspace}
    />
  )
}

/** The parent as a post card, or its excerpt, or why there is neither. */
export function ReplyParentCard({
  reply,
  parent,
  loading,
  href,
  workspace,
}: {
  reply: Post
  parent: Post | null
  loading: boolean
  href: string
  workspace: PreviewWorkspace
}) {
  const excerpt = reply.replyTo?.text
  return (
    <div data-testid="reply-parent-card" className="flex flex-col gap-2">
      {parent ? (
        <PreviewedPost post={parent} workspace={workspace} />
      ) : loading ? (
        <PreviewLoading />
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
          <OpenInTelegram href={href} />
        </div>
      )}
    </div>
  )
}
