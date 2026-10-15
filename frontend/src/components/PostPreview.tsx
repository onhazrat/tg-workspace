/**
 * A link that previews a Post: a Citation's Cited Post (SUMTAB-04) or a
 * reply's parent.
 *
 * With hover, the card opens in a hover card whose height is capped to the
 * room the positioner reports (`--available-height`) and scrolls inside, so a
 * long Post is readable rather than cut off; a click still follows the link.
 * With no hover, or on a narrow screen, a tap opens the same card in a bottom
 * sheet. The body mounts only while open, so a lookup inside it runs on open.
 */
import { PreviewCard } from "@base-ui/react/preview-card"
import { ExternalLink, Loader2 } from "lucide-react"
import { type ReactNode, useMemo, useState, useSyncExternalStore } from "react"
import { MOBILE_BREAKPOINT } from "@/constants"
import { useData } from "@/contexts/DataContext"
import { useScraper } from "@/contexts/ScraperContext"
import { cn } from "@/lib/utils"
import type { Channel, Post } from "@/types"
import { PostCardView } from "./post-card/PostCardView"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet"

export interface PostPreviewProps {
  /** No hover or a narrow screen: a tap opens a bottom sheet. */
  sheet: boolean
  /** Where a click goes when there is hover. */
  href: string
  /** The sheet's title. */
  title: string
  /** The sheet's description, for screen readers. */
  description: string
  /** Data attributes for the trigger in both modes, test ids among them. */
  triggerProps?: Record<`data-${string}`, string>
  triggerClassName: string
  /** The sheet trigger's accessible name, when its text is not enough. */
  sheetLabel?: string
  /** What the trigger shows. */
  children: ReactNode
  /** The card, rendered only while the preview is open. */
  card: ReactNode
}

export function PostPreview({
  sheet,
  href,
  title,
  description,
  triggerProps,
  triggerClassName,
  sheetLabel,
  children,
  card,
}: PostPreviewProps) {
  const [open, setOpen] = useState(false)

  const inner = sheet ? (
    <>
      <button
        type="button"
        {...triggerProps}
        aria-label={sheetLabel}
        className={cn(triggerClassName, "cursor-pointer")}
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] gap-0 rounded-t-2xl"
        >
          <SheetHeader className="pb-2">
            <SheetTitle className="font-mono text-sm">{title}</SheetTitle>
            <SheetDescription className="sr-only">
              {description}
            </SheetDescription>
          </SheetHeader>
          <div className="overflow-y-auto overscroll-contain px-4 pb-6">
            {card}
          </div>
        </SheetContent>
      </Sheet>
    </>
  ) : (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        {...triggerProps}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        delay={150}
        className={cn(triggerClassName, "cursor-help")}
      >
        {children}
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

  // React bubbles a portal's events through the tree, so a click in the hover
  // card or the sheet would reach whatever holds the trigger (a Summary
  // bullet searches for related posts on click). One stop here covers the
  // trigger, the card, the overlay and Close.
  return (
    <span className="contents" onClick={(e) => e.stopPropagation()}>
      {inner}
    </span>
  )
}

const HOVER_WIDE = `(hover: hover) and (min-width: ${MOBILE_BREAKPOINT}px)`

// Module-level so `useSyncExternalStore` keeps one subscription rather than
// resubscribing on every render.
function subscribeHoverWide(onChange: () => void): () => void {
  const mql = window.matchMedia?.(HOVER_WIDE)
  mql?.addEventListener("change", onChange)
  return () => mql?.removeEventListener("change", onChange)
}

/** True where a preview opens a bottom sheet: no hover, or a narrow screen. */
export function usePreviewSheet(): boolean {
  return useSyncExternalStore(
    subscribeHoverWide,
    () => !(window.matchMedia?.(HOVER_WIDE).matches ?? true),
  )
}

/** What a previewed post card needs from the workspace. */
export interface PreviewWorkspace {
  channel: (name: string) => Channel | undefined
  onAddChannel: (name: string) => void
}

/** The workspace's Channels, which a post card and an avatar read. */
export function usePreviewWorkspace(): PreviewWorkspace {
  const { channels } = useData()
  const { addNewChannel } = useScraper()
  return useMemo(
    () => ({
      channel: (name: string) =>
        channels.find((c) => c.name.toLowerCase() === name.toLowerCase()),
      onAddChannel: addNewChannel,
    }),
    [channels, addNewChannel],
  )
}

/** A previewed Post as a full post card, its text whole. */
export function PreviewedPost({
  post,
  workspace,
}: {
  post: Post
  workspace: PreviewWorkspace
}) {
  return (
    <PostCardView
      post={post}
      text={post.text}
      postSearch=""
      channel={workspace.channel(post.channelName)}
      followsForwardSource={!!workspace.channel(post.forwardedFrom ?? "")}
      onAddChannel={workspace.onAddChannel}
      wholeText
    />
  )
}

export function PreviewLoading() {
  return (
    <div className="flex justify-center py-6">
      <Loader2
        className="size-4 animate-spin opacity-50"
        aria-label="Loading post"
      />
    </div>
  )
}

export function OpenInTelegram({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 self-center text-blue-500 hover:underline"
    >
      Open in Telegram <ExternalLink size={12} />
    </a>
  )
}
