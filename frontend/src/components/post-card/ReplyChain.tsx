/**
 * The Reply chain panel (RCH-02): a reply's whole chain, read in one request,
 * the oldest Post at the top and the Post it started from at the bottom.
 * While it is open Keyboard mode moves through it as its own list ("chain"),
 * the feed marks where the highlighted Post and the starting Post sit, and
 * `p` steps through the chain's photos alone. Its cards are the feed's own.
 */
import { useQuery } from "@tanstack/react-query"
import { Loader2, X } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"
import { usePostsViewEdits } from "@/contexts/PostsViewContext"
import { lastHighlight } from "@/lib/keyboard/mode"
import { pick } from "@/lib/posts/post-selection"
import { chainQuery, type PostsView } from "@/lib/posts/posts-view"
import { cn } from "@/lib/utils"
import type { Post } from "@/types"
import { PostCard } from "../PostCard"
import { usePreviewWorkspace } from "../PostPreview"
import { postCardKey } from "./FeedKeyboard"
import { FeedPagingContext, GALLERY_ATTR } from "./PhotoViewer"
import { postTime, replyParentRef, replyParentUrl } from "./post-card-model"
import { ReplyParentCard } from "./ReplyParent"

const PANEL = 'aside[aria-label="Reply chain"]'
/** Room under the panel's sticky header. */
const HEADER_PX = 56

const say = (why: string) => toast(why, { id: "reply-chain" })

/** The excerpt card above a top Post whose parent is not stored. */
const excerptKey = (top: Post) => `unstored-${postCardKey(top)}`

/** The panel item a reply's parent is: its card, or the excerpt above it. */
export function parentKey(reply: Post): string {
  const ref = replyParentRef(reply)
  return ref
    ? postCardKey({ channelName: ref.channelName, id: ref.postId })
    : excerptKey(reply)
}

/** A Post in the feed that holds a reply: its own, or its Album's (ADR-046). */
const mayReply = (post: Post) =>
  post.replyToPostId != null ||
  (post.albumId != null && post.albumId !== post.id)

/** The feed's card for `key`, never the panel's copy of it. */
const feedCardOf = (key: string) =>
  Array.from(
    document.querySelectorAll<HTMLElement>(
      `article[data-post-key="${CSS.escape(key)}"]`,
    ),
  ).find((el) => !el.closest(PANEL)) ?? null

/** The panel's item for `key`, which Keyboard mode moves to. */
export const panelItem = (key: string) =>
  document.querySelector<HTMLElement>(
    `${PANEL} > [data-chain-key="${CSS.escape(key)}"]`,
  )

/**
 * The panel card held still on screen, and where: the highlighted card when
 * the chain opens, then whatever a move or a reply link brought into view, or
 * the top card after a finger or wheel scroll. Its screen position, so a
 * chain too short to scroll yet catches up once it can.
 * ponytail: module state, one panel at a time.
 */
let held: { key: string; at: number } | null = null
const hold = (el: HTMLElement) => {
  const key = el.dataset.chainKey
  const panel = el.parentElement
  if (key && panel) held = { key, at: el.offsetTop - panel.scrollTop }
}

/** Brings a panel item into view inside the panel alone, and holds it there. */
export function revealInPanel(el: HTMLElement | null) {
  const panel = el?.parentElement
  if (!el || !panel) return
  const top = el.offsetTop - HEADER_PX
  const bottom = el.offsetTop + el.offsetHeight - panel.clientHeight + 12
  // Instant: a smooth scroll is cut short by the holding whenever a card above
  // changes height (a photo loading), and stops off target.
  if (panel.scrollTop > top) panel.scrollTop = top
  else if (panel.scrollTop < bottom) panel.scrollTop = Math.min(top, bottom)
  hold(el)
}

/** The chain's items, top to bottom: an excerpt card first when the parent of the top is not stored. */
function chainItems(
  posts: Post[],
  stop: string,
): { key: string; post: Post; excerpt: boolean }[] {
  const down = [...posts].reverse()
  const top = down[0]
  const unstored = stop === "parentNotStored" || stop === "privateParent"
  return [
    ...(unstored ? [{ key: excerptKey(top), post: top, excerpt: true }] : []),
    ...down.map((post) => ({ key: postCardKey(post), post, excerpt: false })),
  ]
}

/**
 * The open chain: the Post it started from, under the feed's list. A new list
 * (a filter, sort, spotlight or window change) closes it; a refetch of the
 * same list does not.
 */
