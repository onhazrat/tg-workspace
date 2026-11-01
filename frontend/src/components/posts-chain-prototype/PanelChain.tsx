/**
 * PROTOTYPE (posts-reply-chain), variant A2: the panel is the chain's only
 * home. The first [ puts the Post it was pressed on at the bottom and its
 * parent above it; each [ adds one level, ] removes one, and ] on the first
 * Post closes the panel. { climbs to the top of the chain in one press, and
 * } comes back to the first Post (or closes the panel from there). The
 * newest Post is highlighted in the panel and, when the feed has it,
 * scrolled to and outlined there. Panel cards are the feed's own cards, so
 * every key the Highlight takes works on them.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { X } from "lucide-react"
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"
import { queryKeys } from "@/hooks/queryKeys"
import { LIST_KEYS } from "@/lib/keyboard/key-list"
import { lastHighlight } from "@/lib/keyboard/mode"
import { getPost } from "@/lib/posts/store"
import type { Post } from "@/types"
import { usePreviewWorkspace } from "../PostPreview"
import { cardOf, postCardKey } from "../post-card/FeedKeyboard"
import { FeedPagingContext, GALLERY_ATTR } from "../post-card/PhotoViewer"
import { replyParentRef, replyParentUrl } from "../post-card/post-card-model"
import { cachedParent } from "../post-card/ReplyChain"
import { ReplyParentCard } from "../post-card/ReplyParent"

/** The panel's highlighted card, whose controls the keys press. */
export const panelCard = () =>
  document.querySelector<HTMLElement>(
    'aside[aria-label="Reply chain"] > [data-highlight]',
  )

/** The Post `[` was pressed on, and each reply whose parent is shown. */
interface Chain {
  origin: Post
  steps: Post[]
}

const refuse = (why: string) => toast(why, { id: "reply-chain" })

/** A reply's parent, as the panel reads it: the hover preview's cache key. */
const parentQuery = (reply: Post) => {
  const ref = replyParentRef(reply)
  return {
    queryKey: queryKeys.replyParent(ref?.channelName ?? "", ref?.postId ?? 0),
    queryFn: async () =>
      ref ? ((await getPost(ref.channelName, ref.postId)) ?? null) : null,
    enabled: ref != null,
    retry: false,
    staleTime: 60_000,
  }
}

/** A step's parent's key, known before its lookup ends. */
export const parentKey = (step: Post) => {
  const ref = replyParentRef(step)
  return ref
    ? postCardKey({ channelName: ref.channelName, id: ref.postId })
    : `unstored-${postCardKey(step)}`
}

/** The panel's Posts' keys, top (oldest) to bottom (the first Post). */
export const chainKeys = (chain: Chain) => [
  ...[...chain.steps].reverse().map(parentKey),
  postCardKey(chain.origin),
]

/** A3: the panel's card for `key`, which keyboard mode moves to. */
export const panelItem = (key: string) =>
  document.querySelector<HTMLElement>(
    `aside[aria-label="Reply chain"] > [data-chain-key="${CSS.escape(key)}"]`,
  )

/** A3: brings a panel card into view inside the panel alone. */
export function revealInPanel(el: HTMLElement | null) {
  const panel = el?.parentElement
  if (!el || !panel) return
  const top = el.offsetTop - 56
  const bottom = el.offsetTop + el.offsetHeight - panel.clientHeight + 12
  // Instant: a smooth scroll is cut short by the anchoring below whenever a
  // card above it changes height (a photo loading), and stops off target.
  if (panel.scrollTop > top) writeScroll(panel, top)
  else if (panel.scrollTop < bottom) writeScroll(panel, Math.min(top, bottom))
  holdCard(el)
}

/**
 * The panel card held still on screen, and where: the ring's card when the
 * chain opens, then whatever was last brought into view (a key's move, a tap
 * on a reply link) or, after a finger scroll, the top card. Loading cards
 * and photos above it then never move it. Its screen position, not its
 * offset, so a chain too short to scroll yet catches up once it can.
 * ponytail: module state, one panel at a time.
 */
