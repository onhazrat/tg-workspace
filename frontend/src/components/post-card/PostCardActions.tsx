import { Copy, ExternalLink, Languages, Sparkles } from "lucide-react"
import { telegramWebViewPostUrl } from "@/lib/telegram-web"
import { cn } from "@/lib/utils"
import type { Post } from "@/types"
import { TgIconButton, tgIconButtonVariants } from "../ui/tg-icon-button"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tg-tooltip"

const Divider = () => <div className="w-px h-4 bg-app-ink/10 mx-0.5" />

/**
 * The hover action bar: translate, find related, copy link, open. Anchored
 * left of the time badge so hover never covers it.
 */
export function PostCardActions({
  post,
  translation,
  onFindRelated,
}: {
  post: Post
  /** Present only when the post is in a language that needs translating. */
  translation?: {
    showing: boolean
    busy: boolean
    onToggle: () => void
  }
  /** Present only when embeddings are enabled. */
  onFindRelated?: () => void
}) {
  const postUrl = telegramWebViewPostUrl(post.channelName, post.id)
  const translateLabel = translation?.showing ? "Show Original" : "Translate"
  return (
    <div className="absolute right-full mr-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto transition-all duration-200 translate-x-2 group-hover:translate-x-0 group-focus-within:translate-x-0 bg-app-card/90 backdrop-blur-md p-1 rounded-full border border-app-ink/10 shadow-sm">
      {translation && (
        <>
          <TgIconButton
            aria-label={translateLabel}
            tooltip={translateLabel}
            onClick={translation.onToggle}
            loading={translation.busy}
            className={
              translation.showing
                ? "text-blue-500 bg-blue-500/10"
                : "hover:text-blue-500 hover:bg-blue-500/10"
            }
          >
            <Languages size={14} />
          </TgIconButton>
          <Divider />
        </>
      )}
      {onFindRelated && (
        <>
          <TgIconButton
            aria-label="Find Related Posts"
            tooltip="Find Related Posts"
            onClick={onFindRelated}
            className="text-purple-500/70 hover:text-purple-600 hover:bg-purple-500/10"
          >
            <Sparkles size={14} />
          </TgIconButton>
          <Divider />
        </>
      )}
      <TgIconButton
        aria-label="Copy Link"
        tooltip="Copy Link"
        onClick={() => navigator.clipboard.writeText(postUrl)}
      >
        <Copy size={14} />
      </TgIconButton>
      <Divider />
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={postUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open in Telegram"
            className={cn(tgIconButtonVariants({ variant: "ghost" }))}
          >
            <ExternalLink size={14} />
          </a>
        </TooltipTrigger>
        <TooltipContent>
          <p>Open in Telegram</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