export function useReplyChain(view: PostsView, feedKey: string) {
  const [opened, setOpened] = useState<{
    origin: Post
    feedKey: string
  } | null>(null)
  // Mouse and touch have no Highlight: the ring the panel shows without one.
  const [ring, setRing] = useState<string | null>(null)
  if (opened && opened.feedKey !== feedKey) setOpened(null)
  const origin = opened?.feedKey === feedKey ? opened.origin : null
  const query = useQuery({
    ...chainQuery(view, origin ?? { channelName: "", id: 0 }),
    enabled: origin !== null,
  })
  const data = origin ? query.data : undefined
  const items = data ? chainItems(data.posts, data.stop) : null

  const close = () => {
    if (origin) lastHighlight.set("posts", postCardKey(origin))
    setOpened(null)
  }
  // Nothing to show: say why and close.
  const lone = data?.posts.length === 1 && data.stop === "notReply"
  const failed = origin !== null && query.isError
  useEffect(() => {
    if (lone) say("That post is not a reply")
    if (failed) say("Could not read the reply chain")
    if (lone || failed) setOpened(null)
  }, [lone, failed])

  // The starting Post's feed card, dotted (index.css).
  const originKey = origin && postCardKey(origin)
  useEffect(() => {
    const card = originKey ? feedCardOf(originKey) : null
    card?.setAttribute("data-chain-origin", "")
    return () => card?.removeAttribute("data-chain-origin")
  }, [originKey])

  /**
   * Opens `reply`'s chain, or inside the open one moves to its parent there.
   * The item the Highlight goes to, and whether the panel was open already.
   */
  const open = (reply: Post): { key: string; within: boolean } | null => {
    if (!mayReply(reply)) {
      say("That post is not a reply")
      return null
    }
    const key = parentKey(reply)
    const within =
      items?.some((i) => i.key === postCardKey(reply)) &&
      items.some((i) => i.key === key)
    setRing(key)
    if (within) return { key, within: true }
    held = null
    if (!origin) lastHighlight.set("chain", key)
    setOpened({ origin: reply, feedKey })
    return { key, within: origin !== null }
  }

  return {
    origin,
    items,
    keys: items?.map((item) => item.key) ?? null,
    loading: origin !== null && !data,
    ring,
    open,
    close,
  }
}

/**
 * Where the ring is: in the panel while it is open, on the Highlight or, with
 * none, on the Post the reply answers; in the feed otherwise.
 */
export function chainRings(
  chain: { origin: Post | null; ring: string | null },
  highlight: string | null,
): { feed: string | null; panel: string | null } {
  if (!chain.origin) return { feed: highlight, panel: null }
  return { feed: null, panel: highlight ?? chain.ring }
}

/** The feed's copy of the highlighted chain Post: scrolled to and dashed (index.css). */
export function useChainMark(feedKeys: readonly string[], key: string | null) {
  const inFeed = key && feedKeys.includes(key) ? key : null
  useEffect(() => {
    const card = inFeed ? feedCardOf(inFeed) : null
    card?.setAttribute("data-chain-marked", "")
    card?.scrollIntoView({ block: "center", behavior: "smooth" })
    return () => card?.removeAttribute("data-chain-marked")
  }, [inFeed])
}

/** Holds the ringed card, when nothing is held yet. */
function holdRing(box: HTMLElement) {
  const ring = box.querySelector<HTMLElement>(":scope > [data-highlight]")
  if (ring) hold(ring)
}

/** Puts the held card back where it was on screen; writes only on a real shift. */
function restore(box: HTMLElement, { key, at }: { key: string; at: number }) {
  const el = box.querySelector<HTMLElement>(
    `:scope > [data-chain-key="${CSS.escape(key)}"]`,
  )
  const want = el ? el.offsetTop - at : null
  if (want != null && Math.abs(want - box.scrollTop) > 1) box.scrollTop = want
}

/**
 * Holds the held card at its place on screen while cards above it load. Sizes
 * change on a resize, a card's own render and a photo load; the last two are
 * watched directly too, since a page in the background renders no frames and
 * so reports no resize. Only real input counts as the reader's scroll: a
 * scroll event of the panel's own write can arrive late.
 */