let held: { key: string; at: number } | null = null
/** When the reader last touched or wheeled the panel; outlives a render. */
let touchedAt = Number.NEGATIVE_INFINITY
const writeScroll = (panel: HTMLElement, top: number) => {
  panel.scrollTop = top
}
const holdCard = (el: HTMLElement) => {
  const key = el.dataset.chainKey
  if (key) held = { key, at: el.offsetTop - (el.parentElement?.scrollTop ?? 0) }
}
export const releasePanelCard = () => {
  held = null
}

/** The Post a key in the panel stands for, when the feed shows it: scrolled to and dashed. */
export function useChainMark(posts: readonly Post[], want: string | null) {
  const inFeed =
    want &&
    posts.map(postCardKey).find((k) => k.toLowerCase() === want.toLowerCase())
  useEffect(() => {
    if (!inFeed) return
    const card = cardOf(inFeed)
    card?.setAttribute("data-chain-marked", "")
    card?.scrollIntoView({ block: "center", behavior: "smooth" })
    return () => card?.removeAttribute("data-chain-marked")
  }, [inFeed])
}

/** The newest Post's key, known before its lookup ends. */
export function newestKey({ origin, steps }: Chain): string | null {
  const last = steps.at(-1)
  if (!last) return postCardKey(origin)
  const ref = replyParentRef(last)
  return ref
    ? postCardKey({ channelName: ref.channelName, id: ref.postId })
    : null
}

export function usePanelChain(posts: readonly Post[]) {
  const queryClient = useQueryClient()
  const [chain, setChain] = useState<Chain | null>(null)
  // Bumped by every chain change, so a { still climbing stops when overtaken.
  const run = useRef(0)
  const clear = useCallback(() => {
    run.current++
    setChain(null)
  }, [])

  const newest = (c: Chain) =>
    c.steps.length
      ? cachedParent(queryClient, c.steps[c.steps.length - 1])
      : c.origin
  const start = (origin: Post) => {
    if (origin.replyToPostId == null) return refuse("That post is not a reply")
    setChain({ origin, steps: [origin] })
  }
  const climb = (c: Chain) => {
    const from = newest(c)
    if (from === undefined) return refuse("That post is still loading")
    if (from === null) return refuse("That post is not stored")
    if (from.replyToPostId == null) return refuse("That post is not a reply")
    setChain({ ...c, steps: [...c.steps, from] })
  }

  /**
   * {: from the newest Post (or `origin`, with no chain) to the top, one
   * lookup a level; the panel grows with each, so a long chain shows its
   * climb rather than seconds of nothing.
   */
  const climbToTop = async (origin: Post) => {
    const mine = ++run.current
    const fetchParent = (reply: Post) =>
      replyParentRef(reply)
        ? queryClient.fetchQuery(parentQuery(reply))
        : Promise.resolve(null)
    let steps = chain?.origin === origin ? chain.steps : []
    try {
      let from = steps.length
        ? await fetchParent(steps[steps.length - 1])
        : origin
      if (from?.replyToPostId == null)
        return refuse(
          steps.length
            ? "Already at the top of the chain"
            : "That post is not a reply",
        )
      while (from && from.replyToPostId != null && steps.length < 100) {
        if (run.current !== mine) return
        steps = [...steps, from]
        setChain({ origin, steps })
        from = await fetchParent(from)
      }
    } catch {
      refuse("Could not look the next post up")
    }
  }

  const key = (key: string, highlight: string | null) => {
    if (Object.values(LIST_KEYS).includes(key as never)) run.current++
    const feedPost = () => posts.find((p) => postCardKey(p) === highlight)
    if (key === LIST_KEYS.earliest) {
      const origin = chain?.origin ?? feedPost()
      if (!origin) return false
      void climbToTop(origin)
      return true
    }
    if (key === LIST_KEYS.latest) {
      if (!chain) return false
      setChain(chain.steps.length ? { ...chain, steps: [] } : null)
      return true
    }
    if (key === LIST_KEYS.later) {
      if (!chain) return false
      setChain(
        chain.steps.length
          ? { ...chain, steps: chain.steps.slice(0, -1) }
          : null,
      )
      return true
    }
    if (key !== LIST_KEYS.earlier) return false
    if (chain) {
      climb(chain)
      return true
    }
    const origin = feedPost()
    if (!origin) return false
    start(origin)
    return true
  }

  /**
   * A3: [ opens the whole chain from `origin`, the Highlight on its parent
   * (set where the panel's list will look for it), and ] closes it.
   */
  const openWhole = (origin: Post) => {
    if (origin.replyToPostId == null) return refuse("That post is not a reply")
    // A reply link inside the open chain (a tap, on a phone) goes to its
    // parent there rather than starting a shorter chain from it.
    if (chain && chainKeys(chain).includes(parentKey(origin)))
      return revealInPanel(panelItem(parentKey(origin)))
    lastHighlight.set("chain", parentKey(origin))
    releasePanelCard()
    void climbToTop(origin)
  }
  const keyWhole = (key: string, highlight: string | null) => {
    if (key === LIST_KEYS.later) {
      if (!chain) return false
      clear()
      return true
    }
    if (key !== LIST_KEYS.earlier) return false
    if (chain) return true
    const origin = posts.find((p) => postCardKey(p) === highlight)
    if (!origin) return false
    run.current++
    openWhole(origin)
    return true
  }

  /** A reply link: on the panel's newest Post it climbs, elsewhere it starts. */
  const open = (reply: Post) => {
    run.current++
    const top = chain && newest(chain)
    if (chain && top && postCardKey(top) === postCardKey(reply)) climb(chain)
    else start(reply)
  }
  const back = () => {
    run.current++
    setChain(
      chain?.steps.length
        ? { ...chain, steps: chain.steps.slice(0, -1) }
        : null,
    )
  }

  // The Post the chain started from, when the feed shows it: dotted, under
  // the dashed outline whenever it is the newest Post too.
  const originKey = chain && postCardKey(chain.origin)
  useEffect(() => {
    const card = originKey ? cardOf(originKey) : null
    card?.setAttribute("data-chain-origin", "")
    return () => card?.removeAttribute("data-chain-origin")
  }, [originKey])

  return { chain, key, clear, open, back, keyWhole, openWhole }
}

