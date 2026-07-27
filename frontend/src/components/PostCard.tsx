import {
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  CornerUpLeft,
  ExternalLink,
  Eye,
  Hash,
  Image,
  Languages,
  Layers,
  Link2,
  Music,
  PlusCircle,
  Sparkles,
  Sticker,
  Video,
} from "lucide-react"
import type React from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { api } from "@/api"
import { useData } from "../contexts/DataContext"
import { useScraper } from "../contexts/ScraperContext"
import { useSettings } from "../contexts/SettingsContext"
import { useTranslation } from "../contexts/TranslationContext"
import { getMediaKindLabel, getPostMediaKinds } from "../lib/posts/post-media"
import { renderPostText } from "../lib/posts/render-post-text"
import { getTranslation, saveTranslation } from "../lib/repository"
import {
  telegramWebViewChannelUrl,
  telegramWebViewPostUrl,
} from "../lib/telegram-web"
import { cn, highlightText } from "../lib/utils"
import type { Post, PostMediaKind } from "../types"
import { ChannelAvatar } from "./ChannelAvatar"
import { RelativeTime } from "./RelativeTime"
import { Badge } from "./ui/badge"
import { TgIconButton, tgIconButtonVariants } from "./ui/tg-icon-button"
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tg-tooltip"

function MediaKindIcon({ kind }: { kind: PostMediaKind }) {
  switch (kind) {
    case "photo":
      return <Image size={10} />
    case "video":
      return <Video size={10} />
    case "link_preview":
      return <Link2 size={10} />
    case "grouped":
      return <Layers size={10} />
    case "audio":
      return <Music size={10} />
    case "sticker":
      return <Sticker size={10} />
    default:
      return null
  }
}

function PostThumbImage({ thumbApiPath }: { thumbApiPath: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let objectUrl: string | null = null
    setFailed(false)
    setSrc(null)

    api
      .fetchPostThumb(thumbApiPath)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      })
      .catch(() => {
        setFailed(true)
        setSrc(null)
      })

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [thumbApiPath])

  if (!src || failed) return null

  /*
   * `w-full max-h-80 object-contain` forced the element box to the full card
   * width and letterboxed the picture inside it, so `bg-app-muted` painted the
   * leftover: 813px of dead band on an 800x427 photo, 1233px on a 180x320 one —
   * 58% to 87% of the row. Sizing to the intrinsic aspect instead (`max-w-full`
   * + `max-h-80`, centred) makes the box *be* the picture, so there is no
   * leftover to paint and `object-contain` becomes unnecessary.
   */
  return (
    <img
      src={src}
      alt=""
      data-testid="post-card-thumb"
      className="max-w-full max-h-80 mx-auto rounded-lg border border-app-ink/10 bg-app-muted"
      loading="lazy"
      onError={() => {
        setFailed(true)
        setSrc(null)
      }}
    />
  )
}

interface PostCardProps {
  post: Post
  postSearch: string
}