function useHoldStill(panel: React.RefObject<HTMLElement | null>, on: boolean) {
  useLayoutEffect(() => {
    const box = panel.current
    if (!box || !on) return
    let touchedAt = Number.NEGATIVE_INFINITY
    const keep = () => (held ? restore(box, held) : holdRing(box))
    const touched = () => {
      touchedAt = performance.now()
    }
    const scrolled = () => {
      if (performance.now() - touchedAt > 1000) return
      const top = Array.from(box.children).find(
        (c): c is HTMLElement =>
          c instanceof HTMLElement &&
          !!c.dataset.chainKey &&
          c.offsetTop + c.offsetHeight > box.scrollTop + HEADER_PX,
      )
      if (top) hold(top)
    }
    keep()
    const resized = new ResizeObserver(keep)
    for (const child of Array.from(box.children)) resized.observe(child)
    const changed = new MutationObserver(keep)
    changed.observe(box, { childList: true, subtree: true })
    box.addEventListener("load", keep, true)
    const input = ["wheel", "touchmove", "pointerdown"] as const
    for (const kind of input)
      box.addEventListener(kind, touched, { passive: true })
    box.addEventListener("scroll", scrolled, { passive: true })
    return () => {
      resized.disconnect()
      changed.disconnect()
      box.removeEventListener("load", keep, true)
      for (const kind of input) box.removeEventListener(kind, touched)
      box.removeEventListener("scroll", scrolled)
    }
  })
}

/** A chain Post as the feed draws it; the Pick box only inside the window. */
function ChainCard({ post, view }: { post: Post; view: PostsView }) {
  const { appendSelection } = usePostsViewEdits()
  const at = postTime(post)
  const inWindow = at >= view.startDate && at <= view.endDate
  return (
    <PostCard
      post={inWindow ? post : { ...post, selected: undefined }}
      postSearch=""
      onToggleSelected={(p) => appendSelection([pick(!p.selected, p)])}
    />
  )
}

function Excerpt({ reply }: { reply: Post }) {
  const workspace = usePreviewWorkspace()
  return (
    <div className="rounded-2xl border border-app-ink/10 bg-app-card">
      <ReplyParentCard
        reply={reply}
        parent={null}
        loading={false}
        href={replyParentUrl(reply, reply.replyToPostId ?? 0)}
        workspace={workspace}
      />
    </div>
  )
}

export function ReplyChainPanel({
  chain,
  view,
  highlight,
  dim,
}: {
  chain: ReturnType<typeof useReplyChain>
  view: PostsView
  /** The item the ring is on: the Highlight, or the reply's parent without one. */
  highlight: string | null
  /** Mute the other cards: only where keys move the Highlight. */
  dim: boolean
}) {
  const panel = useRef<HTMLElement>(null)
  useHoldStill(panel, chain.items !== null)
  if (!chain.origin) return null
  return createPortal(
    // Its own gallery, and no feed paging: p steps through the chain's
    // photos alone. A portal: an animated ancestor's transform would make
    // `fixed` relative to the feed, not the screen.
    <FeedPagingContext.Provider value={null}>
      <aside
        ref={panel}
        aria-label="Reply chain"
        {...{ [GALLERY_ATTR]: "chain" }}
        className="fixed inset-0 z-40 flex flex-col gap-3 overflow-y-auto overscroll-contain bg-app-bg p-3 [overflow-anchor:none] md:left-auto md:w-[28rem] md:border-l md:border-app-ink/10 md:shadow-xl"
      >
        <header className="sticky -top-3 z-10 -mx-3 -mt-3 flex items-center gap-2 border-b border-app-ink/10 bg-app-bg px-3 py-2 text-[12px] text-app-ink/60">
          <span className="font-semibold text-app-ink">Reply chain</span>
          <span className="hidden md:inline">j / k move · ] closes</span>
          <button
            type="button"
            onClick={chain.close}
            aria-label="Close the reply chain"
            // A thumb needs more than the icon.
            className="-m-1 ml-auto rounded p-2.5 hover:bg-app-ink/10"
          >
            <X size={16} />
          </button>
        </header>
        {chain.loading && (
          <p className="flex items-center gap-2 px-1 text-[12px] text-app-ink/50">
            <Loader2 size={12} className="animate-spin" /> Reading the chain
          </p>
        )}
        {(chain.items ?? []).map(({ key, post, excerpt }) => {
          const on = key === highlight
          return (
            <div
              key={key}
              data-chain-key={key}
              data-highlight={on || undefined}
              className={cn("rounded-2xl", !on && dim && "opacity-70")}
            >
              {excerpt ? (
                <Excerpt reply={post} />
              ) : (
                <ChainCard post={post} view={view} />
              )}
            </div>
          )
        })}
      </aside>
    </FeedPagingContext.Provider>,
    document.body,
  )
}