/** One parent in the panel: the feed's card once loaded, else why not. */
function PanelParent({
  reply,
  renderPost,
}: {
  reply: Post
  renderPost: (post: Post) => ReactNode
}) {
  const workspace = usePreviewWorkspace()
  const { data, isPending } = useQuery(parentQuery(reply))
  if (data) return renderPost(data)
  return (
    <ReplyParentCard
      reply={reply}
      parent={null}
      loading={replyParentRef(reply) != null && isPending}
      href={replyParentUrl(reply, reply.replyToPostId ?? 0)}
      workspace={workspace}
    />
  )
}

export function PanelChainView({
  chain,
  onBack,
  onClose,
  renderPost,
  highlight,
  dimOthers = true,
}: {
  chain: Chain | null
  /** A2's Back; A3 has none, its keys move instead. */
  onBack?: () => void
  onClose: () => void
  /** A3: the Highlight, which keyboard mode moves; A2 highlights the top. */
  highlight?: string | null
  /**
   * Mute the cards the Highlight is not on: only where keys move it. With no
   * keyboard (a phone) the ring just marks the Post the reply answers.
   */
  dimOthers?: boolean
  /** A Post as the feed draws it, so the panel's cards take every key. */
  renderPost: (post: Post) => ReactNode
}) {
  const panel = useRef<HTMLElement>(null)
  const depth = chain?.steps.length ?? 0
  const moves = highlight !== undefined
  useEffect(() => {
    if (depth >= 0 && !moves) panel.current?.scrollTo({ top: 0 })
  }, [depth, moves])
  // A3: the held card stays put while the chain loads above it and the
  // cards above grow from "loading" into whole Posts with photos.
  useLayoutEffect(() => {
    const box = panel.current
    if (!box || !moves) return
    const keep = () => {
      if (!held) {
        const ring = box.querySelector<HTMLElement>(":scope > [data-highlight]")
        if (ring) holdCard(ring)
        return
      }
      const el = box.querySelector<HTMLElement>(
        `:scope > [data-chain-key="${CSS.escape(held.key)}"]`,
      )
      const want = el && el.offsetTop - held.at
      if (want != null && Math.abs(want - box.scrollTop) > 1)
        writeScroll(box, want)
    }
    // A finger's (or a wheel's) scroll holds the top card on screen from then
    // on. Only one that follows real input: a scroll event of our own write
    // can arrive late, and taking it for the reader's lost the ring.
    const touched = () => {
      touchedAt = performance.now()
    }
    const scrolled = () => {
      if (performance.now() - touchedAt > 1000) return
      const top = Array.from(box.children).find(
        (c): c is HTMLElement =>
          c instanceof HTMLElement &&
          !!c.dataset.chainKey &&
          c.offsetTop + c.offsetHeight > box.scrollTop + 56,
      )
      if (top) holdCard(top)
    }
    keep()
    // Sizes change three ways: a resize, a card's own render (loading into a
    // whole Post), a photo loading. The last two are watched directly too:
    // a resize is only reported on a rendered frame, which a page in the
    // background never gets.
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
  if (!chain) return null
  // Newest on top, as the thread reads; the first Post at the bottom.
  const items = [
    ...[...chain.steps]
      .reverse()
      .map((from) => (
        <PanelParent
          key={`parent-${postCardKey(from)}`}
          reply={from}
          renderPost={renderPost}
        />
      )),
    <div key={`origin-${postCardKey(chain.origin)}`}>
      {renderPost(chain.origin)}
    </div>,
  ]
  return (
    // Its own gallery, and no feed paging: p in the panel steps through the
    // chain's photos alone, and its last one never loads the feed's next page.
    // A portal: an animated ancestor's transform would make `fixed` relative
    // to the feed, not the screen (on a phone the panel ran 2716px tall).
    createPortal(
      <FeedPagingContext.Provider value={null}>
        <aside
          ref={panel}
          aria-label="Reply chain"
          {...{ [GALLERY_ATTR]: "chain" }}
          className="fixed inset-y-0 right-0 z-40 flex [overflow-anchor:none] w-[min(28rem,100vw)] flex-col gap-3 overflow-y-auto overscroll-contain border-l border-app-ink/10 bg-app-bg p-3 shadow-xl"
        >
          <header className="sticky -top-3 z-10 -mx-3 -mt-3 flex items-center gap-2 border-b border-app-ink/10 bg-app-bg px-3 py-2 text-[12px] text-app-ink/60">
            <span className="font-semibold text-app-ink">Reply chain</span>
            <span className="hidden md:inline">
              {moves
                ? "j / k move · gg / G ends · ] closes"
                : "[ or { up · ] or } back · Esc closes"}
            </span>
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="ml-auto rounded px-2 py-1 hover:bg-app-ink/10"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close the reply chain"
              // p-2: a thumb needs more than the icon.
              className={`-m-1 rounded p-2 hover:bg-app-ink/10 ${onBack ? "" : "ml-auto"}`}
            >
              <X size={14} />
            </button>
          </header>
          {items.map((item, i) => {
            const key = chainKeys(chain)[i]
            const on = moves ? key === highlight : i === 0
            return (
              <div
                key={item.key}
                data-chain-key={key}
                data-highlight={on || undefined}
                className={
                  on || !dimOthers ? "rounded-2xl" : "rounded-2xl opacity-70"
                }
              >
                {item}
              </div>
            )
          })}
        </aside>
      </FeedPagingContext.Provider>,
      document.body,
    )
  )
}
