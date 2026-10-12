/**
 * PROTOTYPE (posts-tab-improvements): Posts tab variants on `?variant=`.
 *
 * "0" is main exactly; "A" carries the five changes (fill-the-row compact
 * cards, the photo viewer paging the feed, the window histogram, the Channel
 * posts bound, the reply Types). Throwaway: fold the winner in, delete this.
 */
import { useNavigate, useSearch } from "@tanstack/react-router"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { createContext, useContext, useEffect } from "react"
import type { ChannelSpotlight } from "@/lib/posts/channel-spotlight"

export const POSTS_VARIANTS = [
  { key: "0", name: "Current" },
  { key: "A", name: "Five changes" },
] as const

export type PostsVariant = (typeof POSTS_VARIANTS)[number]["key"]

export const PostsVariantContext = createContext<PostsVariant>("0")
export const usePostsVariant = () => useContext(PostsVariantContext)
export const useIsVariantA = () => usePostsVariant() === "A"

/** The feed's paging, for the photo viewer to ask for more (variant A). */
export const FeedPagingContext = createContext<{
  loadMore: () => void
  hasMore: boolean
  postCount: number
  spotlight: ChannelSpotlight | null
} | null>(null)

export function useVariantFromUrl(): PostsVariant {
  const { variant } = useSearch({ strict: false }) as { variant?: string }
  return POSTS_VARIANTS.find((v) => v.key === variant)?.key ?? "0"
}

export function PrototypeSwitcher() {
  const current = useVariantFromUrl()
  const navigate = useNavigate()
  const at = POSTS_VARIANTS.findIndex((v) => v.key === current)
  const go = (d: number) => {
    const next =
      POSTS_VARIANTS[(at + d + POSTS_VARIANTS.length) % POSTS_VARIANTS.length]
    navigate({
      to: ".",
      search: ((prev: Record<string, unknown>) => ({
        ...prev,
        variant: next.key,
      })) as never,
      replace: true,
    })
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (
        el?.closest(
          "input, textarea, [contenteditable=''], [contenteditable='true']",
        )
      )
        return
      if (!e.altKey) return
      if (e.key === "ArrowLeft") go(-1)
      if (e.key === "ArrowRight") go(1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })
  if (!import.meta.env.DEV) return null
  const v = POSTS_VARIANTS[at]
  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-full bg-black px-2 py-1.5 font-mono text-xs text-white shadow-2xl ring-2 ring-fuchsia-500">
      <button
        type="button"
        aria-label="Previous variant"
        onClick={() => go(-1)}
        className="rounded-full p-1 hover:bg-white/20"
      >
        <ChevronLeft size={16} />
      </button>
      <span title="Alt+← / Alt+→">
        {v.key} ({v.name})
      </span>
      <button
        type="button"
        aria-label="Next variant"
        onClick={() => go(1)}
        className="rounded-full p-1 hover:bg-white/20"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  )
}
