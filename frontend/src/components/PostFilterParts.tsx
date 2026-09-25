import { Sparkles, X } from "lucide-react"
import type React from "react"
import { TgButton } from "@/components/ui/tg-button"
import { TgFilterChip } from "@/components/ui/tg-chips"
import type { MaxPostsPerChannelMode } from "@/lib/posts/post-view"

/** The "Semantic Search Active" banner; renders nothing without a query. */
export const SemanticSearchBanner: React.FC<{
  query: string
  onClear: () => void
}> = ({ query, onClear }) => {
  if (!query) return null
  return (
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
              "{query}"
            </p>
          </div>
        </div>
        <TgButton
          type="button"
          variant="secondary"
          size="sm"
          onClick={onClear}
          className="rounded-full border-0 bg-blue-500/10 text-blue-600 hover:bg-blue-500 hover:text-white dark:text-blue-400"
        >
          <X size={14} /> Clear Search
        </TgButton>
      </div>
    </section>
  )
}

interface PostCapControlProps {
  /** `0` means no cap. */
  maxPostsPerChannel: number
  setMaxPostsPerChannel: (value: number) => void
  maxPostsPerChannelMode: MaxPostsPerChannelMode
  setMaxPostsPerChannelMode: (value: MaxPostsPerChannelMode) => void
}

/** The per-channel post cap and which posts it keeps. */
export const PostCapControl: React.FC<PostCapControlProps> = ({
  maxPostsPerChannel,
  setMaxPostsPerChannel,
  maxPostsPerChannelMode,
  setMaxPostsPerChannelMode,
}) => (
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
)