export const PostCard: React.FC<PostCardProps> = ({ post, postSearch }) => {
  const {
    embeddingsEnabled,
    translationEnabled,
    autoTranslate,
    translationTargetLanguage,
  } = useSettings()
  const { setRelatedPostSearch, addNewChannel } = useScraper()
  const { channels } = useData()
  const { requestTranslation } = useTranslation()

  const [translatedText, setTranslatedText] = useState<string | null>(null)
  const [isTranslating, setIsTranslating] = useState(false)
  const [showTranslation, setShowTranslation] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)

  const activeText =
    showTranslation && translatedText ? translatedText : post.text
  const channel = useMemo(
    () =>
      channels.find(
        (c) => c.name.toLowerCase() === post.channelName.toLowerCase(),
      ),
    [channels, post.channelName],
  )
  const mediaKinds = useMemo(() => getPostMediaKinds(post), [post])
  const thumbApiPath = post.media?.thumbApiPath
  const viewsLabel = post.media?.views
  const isLongPost = useMemo(() => {
    const lineCount = activeText.split("\n").length
    return activeText.length > 900 || lineCount > 14
  }, [activeText])

  const handleTranslate = useCallback(async () => {
    if (isTranslating) return

    if (translatedText && showTranslation) {
      setShowTranslation(false)
      return
    }

    if (translatedText && !showTranslation) {
      setShowTranslation(true)
      return
    }

    setIsTranslating(true)
    try {
      const result = await requestTranslation(
        `${post.channelName}_${post.id}`,
        post.text,
      )
      setTranslatedText(result)
      setShowTranslation(true)

      await saveTranslation({
        id: `${post.channelName}_${post.id}_${translationTargetLanguage}`,
        channelName: post.channelName,
        postId: post.id,
        language: translationTargetLanguage,
        translatedText: result,
        timestamp: Date.now(),
      })
    } catch (error: any) {
      console.error("Translation failed:", error)
      // The TranslationContext handles the toast and disabling auto-translate for quota errors,
      // so we don't need to duplicate it here unless it's a different error.
      const errorMsg = error instanceof Error ? error.message : String(error)
      if (
        !errorMsg.toLowerCase().includes("quota") &&
        !errorMsg.toLowerCase().includes("429")
      ) {
        toast.error("Failed to translate post")
      }
    } finally {
      setIsTranslating(false)
    }
  }, [
    isTranslating,
    translatedText,
    showTranslation,
    requestTranslation,
    post.channelName,
    post.id,
    post.text,
    translationTargetLanguage,
  ])

  useEffect(() => {
    const loadTranslation = async () => {
      if (!translationEnabled) return

      const existingTranslation = await getTranslation(
        post.channelName,
        post.id,
        translationTargetLanguage,
      )
      if (existingTranslation) {
        setTranslatedText(existingTranslation.translatedText)
        if (autoTranslate) {
          setShowTranslation(true)
        }
      } else if (autoTranslate) {
        handleTranslate()
      }
    }

    loadTranslation()
  }, [
    post.channelName,
    post.id,
    translationEnabled,
    autoTranslate,
    translationTargetLanguage,
    handleTranslate,
  ])

  return (
    <div
      data-post-key={`${post.channelName}_${post.id}`}
      className="bg-app-card border border-app-ink/10 rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:border-app-ink/20 transition-all duration-200 group overflow-hidden flex flex-col"
    >
      {/* Post Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-app-muted/30 border-b border-app-ink/5 relative">
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
                      telegramWebViewPostUrl(
                        post.channelName,
                        post.replyToPostId,
                      )
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
                  {channels.some(
                    (c) =>
                      c.name.toLowerCase() ===
                      post.forwardedFrom?.toLowerCase(),
                  ) ? (
                    <span className="text-app-ink/60 font-medium">
                      {post.forwardedFromName || post.forwardedFrom}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (post.forwardedFrom) {
                          addNewChannel(post.forwardedFrom)
                        }
                      }}
                      className="text-blue-500 hover:text-blue-600 hover:bg-blue-500/10 px-1.5 py-0.5 rounded transition-colors flex items-center gap-1 font-medium"
                      title={`Add @${post.forwardedFrom} to workspace`}
                    >
                      {post.forwardedFromName || post.forwardedFrom}
                      <PlusCircle size={10} />
                    </button>
                  )}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="relative flex items-center justify-end shrink-0">
          <span className="text-[11px] font-mono text-app-ink/60 uppercase tracking-widest flex items-center gap-1.5 bg-app-ink/5 px-2.5 py-1 rounded-full shrink-0">
            <Clock size={10} />
            <RelativeTime
              timestamp={post.timestamp || new Date(post.date).getTime()}
            />
          </span>

          {/* Action Bar — anchored left of the time badge so hover never covers it */}
          <div className="absolute right-full mr-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto transition-all duration-200 translate-x-2 group-hover:translate-x-0 group-focus-within:translate-x-0 bg-app-card/90 backdrop-blur-md p-1 rounded-full border border-app-ink/10 shadow-sm">
            {translationEnabled && (
              <>
                <TgIconButton
                  aria-label={showTranslation ? "Show Original" : "Translate"}
                  tooltip={showTranslation ? "Show Original" : "Translate"}
                  onClick={handleTranslate}
                  loading={isTranslating}
                  className={
                    showTranslation
                      ? "text-blue-500 bg-blue-500/10"
                      : "hover:text-blue-500 hover:bg-blue-500/10"
                  }
                >
                  <Languages size={14} />
                </TgIconButton>
                <div className="w-px h-4 bg-app-ink/10 mx-0.5" />
              </>
            )}
            {embeddingsEnabled && (
              <>
                <TgIconButton
                  aria-label="Find Related Posts"
                  tooltip="Find Related Posts"
                  onClick={() => {
                    setRelatedPostSearch(post)
                    window.scrollTo({ top: 0, behavior: "smooth" })
                  }}
                  className="text-purple-500/70 hover:text-purple-600 hover:bg-purple-500/10"
                >
                  <Sparkles size={14} />
                </TgIconButton>
                <div className="w-px h-4 bg-app-ink/10 mx-0.5" />
              </>
            )}
            <TgIconButton
              aria-label="Copy Link"
              tooltip="Copy Link"
              onClick={() => {
                navigator.clipboard.writeText(
                  telegramWebViewPostUrl(post.channelName, post.id),
                )
              }}
            >
              <Copy size={14} />
            </TgIconButton>
            <div className="w-px h-4 bg-app-ink/10 mx-0.5" />
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={telegramWebViewPostUrl(post.channelName, post.id)}
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
        </div>
      </div>

      {/* Post Body */}
      <div className="p-5 flex flex-col gap-4">
        {(mediaKinds.length > 0 || viewsLabel || thumbApiPath) && (
          <div className="flex flex-col gap-3">
            {(mediaKinds.length > 0 || viewsLabel) && (
              <div className="flex flex-wrap items-center gap-2">
                {mediaKinds.map((kind) => (
                  <Badge
                    key={kind}
                    variant="secondary"
                    data-testid={`post-card-media-badge-${kind}`}
                    className="gap-1 text-[10px] uppercase tracking-wider font-bold"
                  >
                    <MediaKindIcon kind={kind} />
                    {getMediaKindLabel(kind)}
                    {kind === "grouped" &&
                    post.media?.groupedCount != null &&
                    post.media.groupedCount > 1
                      ? ` (${post.media.groupedCount})`
                      : null}
                  </Badge>
                ))}
                {viewsLabel ? (
                  <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-app-ink/60">
                    <Eye size={10} />
                    {viewsLabel}
                  </span>
                ) : null}
              </div>
            )}
            {thumbApiPath ? (
              <PostThumbImage thumbApiPath={thumbApiPath} />
            ) : null}
          </div>
        )}

        <div className="relative">
          <p
            dir="auto"
            className={`text-[14px] leading-relaxed whitespace-pre-wrap font-sans text-app-ink/80 ${
              isLongPost && !isExpanded ? "max-h-64 overflow-hidden" : ""
            }`}
          >
            {renderPostText(activeText, postSearch)}
          </p>
          {isLongPost && !isExpanded ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-app-card to-transparent" />
          ) : null}
        </div>
        {isLongPost ? (
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-app-ink/15 bg-app-muted/40 px-2.5 py-1 text-[10px] font-mono uppercase tracking-widest text-app-ink/70 transition-colors hover:bg-app-ink/5 hover:text-app-ink"
          >
            {isExpanded ? (
              <>
                <ChevronUp size={12} />
                Collapse
              </>
            ) : (
              <>
                <ChevronDown size={12} />
                Show More
              </>
            )}
          </button>
        ) : null}
      </div>
    </div>
  )
}
