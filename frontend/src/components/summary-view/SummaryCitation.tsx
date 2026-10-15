/**
 * A Citation in a Summary's report (SUMTAB-04): the `[channel #id]` chip and
 * the Cited Post behind it as a full post card.
 *
 * How it opens, hover card or bottom sheet, is `PostPreview`'s. The Chat tab
 * keeps its own text hover (`CitationHover`).
 */
import { CITATION_ATTR, citationKey } from "@/lib/citations/find-citation"
import type { CitedPost } from "@/lib/summaries/cited-posts"
import { telegramWebViewPostUrl } from "@/lib/telegram-web"
import {
  OpenInTelegram,
  PostPreview,
  PreviewedPost,
  PreviewLoading,
  type PreviewWorkspace,
} from "../PostPreview"

export interface SummaryCitationProps {
  cited: CitedPost
  /** The live lookup has not answered yet. */
  loading: boolean
  /** No hover or a narrow screen: a tap opens a bottom sheet. */
  sheet: boolean
  workspace: PreviewWorkspace
}

const CHIP =
  "inline-flex items-center justify-center px-1.5 py-0.5 mx-1 text-[10px] font-mono font-bold uppercase tracking-wider bg-app-ink/10 text-app-ink rounded transition-colors hover:bg-app-ink hover:text-app-bg scroll-my-24 data-[channel-highlight]:bg-blue-500/20 data-[channel-highlight]:ring-1 data-[channel-highlight]:ring-blue-500 data-[citation-found]:bg-amber-300 data-[citation-found]:text-app-ink data-[citation-found]:ring-2 data-[citation-found]:ring-amber-400"

export function SummaryCitation({
  cited,
  loading,
  sheet,
  workspace,
}: SummaryCitationProps) {
  const label = `${cited.channelName} #${cited.postId}`
  return (
    <PostPreview
      sheet={sheet}
      href={telegramWebViewPostUrl(cited.channelName, cited.postId)}
      title={label}
      description="The post this Citation names"
      triggerProps={{
        [CITATION_ATTR]: citationKey(cited.channelName, cited.postId),
      }}
      triggerClassName={CHIP}
      sheetLabel={`Show cited post ${label}`}
      card={
        <CitedPostCard cited={cited} loading={loading} workspace={workspace} />
      }
    >
      {label}
    </PostPreview>
  )
}

/** The Cited Post, or why there is none, with the out-of-Scope notice above. */
export function CitedPostCard({
  cited,
  loading,
  workspace,
}: Omit<SummaryCitationProps, "sheet">) {
  const { post } = cited
  return (
    <div data-testid="cited-post-card" className="flex flex-col gap-2">
      {cited.outsideScope && (
        <p
          role="note"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-800 dark:text-amber-200"
        >
          Outside this Summary's Scope: the AI cited a Post it was not given.
        </p>
      )}
      {post ? (
        <>
          {cited.source === "snapshot" && (
            <p className="px-1 text-[11px] text-app-ink/50">
              As saved with this Summary; the Post is no longer stored.
            </p>
          )}
          <PreviewedPost post={post} workspace={workspace} />
        </>
      ) : loading ? (
        <PreviewLoading />
      ) : (
        <div className="flex flex-col items-center gap-2 px-3 py-6 text-center text-sm text-app-ink/60">
          <p>
            Post not found: it is no longer stored and this Summary kept no
            copy.
          </p>
          <OpenInTelegram
            href={telegramWebViewPostUrl(cited.channelName, cited.postId)}
          />
        </div>
      )}
    </div>
  )
}
