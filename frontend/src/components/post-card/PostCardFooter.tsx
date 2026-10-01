import { Copy, ExternalLink, Eye, Languages, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { formatCount } from "@/lib/format-count"
import { telegramWebViewPostUrl } from "@/lib/telegram-web"
import { cn } from "@/lib/utils"
import type { Post } from "@/types"
import { TgIconButton, tgIconButtonVariants } from "../ui/tg-icon-button"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tg-tooltip"
import { SHORTCUTS } from "./FeedKeyboard"

/** The view count, the exact number on hover; nothing when unknown. */
export function PostCardViews({ post }: { post: Post }) {
  if (post.viewsCount == null) return null
  return (
    <span
      className="inline-flex items-center gap-1"
      title={`${post.viewsCount.toLocaleString()} views`}
    >
      <Eye size={12} />
      {formatCount(post.viewsCount)}
    </span>
  )
}

/**
 * The most frequent reactions first, then "+N" for the rest. A paid chip has
 * no emoji and shows as a star; a custom emoji cannot be drawn and shows as a
 * neutral glyph.
 */
export function PostCardReactions({
  post,
  max = 4,
}: {
  post: Post
  max?: number
}) {
  const chips = [...(post.reactionCounts ?? [])].sort(
    (a, b) => b.count - a.count,
  )
  if (chips.length === 0) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {chips.slice(0, max).map((r) => {
        const glyph = r.isPaid ? "⭐" : r.emoji || "◆"
        return (
          <span
            key={r.isPaid ? "paid" : (r.customEmojiId ?? r.emoji ?? glyph)}
            data-testid="post-card-reaction"
            className="inline-flex items-center gap-1 rounded-full bg-app-ink/5 px-1.5 py-0.5 text-[11px]"
          >
            <span>{glyph}</span>
            <span className="font-mono text-app-ink/60">
              {formatCount(r.count)}
            </span>
          </span>
        )
      })}
      {chips.length > max && (
        <span className="text-[11px] text-app-ink/40">
          +{chips.length - max}
        </span>
      )}
    </span>
  )
}

/** The translate button's state; absent when the post needs no translating. */
export type PostTranslationControl = {
  showing: boolean
  busy: boolean
  onToggle: () => void
}

/** "Copy link (c)" while Keyboard mode is on, so the tooltip teaches the key. */
const withKey = (label: string, key: string, keyboard: boolean) =>
  keyboard ? `${label} (${key})` : label

/**
 * The actions, always visible: translate, find related, copy link, open in
 * Telegram. Each carries the letter Keyboard mode fires it with
 * (`FeedKeyboard`). With `labels`, translate also names itself on wide screens.
 */
export function PostCardActions({
  post,
  translation,
  onFindRelated,
  keyboard = false,
  labels = false,
}: {
  post: Post
  /** Present only when the post is in a language that needs translating. */
  translation?: PostTranslationControl
  /** Present only when embeddings are enabled. */
  onFindRelated?: () => void
  keyboard?: boolean
  labels?: boolean
}) {
  const postUrl = telegramWebViewPostUrl(post.channelName, post.id)
  const translateLabel = translation?.showing ? "Show Original" : "Translate"
  const copyLink = () =>
    navigator.clipboard
      .writeText(postUrl)
      .then(() => toast.success("Link copied"))
      .catch(() => toast.error("Could not copy the link"))
  return (
    <span className="ml-auto flex items-center gap-0.5">
      {translation && (
        <TgIconButton
          aria-label={translateLabel}
          tooltip={withKey(translateLabel, SHORTCUTS.translate, keyboard)}
          data-shortcut={SHORTCUTS.translate}
          onClick={translation.onToggle}
          loading={translation.busy}
          className={cn(
            "gap-1.5 text-[12px]",
            translation.showing && "text-blue-500 bg-blue-500/10",
          )}
        >
          <Languages size={14} />
          {labels && <span className="hidden sm:inline">{translateLabel}</span>}
        </TgIconButton>
      )}
      {onFindRelated && (
        <TgIconButton
          aria-label="Find Related Posts"
          tooltip={withKey("Find Related Posts", SHORTCUTS.related, keyboard)}
          data-shortcut={SHORTCUTS.related}
          onClick={onFindRelated}
          className="text-purple-500/70 hover:text-purple-600 hover:bg-purple-500/10"
        >
          <Sparkles size={14} />
        </TgIconButton>
      )}
      <TgIconButton
        aria-label="Copy Link"
        tooltip={withKey("Copy Link", SHORTCUTS.copy, keyboard)}
        data-shortcut={SHORTCUTS.copy}
        onClick={copyLink}
      >
        <Copy size={14} />
      </TgIconButton>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={postUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open in Telegram"
            data-shortcut={SHORTCUTS.open}
            className={cn(tgIconButtonVariants({ variant: "ghost" }))}
          >
            <ExternalLink size={14} />
          </a>
        </TooltipTrigger>
        <TooltipContent>
          <p>{withKey("Open in Telegram", SHORTCUTS.open, keyboard)}</p>
        </TooltipContent>
      </Tooltip>
    </span>
  )
}
