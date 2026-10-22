/**
 * The Channel spotlight's state, banner and way back (PTR-04). The model is
 * `lib/posts/channel-spotlight.ts`; this is where it meets the scroll
 * position and the keyboard.
 */
import { ArrowLeft } from "lucide-react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { focusIsTyping } from "@/lib/keyboard/focus"
import {
  type ChannelSpotlight,
  enterSpotlight,
  keepSpotlightFilters,
} from "@/lib/posts/channel-spotlight"
import type { PostFilter } from "@/lib/posts/post-filter"
import { telegramWebViewChannelUrl } from "@/lib/telegram-web"
import type { Channel, Post } from "@/types"
import { ChannelAvatar } from "../ChannelAvatar"
import { postCardKey } from "./FeedKeyboard"

export interface SpotlightApi {
  spotlight: ChannelSpotlight | null
  /**
   * From a card: leaving scrolls back to it. Absent outside the Posts feed,
   * where there is no spotlight to open, as `enterChannel` is.
   */
  enter?: (post: Post, channel: string) => void
  /** From outside Posts (the Channels tab's c): nothing to scroll back to. */
  enterChannel?: (channel: string) => void
  leave: () => void
  setKeepFilters: (keep: boolean) => void
  /** An edit to the filter row while the spotlight is on. */
  setFilter: (filter: PostFilter) => void
}

const SpotlightContext = createContext<SpotlightApi>({
  spotlight: null,
  leave: () => {},
  setKeepFilters: () => {},
  setFilter: () => {},
})

export const SpotlightProvider = SpotlightContext.Provider

/**
 * A spotlight asked for from outside Posts (the Channels tab's c), for the
 * feed to open once when it mounts. Only one tab is mounted at a time, so the
 * request waits here rather than in either tab.
 */
let requested: string | null = null
export const requestSpotlight = (channel: string) => {
  requested = channel
}
export function takeSpotlightRequest(): string | null {
  const channel = requested
  requested = null
  return channel
}
export const useSpotlight = () => useContext(SpotlightContext)

/**
 * The spotlight for the feed in `scrollContainer`. A meaning search or a
 * related search (`searching`) leaves it, so a spotlight never narrows one.
 */
export function useSpotlightState(
  scrollContainer: React.RefObject<HTMLDivElement | null>,
  accountFilter: PostFilter,
  searching: boolean,
): SpotlightApi {
  const [spotlight, setSpotlight] = useState<ChannelSpotlight | null>(null)
  // Where the feed was, read once the full feed renders again.
  const origin = useRef<{ key: string; top: number } | null>(null)
  const filterRef = useRef(accountFilter)
  filterRef.current = accountFilter

  // `from` is the card's key, or "" with no card to return to.
  const open = useCallback(
    (channel: string, from: string) => {
      setSpotlight((current) =>
        enterSpotlight(current, channel, from, filterRef.current),
      )
      scrollContainer.current?.scrollTo({ top: 0 })
    },
    [scrollContainer],
  )
  const enter = useCallback(
    (post: Post, channel: string) => {
      const from = postCardKey(post)
      origin.current ??= {
        key: from,
        top: scrollContainer.current?.scrollTop ?? 0,
      }
      open(channel, from)
    },
    [open, scrollContainer],
  )
  const enterChannel = useCallback(
    (channel: string) => open(channel, ""),
    [open],
  )
  const leave = useCallback(() => setSpotlight(null), [])
  const setKeepFilters = useCallback(
    (keep: boolean) =>
      setSpotlight(
        (current) =>
          current && keepSpotlightFilters(current, keep, filterRef.current),
      ),
    [],
  )
  const setFilter = useCallback(
    (filter: PostFilter) =>
      setSpotlight((current) => current && { ...current, filter }),
    [],
  )

  useEffect(() => {
    if (searching && spotlight) {
      // A search's results start at the top, so there is no card to return to.
      origin.current = null
      setSpotlight(null)
    }
  }, [searching, spotlight])

  // Back to the card the spotlight started from, or the scroll position if
  // that card is gone, once the full feed has rendered.
  // ponytail: one frame, so it relies on the feed's pages still being in the
  // query cache; wait for the refetch if a long spotlight lands at the top.
  useEffect(() => {
    if (spotlight || !origin.current) return
    const { key, top } = origin.current
    origin.current = null
    requestAnimationFrame(() => {
      const card = document.querySelector(
        `[data-post-key="${CSS.escape(key)}"]`,
      )
      if (card) card.scrollIntoView({ block: "center" })
      else scrollContainer.current?.scrollTo({ top })
    })
  }, [spotlight, scrollContainer])

  return useMemo(
    () => ({
      spotlight,
      enter,
      enterChannel,
      leave,
      setKeepFilters,
      setFilter,
    }),
    [spotlight, enter, enterChannel, leave, setKeepFilters, setFilter],
  )
}

