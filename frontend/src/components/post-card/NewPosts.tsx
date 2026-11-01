/**
 * Held new Posts (RCH-01): a refetch that brings Posts in above what the
 * reader has seen holds them behind the "new posts" pill (`holdNewPosts`), so
 * the Post being read never moves; a click, or `.`, shows them.
 */
import { ArrowUp } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { LIST_KEYS } from "@/lib/keyboard/key-list"
import { useKeyboardMode } from "@/lib/keyboard/mode"
import { holdNewPosts } from "@/lib/posts/new-posts"
import type { Post } from "@/types"
import { ChannelAvatar } from "../ChannelAvatar"
import { usePreviewWorkspace } from "../PostPreview"
import { cardOf, postCardKey } from "./FeedKeyboard"

/**
 * The feed split into the Posts it shows and those it holds. `feedKey` names
 * the list: when it changes, what loads is another list, not news, so what
 * counts as seen starts again.
 */
export function useHeldPosts(posts: Post[], feedKey: string) {
  const seen = useRef({ feedKey, keys: new Set<string>() })
  if (seen.current.feedKey !== feedKey)
    seen.current = { feedKey, keys: new Set() }
  const { shown, held } = holdNewPosts<Post>(
    posts,
    seen.current.keys,
    postCardKey,
  )
  // Every render: what it showed is seen from now on.
  useEffect(() => {
    for (const post of shown) seen.current.keys.add(postCardKey(post))
  })

  // A new object per show, so showing the same key again still scrolls.
  const [scrollTo, setScrollTo] = useState<{ key: string } | null>(null)
  useEffect(() => {
    if (scrollTo)
      cardOf(scrollTo.key)?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      })
  }, [scrollTo])

  /** Shows the held Posts: the first one's key, or null with none held. */
  const showHeld = () => {
    if (!held.length) return null
    for (const post of held) seen.current.keys.add(postCardKey(post))
    const first = postCardKey(held[0])
    setScrollTo({ key: first })
    return first
  }
  return { shown, held, showHeld }
}

/** The pill over the feed while Posts are held, with up to three Channels' avatars. */
export function NewPostsPill({
  held,
  onShow,
}: {
  held: Post[]
  onShow: () => void
}) {
  const { channel } = usePreviewWorkspace()
  const keyboard = useKeyboardMode()
  if (!held.length) return null
  const faces = [...new Set(held.map((p) => p.channelName.toLowerCase()))]
    .map(channel)
    .filter((c) => c !== undefined)
    .slice(0, 3)
  return (
    <button
      type="button"
      onClick={onShow}
      title={keyboard ? `Show the new Posts (${LIST_KEYS.showNew})` : undefined}
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
