import {
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  ExternalLink,
  Hash,
  Languages,
  Loader2,
  PlusCircle,
  Sparkles,
} from "lucide-react"
import type React from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { useData } from "../contexts/DataContext"
import { useScraper } from "../contexts/ScraperContext"
import { useSettings } from "../contexts/SettingsContext"
import { useTranslation } from "../contexts/TranslationContext"
import { getTranslation, saveTranslation } from "../lib/repository"
import { highlightText } from "../lib/utils"
import type { Post } from "../types"
import { RelativeTime } from "./RelativeTime"
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tg-tooltip"

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
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-app-ink/10 to-app-ink/5 flex items-center justify-center text-[12px] font-bold uppercase text-app-ink/70 border border-app-ink/10 shadow-sm">
            {post.channelName.charAt(0)}
          </div>
          <div className="flex flex-col">
            <span className="text-[13px] font-bold uppercase tracking-tight">
              @{highlightText(post.channelName, postSearch)}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-app-ink/60 flex items-center gap-1">
                <Hash size={10} /> {post.id}
              </span>
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

        <div className="flex items-center gap-4">
          <span className="text-[11px] font-mono text-app-ink/60 uppercase tracking-widest flex items-center gap-1.5 bg-app-ink/5 px-2.5 py-1 rounded-full">
            <Clock size={10} />
            <RelativeTime
              timestamp={post.timestamp || new Date(post.date).getTime()}
            />
          </span>

          {/* Action Bar */}
          <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-all duration-200 translate-x-2 group-hover:translate-x-0 group-focus-within:translate-x-0 bg-app-card/90 backdrop-blur-md p-1 rounded-full border border-app-ink/10 shadow-sm">
            {translationEnabled && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleTranslate}
                      disabled={isTranslating}
                      className={`p-1.5 rounded-full transition-all ${showTranslation ? "text-blue-500 bg-blue-500/10" : "text-app-ink/50 hover:text-blue-500 hover:bg-blue-500/10"}`}
                    >
                      {isTranslating ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Languages size={14} />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{showTranslation ? "Show Original" : "Translate"}</p>
                  </TooltipContent>
                </Tooltip>
                <div className="w-px h-4 bg-app-ink/10 mx-0.5" />
              </>
            )}
            {embeddingsEnabled && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => {
                        setRelatedPostSearch(post)
                        window.scrollTo({ top: 0, behavior: "smooth" })
                      }}
                      className="p-1.5 rounded-full text-purple-500/70 hover:text-purple-600 hover:bg-purple-500/10 transition-all"
                    >
                      <Sparkles size={14} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Find Related Posts</p>
                  </TooltipContent>
                </Tooltip>
                <div className="w-px h-4 bg-app-ink/10 mx-0.5" />
              </>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(
                      `https://t.me/s/${post.channelName}/${post.id}`,
                    )
                  }}
                  className="p-1.5 rounded-full text-app-ink/50 hover:text-app-ink hover:bg-app-ink/5 transition-all"
                >
                  <Copy size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Copy Link</p>
              </TooltipContent>
            </Tooltip>
            <div className="w-px h-4 bg-app-ink/10 mx-0.5" />
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={`https://t.me/s/${post.channelName}/${post.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-full text-app-ink/50 hover:text-app-ink hover:bg-app-ink/5 transition-all"
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
      <div className="p-5">
        <div className="relative">
          <p
            dir="auto"
            className={`text-[14px] leading-relaxed whitespace-pre-wrap font-sans text-app-ink/80 ${
              isLongPost && !isExpanded ? "max-h-64 overflow-hidden" : ""
            }`}
          >
            {highlightText(activeText, postSearch)}
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
