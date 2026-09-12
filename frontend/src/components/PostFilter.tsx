import {
  Calendar,
  Filter,
  ListOrdered,
  Search,
  Sparkles,
  X,
} from "lucide-react"
import React from "react"
import { AnalysisWindowControl } from "@/components/AnalysisWindowControl"
import { TgButton } from "@/components/ui/tg-button"
import { TgFilterChip } from "@/components/ui/tg-chips"
import { useScraper } from "../contexts/ScraperContext"
import { useSettings } from "../contexts/SettingsContext"
import { MEDIA_FILTER_OPTIONS } from "../lib/posts/post-media"

interface PostFilterProps {
  postSearch: string
  setPostSearch: (val: string) => void
}

export const PostFilter: React.FC<PostFilterProps> = ({
  postSearch,
  setPostSearch,
}) => {
  const {
    semanticSearchQuery,
    setSemanticSearchQuery,
    semanticSearchRespectsChannels,
    setSemanticSearchRespectsChannels,
    relatedPostSearch,
    setRelatedPostSearch,
    forwardedFilter,
    setForwardedFilter,
    mediaFilter,
    setMediaFilter,
    maxPostsPerChannel,
    setMaxPostsPerChannel,
    maxPostsPerChannelMode,
    setMaxPostsPerChannelMode,
    postSortOrder,
    setPostSortOrder,
  } = useScraper()
  const { embeddingsEnabled } = useSettings()

  const [semanticInput, setSemanticInput] = React.useState(
    semanticSearchQuery || "",
  )

  React.useEffect(() => {
    setSemanticInput(semanticSearchQuery || "")
  }, [semanticSearchQuery])

  if (relatedPostSearch) {
    return (
      <section className="bg-gradient-to-r from-purple-500/10 to-transparent border border-purple-500/20 rounded-xl overflow-hidden shadow-sm mb-6">
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center shadow-[0_0_15px_rgba(168,85,247,0.2)]">
              <Sparkles
                size={18}
                className="text-purple-500 drop-shadow-[0_0_8px_rgba(168,85,247,0.6)]"
              />
            </div>
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest text-purple-600 dark:text-purple-400">
                Related Post Search Active
              </h2>
              <p className="text-sm font-serif italic text-purple-800/70 dark:text-purple-200/70 mt-0.5 max-w-2xl truncate">
                Showing posts related to: "{relatedPostSearch.text}"
              </p>
            </div>
          </div>
          <TgButton
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setRelatedPostSearch(null)}
            className="rounded-full border-0 bg-purple-500/10 text-purple-600 hover:bg-purple-500 hover:text-white dark:text-purple-400"
          >
            <X size={14} /> Clear Search
          </TgButton>
        </div>
      </section>
    )
  }

  return (
    <>
      {semanticSearchQuery && (
        <section className="bg-gradient-to-r from-blue-500/10 to-transparent border border-blue-500/20 rounded-xl overflow-hidden shadow-sm mb-6">
          <div className="flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center shadow-[0_0_15px_rgba(59,130,246,0.2)]">
                <Sparkles
                  size={18}
                  className="text-blue-500 drop-shadow-[0_0_8px_rgba(59,130,246,0.6)]"
                />
              </div>
              <div>
                <h2 className="text-xs font-bold uppercase tracking-widest text-blue-600 dark:text-blue-400">
                  Semantic Search Active
                </h2>
                <p className="text-sm font-serif italic text-blue-800/70 dark:text-blue-200/70 mt-0.5">
                  "{semanticSearchQuery}"
                </p>
              </div>
            </div>
            <TgButton
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setSemanticSearchQuery("")}
              className="rounded-full border-0 bg-blue-500/10 text-blue-600 hover:bg-blue-500 hover:text-white dark:text-blue-400"
            >
              <X size={14} /> Clear Search
            </TgButton>
          </div>
        </section>
      )}

      <section className="bg-app-card border border-app-ink/10 rounded-xl shadow-md overflow-hidden mb-6">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-app-ink/5 bg-app-muted/30">
          <div className="flex items-center gap-2.5">
            <Filter size={14} className="text-app-ink/60" />
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-app-ink/70">
              Post Filtration
            </h2>
          </div>
        </div>

        <div className="p-5 flex flex-col gap-6">
          {/*
           * One control for the whole Analysis window (AW-04).
           *
           * This was two permanently expanded `datetime-local` fields and a row
           * of nine quick ranges, occupying a block of page height whether or
           * not anybody was changing the window — and saying nothing about
           * whether that window moves with the clock. The summary says which it
           * is; the editor behind it is the only one in the application.
           */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Calendar size={12} className="text-app-ink/60" />
              <label className="text-[11px] uppercase font-bold text-app-ink/70 tracking-widest">
                Analysis Window
              </label>
            </div>
            <AnalysisWindowControl />
          </div>

          {/* Bottom Row: Search Filters */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pt-6 border-t border-app-ink/5">
            {/* Column 1: Keyword Search & Post Type */}
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Search size={12} className="text-app-ink/60" />
                  <label className="text-[11px] uppercase font-bold text-app-ink/70 tracking-widest">
                    Keyword Search
                  </label>
                </div>
                <div className="relative w-full group">
                  <Search
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-app-ink/50 group-focus-within:text-app-ink transition-colors"
                  />
                  <input
                    type="text"
                    placeholder="SEARCH POSTS..."
                    value={postSearch}
                    onChange={(e) => setPostSearch(e.target.value)}
                    className="w-full bg-app-muted border border-app-ink/10 rounded-xl pl-9 pr-4 py-2 text-[11px] font-mono focus:outline-none focus:border-app-ink/30 focus:ring-4 focus:ring-app-ink/5 transition-all placeholder:uppercase placeholder:tracking-widest shadow-sm"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Filter size={12} className="text-app-ink/60" />
                  <label className="text-[11px] uppercase font-bold text-app-ink/70 tracking-widest">
                    Post Type
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: "All Posts", value: "all" as const },
                    { label: "Original Only", value: "original" as const },
                    { label: "Forwarded Only", value: "forwarded" as const },
                    {
                      label: "Unfollowed Forwarded",
                      value: "unfollowed_forwarded" as const,
                    },
                  ].map((type) => (
                    <TgFilterChip
                      key={type.value}
                      selected={forwardedFilter === type.value}
                      onClick={() => setForwardedFilter(type.value)}
                    >
                      {type.label}
                    </TgFilterChip>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Filter size={12} className="text-app-ink/60" />
                  <label className="text-[11px] uppercase font-bold text-app-ink/70 tracking-widest">
                    Media Content
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  {MEDIA_FILTER_OPTIONS.map((type) => (
                    <TgFilterChip
                      key={type.value}
                      data-testid={`post-media-filter-${type.value}`}
                      selected={mediaFilter === type.value}
                      onClick={() => setMediaFilter(type.value)}
                    >
                      {type.label}
                    </TgFilterChip>
                  ))}
                </div>
              </div>
            </div>

            {/* Post limit & order */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <ListOrdered size={12} className="text-app-ink/60" />
                <label className="text-[11px] uppercase font-bold text-app-ink/70 tracking-widest">
                  Post Limit & Order
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  {/*
                   * Blank, not `0`, when there is no cap.
                   *
                   * `0` here means "no limit", but it reads as "zero posts" —
                   * and it sat next to an `Unlimited` chip, so the control
                   * showed a number and a word that flatly contradict each
                   * other. An empty field with an `Unlimited` placeholder says
                   * the same thing once.
                   */}
                  <input
                    type="number"
                    min={0}
                    max={500}
                    placeholder="Unlimited"
                    value={maxPostsPerChannel === 0 ? "" : maxPostsPerChannel}
                    onChange={(e) => {
                      const parsed = Number.parseInt(e.target.value, 10)
                      setMaxPostsPerChannel(
                        Number.isFinite(parsed) && parsed >= 0 ? parsed : 0,
                      )
                    }}
                    className="w-20 bg-app-muted text-app-ink border border-app-ink/10 rounded-xl py-2 px-3 focus:outline-none focus:border-app-ink/30 focus:ring-4 focus:ring-app-ink/5 transition-all text-[11px] font-mono"
                  />
                  <span className="text-[11px] uppercase font-bold tracking-widest text-app-ink/60">
                    per channel
                  </span>
                </div>

                <div
                  className={`flex flex-wrap gap-2 ${maxPostsPerChannel === 0 ? "opacity-40 pointer-events-none" : ""}`}
                >
                  {[
                    { label: "Latest", value: "latest" as const },
                    { label: "Random", value: "random" as const },
                  ].map((mode) => (
                    <TgFilterChip
                      key={mode.value}
                      selected={maxPostsPerChannelMode === mode.value}
                      onClick={() => setMaxPostsPerChannelMode(mode.value)}
                    >
                      {mode.label}
                    </TgFilterChip>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {[
                  { label: "By Time", value: "time" as const },
                  { label: "By Channel", value: "channel_time" as const },
                ].map((sort) => (
                  <TgFilterChip
                    key={sort.value}
                    selected={postSortOrder === sort.value}
                    onClick={() => setPostSortOrder(sort.value)}
                  >
                    {sort.label}
                  </TgFilterChip>
                ))}
              </div>
            </div>

            {/* Column 2: Semantic Search */}
            {embeddingsEnabled && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Sparkles size={12} className="text-blue-500/80" />
                  <label className="text-[11px] uppercase font-bold text-blue-500/80 tracking-widest">
                    Semantic Search
                  </label>
                </div>
                <div className="relative w-full group">
                  <Sparkles
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-500/70 group-focus-within:text-blue-500 transition-colors"
                  />
                  <input
                    type="text"
                    placeholder="FIND BY MEANING (PRESS ENTER)..."
                    value={semanticInput}
                    onChange={(e) => setSemanticInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && semanticInput.trim()) {
                        setSemanticSearchQuery(semanticInput.trim())
                      }
                    }}
                    className="w-full bg-blue-500/5 border border-blue-500/20 rounded-xl pl-9 pr-4 py-2 text-[11px] font-mono focus:outline-none focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/10 transition-all placeholder:uppercase placeholder:tracking-widest shadow-sm text-blue-600 dark:text-blue-400 placeholder:text-blue-500/60"
                  />
                </div>

                <div className="flex flex-col gap-1.5 mt-1">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={!semanticSearchRespectsChannels}
                      onChange={(e) =>
                        setSemanticSearchRespectsChannels(!e.target.checked)
                      }
                      className="w-3 h-3 accent-blue-500 rounded-sm"
                    />
                    <span className="text-[11px] uppercase font-bold tracking-wider text-app-ink/70 group-hover:text-app-ink transition-colors">
                      Ignore selected channels for semantic search
                    </span>
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  )
}
