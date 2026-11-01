/**
 * The "new posts" pill: a sync or a Live minute that brings Posts in above
 * the reader holds them back (`holdNewPosts`), so the Post being read stays
 * where it is; a click shows them and scrolls to the first.
 */
import { ArrowUp } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useData } from "@/contexts/DataContext"
import { useKeyboardMode } from "@/lib/keyboard/mode"
import { holdNewPosts } from "@/lib/posts/new-posts"
import type { Post } from "@/types"
import { ChannelAvatar } from "../ChannelAvatar"
import { cardOf, postCardKey } from "./FeedKeyboard"

/**
 * The feed with new Posts held back. `feedKey` names the list: when it
 * changes (a filter, a sort, a window), what loads is a new list, not news.
 */
export function useHeldPosts(posts: Post[], feedKey: string) {
  const seen = useRef({ feedKey, keys: new Set<string>() })
  if (seen.current.feedKey !== feedKey)
    seen.current = { feedKey, keys: new Set() }
  const [shownAt, setShownAt] = useState(0)
  // `seen` is read fresh: `feedKey` and `shownAt` say when it changed.
  const split = useMemo(
    () => holdNewPosts<Post>(posts, seen.current.keys, postCardKey),
    [posts, feedKey, shownAt],
  )
  useEffect(() => {
    for (const post of split.shown) seen.current.keys.add(postCardKey(post))
  }, [split])

  const [scrollTo, setScrollTo] = useState<string | null>(null)
  useEffect(() => {
    if (scrollTo)
      cardOf(scrollTo)?.scrollIntoView({ block: "start", behavior: "smooth" })
  }, [scrollTo])

  /** Shows the held Posts; the first one's key, or null with none held. */
  const showHeld = () => {
    if (!split.held.length) return null
    for (const post of split.held) seen.current.keys.add(postCardKey(post))
    const first = postCardKey(split.held[0])
    setShownAt((n) => n + 1)
    setScrollTo(first)
    return first
  }
  return { shown: split.shown, held: split.held, showHeld }
}

/** Sticks to the top of the feed while Posts are held. */
export function NewPostsPill({
  held,
  onShow,
}: {
  held: Post[]
  onShow: () => void
}) {
  const { channels } = useData()
  const keyboard = useKeyboardMode()
  if (!held.length) return null
  const faces = [...new Set(held.map((p) => p.channelName.toLowerCase()))]
    .map((name) => channels.find((c) => c.name.toLowerCase() === name))
    .filter((c) => c !== undefined)
    .slice(0, 3)
  return (
    <button
      type="button"
      onClick={onShow}
      title={keyboard ? "Show them (.)" : undefined}
      className="flex items-center gap-2 rounded-full bg-blue-600 py-1.5 pr-4 pl-2 text-[13px] font-medium text-white shadow-lg hover:bg-blue-700"
    >
      <ArrowUp size={14} />
      {faces.length > 0 && (
        <span className="flex -space-x-2">
          {faces.map((channel) => (
            <ChannelAvatar
              key={channel.id}
              channel={channel}
              className="size-6 border-2 border-blue-600"
              textClassName="text-[10px]"
            />
          ))}
        </span>
      )}
      {held.length.toLocaleString()} new {held.length === 1 ? "post" : "posts"}
    </button>
  )
}
