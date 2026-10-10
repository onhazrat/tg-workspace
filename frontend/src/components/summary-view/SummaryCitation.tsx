/**
 * A Citation in a Summary's report (SUMTAB-04): the `[channel #id]` chip and
 * the Cited Post behind it as a full post card.
 *
 * With hover, the card opens in a hover card whose height is capped to the
 * room the positioner reports (`--available-height`) and scrolls inside, so a
 * long Post is readable rather than cut off. With no hover, or on a narrow
 * screen, a tap opens the same card in a bottom sheet. The Chat tab keeps its
 * own text hover (`CitationHover`).
 */
import { PreviewCard } from "@base-ui/react/preview-card"
import { ExternalLink, Loader2 } from "lucide-react"
import { useState, useSyncExternalStore } from "react"
import { CITATION_ATTR, citationKey } from "@/lib/citations/find-citation"
import type { CitedPost } from "@/lib/summaries/cited-posts"
import { telegramWebViewPostUrl } from "@/lib/telegram-web"
import type { Channel } from "@/types"
import { PostCardView } from "../post-card/PostCardView"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet"

/** What the card needs from the workspace; `SummaryMarkdown` passes it in. */
export interface CitationWorkspace {
  channel: (name: string) => Channel | undefined
  onAddChannel: (name: string) => void
}

export interface SummaryCitationProps {
  cited: CitedPost
  /** The live lookup has not answered yet. */
  loading: boolean
  /** No hover or a narrow screen: a tap opens a bottom sheet. */
  sheet: boolean
  workspace: CitationWorkspace
}

const CHIP =
  "inline-flex items-center justify-center px-1.5 py-0.5 mx-1 text-[10px] font-mono font-bold uppercase tracking-wider bg-app-ink/10 text-app-ink rounded transition-colors hover:bg-app-ink hover:text-app-bg scroll-my-24 data-[citation-found]:bg-amber-300 data-[citation-found]:text-app-ink data-[citation-found]:ring-2 data-[citation-found]:ring-amber-400"

export function SummaryCitation({
  cited,
  loading,
  sheet,
  workspace,
}: SummaryCitationProps) {
  const [open, setOpen] = useState(false)
  const label = `${cited.channelName} #${cited.postId}`
  const target = {
    [CITATION_ATTR]: citationKey(cited.channelName, cited.postId),
  }
  const card = (
    <CitedPostCard cited={cited} loading={loading} workspace={workspace} />
  )

  if (sheet)
    return (
      <>
        <button
          type="button"
          {...target}
          aria-label={`Show cited post ${label}`}
          className={`${CHIP} cursor-pointer`}
          onClick={(e) => {
            // A bullet searches for related posts on click; this is not that.
            e.stopPropagation()
            setOpen(true)
          }}
        >
          {label}
        </button>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            className="max-h-[85dvh] gap-0 rounded-t-2xl"
          >
            <SheetHeader className="pb-2">
              <SheetTitle className="font-mono text-sm">{label}</SheetTitle>
              <SheetDescription className="sr-only">
                The post this Citation names
              </SheetDescription>
            </SheetHeader>
            <div className="overflow-y-auto overscroll-contain px-4 pb-6">
              {card}
            </div>
          </SheetContent>
        </Sheet>
      </>
    )

  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        {...target}
        href={telegramWebViewPostUrl(cited.channelName, cited.postId)}
        target="_blank"
        rel="noopener noreferrer"
        delay={150}
        className={`${CHIP} cursor-help`}
        onClick={(e) => e.stopPropagation()}
      >
        {label}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner
          side="top"
          sideOffset={8}
          collisionPadding={8}
          className="z-50"
        >
          <PreviewCard.Popup className="max-h-(--available-height) w-[min(28rem,calc(100vw-1rem))] overflow-y-auto overscroll-contain rounded-2xl border border-app-ink/10 bg-app-bg p-2 shadow-xl">
            {card}
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
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
          <PostCardView
            post={post}
            text={post.text}
            postSearch=""
            channel={workspace.channel(post.channelName)}
            followsForwardSource={!!workspace.channel(post.forwardedFrom ?? "")}
            onAddChannel={workspace.onAddChannel}
            wholeText
          />
        </>
      ) : loading ? (
        <div className="flex justify-center py-6">
          <Loader2
            className="size-4 animate-spin opacity-50"
            aria-label="Loading post"
          />
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 px-3 py-6 text-center text-sm text-app-ink/60">
          <p>
            Post not found: it is no longer stored and this Summary kept no
            copy.
          </p>
          <a
            href={telegramWebViewPostUrl(cited.channelName, cited.postId)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-blue-500 hover:underline"
          >
            Open in Telegram <ExternalLink size={12} />
          </a>
        </div>
      )}
    </div>
  )
}

const HOVER_WIDE = "(hover: hover) and (min-width: 768px)"

/** True where a Citation opens a bottom sheet: no hover, or a narrow screen. */
export function useCitationSheet(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia?.(HOVER_WIDE)
      mql?.addEventListener("change", onChange)
      return () => mql?.removeEventListener("change", onChange)
    },
    () => !(window.matchMedia?.(HOVER_WIDE).matches ?? true),
  )
}
