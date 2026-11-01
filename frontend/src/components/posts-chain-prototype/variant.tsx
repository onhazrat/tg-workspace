/**
 * PROTOTYPE (posts-reply-chain): Posts tab variants on `?variant=`.
 *
 * Question: how does a mouse (or a phone) open a reply chain? Every variant
 * but 0 carries the session's work (the [ / ] chain, the new-posts pill and
 * its `.` key, the layout-shaped skeleton) and differs only in that.
 *
 * - 0 Current: main exactly.
 * - A Link opens panel: [ jumps in the feed when the parent is there, else
 *   opens the side panel; a click on "Reply to #N" opens the panel.
 * - A2 Panel always: [ always opens the panel, with the Post it was pressed
 *   on at the bottom; the panel's newest Post, when the feed has it, is
 *   scrolled to and outlined there while the panel stays.
 * - A3 Panel list: [ opens the whole chain in the panel and ] closes it;
 *   inside, j / k / gg / G move the Highlight and every key follows it.
 *
 * Throwaway: fold the winner in, delete this folder.
 */
import { useNavigate } from "@tanstack/react-router"
import { ChevronLeft, ChevronRight } from "lucide-react"
import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react"
import { Skeleton } from "@/components/ui/skeleton"
import type { Row } from "@/lib/keyboard/key-list"
import type { Post } from "@/types"

export const VARIANTS = [
  { key: "0", name: "Current" },
  { key: "A", name: "Link opens panel" },
  { key: "A2", name: "Panel always" },
  { key: "A3", name: "Panel list" },
] as const
export type Variant = (typeof VARIANTS)[number]["key"]

const fromUrl = (): Variant => {
  const v = new URLSearchParams(globalThis.location?.search).get("variant")
  return VARIANTS.find((x) => x.key === v)?.key ?? "0"
}
// A module variable, so main's tests (no router) read "0" for free.
let current: Variant = fromUrl()
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
export const useVariant = () => useSyncExternalStore(subscribe, () => current)

/** Each variant's own keys in the Posts feed, for the corner list. */
export const VARIANT_ROWS: Record<Variant, readonly Row[]> = {
  "0": [],
  A: [
    ["[ / ]", "the post it replies to / back"],
    [".", "show new posts"],
  ],
  A2: [
    ["[ / ]", "one level up / back"],
    ["{ / }", "the top of the chain / back to the start"],
    [".", "show new posts"],
  ],
  A3: [
    ["[", "open the reply chain"],
    [".", "show new posts"],
  ],
}

/** What a reply link needs outside variant 0: open the chain from a Post. */
export const ChainOpenContext = createContext<{
  open: (reply: Post) => void
} | null>(null)
export const useChainOpen = () => useContext(ChainOpenContext)

export function PrototypeSwitcher() {
  const variant = useVariant()
  const navigate = useNavigate()
  const at = VARIANTS.findIndex((v) => v.key === variant)
  const go = (d: number) => {
    const next = VARIANTS[(at + d + VARIANTS.length) % VARIANTS.length].key
    current = next
    for (const l of listeners) l()
    navigate({
      to: ".",
      search: ((prev: Record<string, unknown>) => ({
        ...prev,
        variant: next,
      })) as never,
      replace: true,
    })
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return
      if (e.key === "ArrowLeft") go(-1)
      if (e.key === "ArrowRight") go(1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })
  if (!import.meta.env.DEV) return null
  const v = VARIANTS[at]
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

/** Main's skeleton, unchanged, for variant 0. */
export function MainSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={`post-skeleton-${index}`}
          className="rounded-xl border border-app-ink/10 bg-app-card p-5"
        >
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-full bg-app-ink/10" />
              <div className="space-y-2">
                <Skeleton className="h-3 w-28 bg-app-ink/10" />
                <Skeleton className="h-3 w-20 bg-app-ink/10" />
              </div>
            </div>
            <Skeleton className="h-6 w-20 rounded-full bg-app-ink/10" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-full bg-app-ink/10" />
            <Skeleton className="h-3 w-[92%] bg-app-ink/10" />
            <Skeleton className="h-3 w-[85%] bg-app-ink/10" />
            <Skeleton className="h-3 w-[70%] bg-app-ink/10" />
          </div>
        </div>
      ))}
    </div>
  )
}