/**
 * Opens the spotlight the Channels tab asked for (`requestSpotlight`), once,
 * when the feed mounts. Returns keyboard mode's c inside a spotlight: back to
 * Channels for one opened there, back to the feed otherwise.
 */
export function useSpotlightBack(
  api: SpotlightApi,
  toChannels: () => void,
): () => void {
  const { spotlight, enterChannel, leave } = api
  const fromChannels = useRef(false)
  // Once, on mount: `enterChannel` is stable.
  useEffect(() => {
    const channel = takeSpotlightRequest()
    if (!channel || !enterChannel) return
    fromChannels.current = true
    enterChannel(channel)
  }, [])
  // Left by any way (Esc, its button, a search): no longer Channels'.
  const wasOn = useRef(false)
  useEffect(() => {
    if (spotlight) wasOn.current = true
    else if (wasOn.current) {
      wasOn.current = false
      fromChannels.current = false
    }
  }, [spotlight])
  return () => {
    const back = fromChannels.current
    leave()
    if (back) toChannels()
  }
}

/** Escape belongs to whatever is open over the feed, or to a field being typed in. */
function escapeBelongsElsewhere(e: KeyboardEvent): boolean {
  // A dialog that closed on this key has already claimed it.
  if (e.defaultPrevented || focusIsTyping()) return true
  return document.querySelector('[role="dialog"]') !== null
}

/**
 * The sticky line over a spotlight: the Channel, whether it shows everything
 * or keeps the filters, and the way back. Escape is the way back too.
 */
export function SpotlightBanner({
  name,
  channel,
  keepFilters,
  onKeepFiltersChange,
  onBack,
}: {
  name: string
  /** The followed Channel, for its avatar and title. */
  channel: Channel | undefined
  keepFilters: boolean
  onKeepFiltersChange: (keep: boolean) => void
  onBack: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !escapeBelongsElsewhere(e)) onBack()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onBack])

  return (
    <div
      data-testid="channel-spotlight"
      className="sticky top-0 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-blue-500/30 bg-app-card/95 px-4 py-3 shadow-md backdrop-blur-md"
    >
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 rounded-full bg-app-ink/5 px-3 py-1.5 text-[12px] font-medium hover:bg-app-ink/10"
      >
        <ArrowLeft size={14} /> Back to feed
        <kbd className="ml-1 rounded border border-app-ink/15 px-1 font-mono text-[10px] text-app-ink/50">
          Esc
        </kbd>
      </button>
      <div className="flex min-w-0 items-center gap-2">
        {channel && (
          <ChannelAvatar
            channel={channel}
            className="h-6 w-6 shrink-0"
            textClassName="text-[10px]"
          />
        )}
        <span className="truncate text-[13px]">
          Only{" "}
          <a
            href={telegramWebViewChannelUrl(name)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold hover:underline"
          >
            {channel?.displayName || `@${name}`}
          </a>
          <span className="text-app-ink/50">
            {" · "}
            {keepFilters ? "with your filters" : "every post in this window"}
          </span>
        </span>
      </div>
      <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-[12px] text-app-ink/70">
        <input
          type="checkbox"
          checked={keepFilters}
          onChange={(e) => onKeepFiltersChange(e.target.checked)}
        />
        Keep my filters
      </label>
    </div>
  )
}
